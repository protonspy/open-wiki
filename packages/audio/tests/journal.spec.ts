import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isComplete,
  isJournal,
  journalMatches,
  pendingChunks,
  planJournal,
  readJournal,
  writeJournal,
  type JournalExpectation,
} from "../src/journal.js";
import type { Chunk } from "../src/timemap.js";

const SECOND = 1_000_000_000;
const s = (n: number): number => n * SECOND;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ow-journal-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const chunks: Chunk[] = [
  { index: 0, compressedStartNs: 0, compressedEndNs: s(600) },
  { index: 1, compressedStartNs: s(600), compressedEndNs: s(900) },
];

const expected: JournalExpectation = {
  provider: "groq",
  model: "whisper-large-v3-turbo",
  chunks,
};

describe("planJournal", () => {
  it("plans one unit of work per chunk per track", () => {
    // Both tracks are transcribed: 4.12 labels `me` and `remote` by the track
    // a passage came from, which is only possible if each was read on its own.
    const journal = planJournal(expected, "pt-BR");
    expect(journal.chunks).toHaveLength(4);
    expect(journal.chunks.filter((c) => c.track === "mic")).toHaveLength(2);
    expect(journal.chunks.filter((c) => c.track === "system")).toHaveLength(2);
  });

  it("numbers every unit uniquely, which is what a progress count reads", () => {
    // `sources/state.ts` counts `chunks.length` and `chunks.filter(c => c.done)`
    // to render "4 of 8". Two entries sharing an index would still count, but
    // nothing could address one of them.
    const journal = planJournal(expected, "en");
    expect(journal.chunks.map((c) => c.index)).toEqual([0, 1, 2, 3]);
  });

  it("records the provider, the model and the language it was planned for", () => {
    const journal = planJournal(expected, "es");
    expect(journal.provider).toBe("groq");
    expect(journal.model).toBe("whisper-large-v3-turbo");
    expect(journal.language).toBe("es");
  });

  it("carries each chunk's boundaries, so a resume can check the segmentation", () => {
    const journal = planJournal(expected, "en");
    const mic = journal.chunks.filter((c) => c.track === "mic");
    expect(mic[0]).toMatchObject({ compressedStartNs: 0, compressedEndNs: s(600) });
    expect(mic[1]).toMatchObject({ compressedStartNs: s(600), compressedEndNs: s(900) });
  });

  it("starts with nothing done", () => {
    expect(planJournal(expected, "en").chunks.every((c) => !c.done)).toBe(true);
  });
});

