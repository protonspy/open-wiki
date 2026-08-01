import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FfmpegResult, FfmpegRunner } from "../src/ffmpeg.js";
import { readJournal, writeJournal, planJournal, type Journal } from "../src/journal.js";
import { FLAC_16K, SttError, type SttProvider, type SttResult } from "../src/stt/index.js";
import {
  extractChunkArgs,
  JournalMismatchError,
  MAX_CONSECUTIVE_FAILURES,
  trackFile,
  transcribeRecording,
} from "../src/transcribe.js";
import type { TimeMap } from "../src/timemap.js";

const SECOND = 1_000_000_000;
const s = (n: number): number => n * SECOND;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ow-transcribe-"));
  writeFileSync(join(dir, "mic.opus"), "");
  writeFileSync(join(dir, "system.opus"), "");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** One 20 s stretch, cut into two chunks. */
const map: TimeMap = {
  version: 1,
  compressedDurationNs: s(20),
  segments: [
    { compressedStartNs: 0, durationNs: s(20), recordedStartNs: 0, wallStartMs: 1_000_000 },
  ],
  chunks: [
    { index: 0, compressedStartNs: 0, compressedEndNs: s(10) },
    { index: 1, compressedStartNs: s(10), compressedEndNs: s(20) },
  ],
};

const okFfmpeg: FfmpegRunner = async (): Promise<FfmpegResult> => {
  // The chunk file has to exist for the pipeline to read it back.
  return { code: 0, stdout: "", stderr: "" };
};

/** ffmpeg that actually writes the file the pipeline then reads. */
function writingFfmpeg(): FfmpegRunner {
  return async (args) => {
    writeFileSync(args[args.length - 1]!, "audio");
    return { code: 0, stdout: "", stderr: "" };
  };
}

function provider(
  transcribe: (n: number) => Promise<SttResult>,
  over: Partial<SttProvider> = {},
): { provider: SttProvider; calls: () => number } {
  let n = 0;
  return {
    provider: {
      name: "groq",
      model: "whisper-large-v3-turbo",
      audioFormat: FLAC_16K,
      transcribe: async () => transcribe(n++),
      ...over,
    },
    calls: () => n,
  };
}

const said = async (): Promise<SttResult> => ({
  segments: [{ startNs: 0, endNs: SECOND, text: "hello" }],
  text: "hello",
});

describe("extractChunkArgs", () => {
  it("seeks accurately, by putting -ss after the input", () => {
    // A packet-aligned seek is up to 20 ms off, and a chunk boundary here sits
    // between two stretches of speech with the silence already removed — that
    // is a clipped syllable at each end, on every chunk.
    const args = extractChunkArgs(
      "mic.opus",
      { compressedStartNs: s(10), compressedEndNs: s(20) },
      "out.flac",
      FLAC_16K,
    );
    expect(args.indexOf("-ss")).toBeGreaterThan(args.indexOf("-i"));
  });

  it("cuts exactly the chunk", () => {
    const args = extractChunkArgs(
      "mic.opus",
      { compressedStartNs: s(10), compressedEndNs: s(20) },
      "out.flac",
      FLAC_16K,
    );
    expect(args[args.indexOf("-ss") + 1]).toBe("10.000000");
    expect(args[args.indexOf("-to") + 1]).toBe("20.000000");
  });

  it("decodes into the provider's format rather than copying the Opus", () => {
    const args = extractChunkArgs(
      "mic.opus",
      { compressedStartNs: 0, compressedEndNs: 1 },
      "o.flac",
      FLAC_16K,
    );
    expect(args).not.toContain("copy");
    expect(args).toContain("flac");
  });
});

describe("trackFile", () => {
  it("names each track's Opus", () => {
    expect(trackFile("mic")).toBe("mic.opus");
    expect(trackFile("system")).toBe("system.opus");
  });
});