describe("journalMatches (4.17)", () => {
  it("accepts a journal describing the same work", () => {
    expect(journalMatches(planJournal(expected, "en"), expected)).toEqual({ ok: true });
  });

  it("refuses a journal from a different provider", () => {
    // Resuming across providers stitches two models' output into one timeline
    // — plausible, readable, and wrong, with correct-looking timestamps.
    const journal = planJournal(expected, "en");
    const match = journalMatches(journal, { ...expected, provider: "whispercpp" });
    expect(match.ok).toBe(false);
    expect(match.ok === false && match.reason).toMatch(/provider/i);
  });

  it("refuses a journal from a different model", () => {
    const journal = planJournal(expected, "en");
    const match = journalMatches(journal, { ...expected, model: "ggml-large-v3.bin" });
    expect(match.ok).toBe(false);
    expect(match.ok === false && match.reason).toMatch(/model/i);
  });

  it("refuses a journal whose chunk count no longer matches", () => {
    const journal = planJournal(expected, "en");
    const match = journalMatches(journal, {
      ...expected,
      chunks: [{ index: 0, compressedStartNs: 0, compressedEndNs: s(900) }],
    });
    expect(match.ok).toBe(false);
    expect(match.ok === false && match.reason).toMatch(/boundar|chunk/i);
  });

  it("refuses a journal whose boundaries moved, even with the same count", () => {
    // The dangerous one: same number of chunks, cut in different places. Every
    // offset inside every chunk means something else.
    const journal = planJournal(expected, "en");
    const match = journalMatches(journal, {
      ...expected,
      chunks: [
        { index: 0, compressedStartNs: 0, compressedEndNs: s(500) },
        { index: 1, compressedStartNs: s(500), compressedEndNs: s(900) },
      ],
    });
    expect(match.ok).toBe(false);
    expect(match.ok === false && match.reason).toMatch(/boundar/i);
  });

  it("refuses a journal written for a different content language", () => {
    // Same class as the provider and the model: resuming would produce one
    // transcript in two languages, which reads as one.
    const journal = planJournal(expected, "pt-BR");
    const match = journalMatches(journal, { ...expected, language: "en" });
    expect(match.ok).toBe(false);
    expect(match.ok === false && match.reason).toMatch(/language/i);
  });

  it("does not check the language when the caller did not name one", () => {
    expect(journalMatches(planJournal(expected, "pt-BR"), expected)).toEqual({ ok: true });
  });

  it("counts in cuts, not in units of work, when the boundaries moved", () => {
    // Two tracks make four units of two chunks. The user recognises the two.
    const journal = planJournal(expected, "en");
    const match = journalMatches(journal, {
      ...expected,
      chunks: [{ index: 0, compressedStartNs: 0, compressedEndNs: s(900) }],
    });
    expect(match.ok === false && match.reason).toContain("2 chunks");
    expect(match.ok === false && match.reason).toContain("into 1");
  });

  it("accepts a journal that is part-done, which is the whole point", () => {
    const journal = planJournal(expected, "en");
    journal.chunks[0]!.done = true;
    journal.chunks[0]!.text = "hello";
    expect(journalMatches(journal, expected)).toEqual({ ok: true });
  });
});

describe("pendingChunks", () => {
  it("is everything never attempted", () => {
    expect(pendingChunks(planJournal(expected, "en"))).toHaveLength(4);
  });

  it("excludes what already succeeded, so a resume costs nothing for it", () => {
    const journal = planJournal(expected, "en");
    journal.chunks[0]!.done = true;
    journal.chunks[2]!.done = true;
    expect(pendingChunks(journal).map((c) => c.index)).toEqual([1, 3]);
  });

  it("includes what failed — a failure is work still to do", () => {
    const journal = planJournal(expected, "en");
    journal.chunks[0]!.error = "429";
    expect(pendingChunks(journal).map((c) => c.index)).toContain(0);
  });
});

describe("isComplete", () => {
  it("is true only when every unit succeeded", () => {
    const journal = planJournal(expected, "en");
    expect(isComplete(journal)).toBe(false);
    for (const chunk of journal.chunks) chunk.done = true;
    expect(isComplete(journal)).toBe(true);
  });

  it("is false when one failed, however many succeeded", () => {
    // 4.14 checks this before deleting 690 MB of WAV.
    const journal = planJournal(expected, "en");
    for (const chunk of journal.chunks) chunk.done = true;
    journal.chunks[3]!.done = false;
    journal.chunks[3]!.error = "timed out";
    expect(isComplete(journal)).toBe(false);
  });
});