describe("transcribeRecording (4.9)", () => {
  it("writes the journal after every chunk, before the next one starts", async () => {
    // The whole of `adr:0012`: an application killed mid-run loses at most the
    // chunk in flight. Asserted by reading the file from inside the provider,
    // which is the only moment "before the next one starts" exists.
    const seen: number[] = [];
    const p = provider(async () => {
      seen.push(readJournal(dir)?.chunks.filter((c) => c.done).length ?? -1);
      return said();
    });
    await transcribeRecording({
      dir,
      provider: p.provider,
      language: "en",
      map,
      run: writingFfmpeg(),
    });
    // Nothing done before the first, one before the second, and so on.
    expect(seen).toEqual([0, 1, 2, 3]);
  });

  it("transcribes both tracks, which is what lets 4.12 label me and remote", async () => {
    const p = provider(said);
    const journal = await transcribeRecording({
      dir,
      provider: p.provider,
      language: "en",
      map,
      run: writingFfmpeg(),
    });
    expect(journal.chunks.filter((c) => c.track === "mic" && c.done)).toHaveLength(2);
    expect(journal.chunks.filter((c) => c.track === "system" && c.done)).toHaveLength(2);
  });

  it("sends one chunk at a time", async () => {
    let inFlight = 0;
    let most = 0;
    const p = provider(async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return said();
    });
    await transcribeRecording({
      dir,
      provider: p.provider,
      language: "en",
      map,
      run: writingFfmpeg(),
    });
    expect(most).toBe(1);
  });

  it("resumes, sending only what has not succeeded", async () => {
    const existing = planJournal(
      { provider: "groq", model: "whisper-large-v3-turbo", chunks: map.chunks },
      "en",
    );
    existing.chunks[0]!.done = true;
    existing.chunks[0]!.text = "already paid for";
    existing.chunks[1]!.error = "429";
    writeJournal(dir, existing);

    const p = provider(said);
    const journal = await transcribeRecording({
      dir,
      provider: p.provider,
      language: "en",
      map,
      run: writingFfmpeg(),
    });
    // Three sent: the failed one and the two never attempted. Not the one done.
    expect(p.calls()).toBe(3);
    expect(journal.chunks[0]!.text).toBe("already paid for");
  });

  it("clears the error on a chunk that succeeded the second time", async () => {
    const existing = planJournal(
      { provider: "groq", model: "whisper-large-v3-turbo", chunks: map.chunks },
      "en",
    );
    existing.chunks[0]!.error = "429";
    writeJournal(dir, existing);
    const p = provider(said);
    const journal = await transcribeRecording({
      dir,
      provider: p.provider,
      language: "en",
      map,
      run: writingFfmpeg(),
    });
    expect(journal.chunks[0]!.error).toBeUndefined();
    expect(journal.chunks[0]!.done).toBe(true);
  });

  it("records a failure and carries on to the next chunk", async () => {
    // 6.3 offers "redo only what failed", and that needs the rest attempted.
    const p = provider(async (n) => {
      if (n === 0) throw new SttError("that chunk was unreadable", false);
      return said();
    });
    const journal = await transcribeRecording({
      dir,
      provider: p.provider,
      language: "en",
      map,
      run: writingFfmpeg(),
    });
    expect(journal.chunks[0]!.error).toMatch(/unreadable/);
    expect(journal.chunks.filter((c) => c.done)).toHaveLength(3);
  });

  it("stops after a run of failures, rather than paying for twenty of them", async () => {
    // A bad credential fails every chunk identically. Three in a row is the
    // shape of a systemic failure; one is the shape of a bad chunk.
    const p = provider(async () => {
      throw new SttError("401 bad key", false);
    });
    await transcribeRecording({
      dir,
      provider: p.provider,
      language: "en",
      map,
      run: writingFfmpeg(),
    });
    expect(p.calls()).toBe(MAX_CONSECUTIVE_FAILURES);
  });

  it("reports progress as it goes", async () => {
    const seen: Array<[number, number]> = [];
    const p = provider(said);
    await transcribeRecording({
      dir,
      provider: p.provider,
      language: "en",
      map,
      run: writingFfmpeg(),
      onProgress: (done, total) => seen.push([done, total]),
    });
    expect(seen).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
  });

  it("passes the language and the vocabulary to the provider", async () => {
    let language = "";
    let vocabulary: readonly string[] = [];
    const p = provider(said);
    p.provider.transcribe = async (request) => {
      language = request.language;
      vocabulary = request.vocabulary;
      return said();
    };
    await transcribeRecording({
      dir,
      provider: p.provider,
      language: "pt-BR",
      vocabulary: ["Fenix"],
      map,
      run: writingFfmpeg(),
    });
    expect(language).toBe("pt-BR");
    expect(vocabulary).toEqual(["Fenix"]);
  });

  it("records a failed extraction as the chunk's error rather than throwing", async () => {
    const p = provider(said);
    const failing: FfmpegRunner = async () => ({ code: 1, stdout: "", stderr: "Invalid data" });
    const journal = await transcribeRecording({
      dir,
      provider: p.provider,
      language: "en",
      map,
      run: failing,
    });
    expect(journal.chunks[0]!.error).toMatch(/Invalid data/);
  });

  it("leaves no chunk audio behind", async () => {
    const p = provider(said);
    await transcribeRecording({
      dir,
      provider: p.provider,
      language: "en",
      map,
      run: writingFfmpeg(),
    });
    // The recording's directory holds what it started with, plus the journal.
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(dir).sort()).toEqual(["journal.json", "mic.opus", "system.opus"]);
  });
});

describe("transcribeRecording resuming (4.17)", () => {
  function journalFor(over: Partial<Journal> = {}): Journal {
    return {
      ...planJournal(
        { provider: "groq", model: "whisper-large-v3-turbo", chunks: map.chunks },
        "en",
      ),
      ...over,
    };
  }

  it("refuses a journal from another provider rather than stitching two together", async () => {
    writeJournal(dir, journalFor({ provider: "whispercpp" }));
    const p = provider(said);
    await expect(
      transcribeRecording({ dir, provider: p.provider, language: "en", map, run: okFfmpeg }),
    ).rejects.toThrow(JournalMismatchError);
    expect(p.calls()).toBe(0);
  });

  it("refuses a journal from another model", async () => {
    writeJournal(dir, journalFor({ model: "ggml-large-v3.bin" }));
    const p = provider(said);
    await expect(
      transcribeRecording({ dir, provider: p.provider, language: "en", map, run: okFfmpeg }),
    ).rejects.toThrow(/model/i);
  });

  it("refuses a journal whose boundaries moved", async () => {
    const moved: TimeMap = {
      ...map,
      chunks: [{ index: 0, compressedStartNs: 0, compressedEndNs: s(20) }],
    };
    writeJournal(dir, journalFor());
    const p = provider(said);
    await expect(
      transcribeRecording({ dir, provider: p.provider, language: "en", map: moved, run: okFfmpeg }),
    ).rejects.toThrow(JournalMismatchError);
  });

  it("says what to do about it", async () => {
    writeJournal(dir, journalFor({ provider: "whispercpp" }));
    const p = provider(said);
    await expect(
      transcribeRecording({ dir, provider: p.provider, language: "en", map, run: okFfmpeg }),
    ).rejects.toThrow(/again from the beginning/);
  });

  it("starts over when the caller asked for a restart", async () => {
    writeJournal(dir, journalFor({ provider: "whispercpp" }));
    const p = provider(said);
    const journal = await transcribeRecording({
      dir,
      provider: p.provider,
      language: "en",
      map,
      run: writingFfmpeg(),
      restart: true,
    });
    expect(journal.provider).toBe("groq");
    expect(p.calls()).toBe(4);
  });

  it("ignores a journal that will not parse and plans a fresh one", async () => {
    writeFileSync(join(dir, "journal.json"), "{ truncated", "utf8");
    const p = provider(said);
    const journal = await transcribeRecording({
      dir,
      provider: p.provider,
      language: "en",
      map,
      run: writingFfmpeg(),
    });
    expect(journal.chunks).toHaveLength(4);
  });
});