describe("readJournal and writeJournal", () => {
  it("round-trips", () => {
    const journal = planJournal(expected, "pt-BR");
    journal.chunks[0]!.done = true;
    journal.chunks[0]!.text = "bom dia";
    writeJournal(dir, journal);
    expect(readJournal(dir)).toEqual(journal);
  });

  it("answers null when there is no journal", () => {
    expect(readJournal(dir)).toBeNull();
  });

  it("answers null for a journal that will not parse", () => {
    writeFileSync(join(dir, "journal.json"), "{ truncated", "utf8");
    expect(readJournal(dir)).toBeNull();
  });

  it("answers null for a file that parses into something that is not a journal", () => {
    // A cast is not a check, and this one decides whether a paid-for hour of
    // transcription is resumed or thrown away.
    for (const content of ["{}", "[]", "null", '{"version":2,"chunks":[]}']) {
      writeFileSync(join(dir, "journal.json"), content, "utf8");
      expect(readJournal(dir)).toBeNull();
    }
  });

  it("leaves no temporary file behind after a successful write", () => {
    // It is rewritten after every chunk, so it is the file in this product
    // most likely to be caught mid-write by a machine going down.
    writeJournal(dir, planJournal(expected, "en"));
    expect(readdirSync(dir).filter((f) => f.startsWith(".ow-tmp-"))).toEqual([]);
  });

  it("leaves the previous journal intact when a write fails", () => {
    // The whole reason for the rename: a failed write must not turn a journal
    // holding an hour of paid-for transcription into a truncated file, which
    // reads as no journal at all.
    const first = planJournal(expected, "en");
    first.chunks[0]!.done = true;
    first.chunks[0]!.text = "already paid for";
    writeJournal(dir, first);

    const doomed = planJournal(expected, "en") as unknown as { chunks: unknown };
    doomed.chunks = {
      toJSON() {
        throw new Error("serialisation blew up");
      },
    };
    expect(() => writeJournal(dir, doomed as never)).toThrow();

    expect(readJournal(dir)).toEqual(first);
    expect(readdirSync(dir).filter((f) => f.startsWith(".ow-tmp-"))).toEqual([]);
  });

  it("stays readable by the source-state reader that counts progress", () => {
    // `sources/state.ts` reads `chunks[].done` and `chunks[].error` out of this
    // file to render the sources screen. It is a separate module with its own
    // idea of the shape, and this is the contract between them.
    const journal = planJournal(expected, "en");
    journal.chunks[0]!.done = true;
    journal.chunks[1]!.error = "boom";
    writeJournal(dir, journal);
    const raw = JSON.parse(readFileSync(join(dir, "journal.json"), "utf8")) as {
      chunks: Array<{ index: number; done?: boolean; error?: string }>;
    };
    expect(raw.chunks.filter((c) => c.done)).toHaveLength(1);
    expect(raw.chunks.find((c) => c.error)?.error).toBe("boom");
  });
});

describe("isJournal", () => {
  it("accepts what planJournal produced", () => {
    expect(isJournal(planJournal(expected, "en"))).toBe(true);
  });

  it("refuses an object that merely parsed", () => {
    expect(isJournal({})).toBe(false);
    expect(isJournal(null)).toBe(false);
    expect(isJournal([])).toBe(false);
  });

  it("refuses a version it was not written to read", () => {
    const journal: Record<string, unknown> = { ...planJournal(expected, "en"), version: 2 };
    expect(isJournal(journal)).toBe(false);
  });

  it("refuses chunks that are not made of the fields a resume needs", () => {
    const journal = planJournal(expected, "en");
    (journal.chunks[0] as { compressedStartNs: unknown }).compressedStartNs = "0";
    expect(isJournal(journal)).toBe(false);
  });

  it("refuses content fields that are not what their type says", () => {
    // `text` and `segments` are what end up in the timeline and then in a wiki
    // page, carrying wall-clock provenance from the real time map. A guard
    // that returns `value is Journal` without looking at them hands every
    // consumer a string that is a number.
    for (const bad of [
      { text: 5 },
      { error: [] },
      { segments: "abc" },
      { segments: [{ startNs: "0", endNs: 1, text: "x" }] },
      { segments: [{ startNs: 0, endNs: 1 }] },
    ]) {
      const journal = planJournal(expected, "en");
      Object.assign(journal.chunks[0]!, bad);
      expect(isJournal(journal)).toBe(false);
    }
  });

  it("accepts the content fields a real run writes", () => {
    const journal = planJournal(expected, "en");
    Object.assign(journal.chunks[0]!, {
      done: true,
      text: "bom dia",
      segments: [{ startNs: 0, endNs: 1, text: "bom dia" }],
    });
    journal.chunks[1]!.error = "429";
    expect(isJournal(journal)).toBe(true);
  });

  it("refuses a chunk list too long to be a recording", () => {
    const journal = planJournal(expected, "en");
    journal.chunks = Array.from({ length: 10_001 }, (_, i) => ({
      ...journal.chunks[0]!,
      index: i,
    }));
    expect(isJournal(journal)).toBe(false);
  });
});
