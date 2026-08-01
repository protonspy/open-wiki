import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FfmpegResult } from "../src/ffmpeg.js";
import {
  encodeArgs,
  encodeTrack,
  probeDurationNs,
  sampleAt,
  SAMPLE_PERIOD_NS,
  trimConcatFilter,
} from "../src/encode.js";

const SECOND = 1_000_000_000;
const s = (n: number): number => n * SECOND;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ow-encode-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("sampleAt", () => {
  it("counts output samples at 16 kHz", () => {
    expect(SAMPLE_PERIOD_NS).toBe(62_500);
    expect(sampleAt(SECOND)).toBe(16_000);
    expect(sampleAt(0)).toBe(0);
  });
});

describe("trimConcatFilter", () => {
  it("cuts on sample indices, not on seconds", () => {
    // `atrim` given `start`/`end` in seconds still cuts precisely, but the map
    // is built from sample counts — handing the encoder the same integers is
    // what makes the two agree by construction rather than by rounding.
    const filter = trimConcatFilter([{ startNs: 0, endNs: s(5) }]);
    expect(filter).toContain("atrim=start_sample=0:end_sample=80000");
  });

  it("keeps one stretch per branch and concatenates them in order", () => {
    const filter = trimConcatFilter([
      { startNs: 0, endNs: s(5) },
      { startNs: s(8), endNs: s(12) },
    ]);
    expect(filter).toContain("asplit=2[s0][s1]");
    expect(filter).toContain("[a0][a1]concat=n=2:v=0:a=1[out]");
  });

  it("resamples once, before the split", () => {
    // After the split each branch would resample separately, and `concat`
    // holds every branch open at once — the difference is what ffmpeg buffers.
    const filter = trimConcatFilter([{ startNs: 0, endNs: SECOND }]);
    const resample = filter.indexOf("aresample=16000");
    const split = filter.indexOf("asplit");
    expect(resample).toBeGreaterThanOrEqual(0);
    expect(resample).toBeLessThan(split);
  });

  it("restamps each piece so the output is contiguous", () => {
    // Without asetpts the removed gaps come back as silence and nothing was cut.
    expect(trimConcatFilter([{ startNs: 0, endNs: SECOND }])).toContain("asetpts=N/SR/TB");
  });

  it("does not select frames, which would quantise every boundary", () => {
    // `aselect` passes or drops whole decoded frames — about 21 ms each, and
    // outward at both ends — so the file drifts longer than the map over a
    // recording with many cuts. This asserts the recipe, not the arithmetic.
    expect(trimConcatFilter([{ startNs: 0, endNs: SECOND }])).not.toContain("aselect");
  });
});

describe("encodeArgs", () => {
  const args = encodeArgs("mic.wav", "mic.opus", null);

  it("downmixes to 16 kHz mono", () => {
    expect(args[args.indexOf("-ac") + 1]).toBe("1");
    expect(args[args.indexOf("-ar") + 1]).toBe("16000");
  });

  it("encodes Opus at 24 kbps, which is what fits under the upload cap", () => {
    expect(args[args.indexOf("-c:a") + 1]).toBe("libopus");
    expect(args[args.indexOf("-b:a") + 1]).toBe("24k");
  });

  it("reads the graph from a file, because the command line has a length limit", () => {
    const withFilter = encodeArgs("mic.wav", "mic.opus", "filter.txt");
    expect(withFilter[withFilter.indexOf("-filter_complex_script") + 1]).toBe("filter.txt");
  });

  it("maps the graph's output, without which the filter would be ignored", () => {
    const withFilter = encodeArgs("mic.wav", "mic.opus", "filter.txt");
    expect(withFilter[withFilter.indexOf("-map") + 1]).toBe("[out]");
  });

  it("omits the graph entirely when there is none", () => {
    expect(args).not.toContain("-filter_complex_script");
    expect(args).not.toContain("-map");
  });

  it("names the output last", () => {
    expect(args[args.length - 1]).toBe("mic.opus");
  });
});

describe("encodeTrack", () => {
  it("hands ffmpeg a graph carrying the cut list", async () => {
    let seen = "";
    const run = async (args: readonly string[]): Promise<FfmpegResult> => {
      const script = args[args.indexOf("-filter_complex_script") + 1]!;
      seen = readFileSync(script, "utf8");
      return { code: 0, stdout: "", stderr: "" };
    };
    await encodeTrack(run, "mic.wav", join(dir, "mic.opus"), [{ startNs: 0, endNs: s(5) }], s(10));
    expect(seen).toContain("end_sample=80000");
  });

  it("writes the graph outside the recording, which is frozen once written", async () => {
    let script = "";
    const run = async (args: readonly string[]): Promise<FfmpegResult> => {
      script = args[args.indexOf("-filter_complex_script") + 1]!;
      return { code: 0, stdout: "", stderr: "" };
    };
    await encodeTrack(
      run,
      "mic.wav",
      join(dir, "mic.opus"),
      [{ startNs: 0, endNs: SECOND }],
      s(10),
    );
    expect(script.startsWith(dir)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("leaves no graph behind even when ffmpeg fails", async () => {
    let script = "";
    const failing = async (args: readonly string[]): Promise<FfmpegResult> => {
      script = args[args.indexOf("-filter_complex_script") + 1]!;
      expect(existsSync(script)).toBe(true);
      return { code: 1, stdout: "", stderr: "boom" };
    };
    await expect(
      encodeTrack(
        failing,
        "mic.wav",
        join(dir, "mic.opus"),
        [{ startNs: 0, endNs: SECOND }],
        s(10),
      ),
    ).rejects.toThrow(/boom/);
    expect(existsSync(script)).toBe(false);
  });

  it("skips the graph when the cut list already covers the whole track", async () => {
    let args: readonly string[] = [];
    const run = async (a: readonly string[]): Promise<FfmpegResult> => {
      args = a;
      return { code: 0, stdout: "", stderr: "" };
    };
    await encodeTrack(run, "mic.wav", join(dir, "mic.opus"), [{ startNs: 0, endNs: s(10) }], s(10));
    expect(args).not.toContain("-filter_complex_script");
  });

  it("encodes the whole track when there is nothing to keep", async () => {
    let args: readonly string[] = [];
    const run = async (a: readonly string[]): Promise<FfmpegResult> => {
      args = a;
      return { code: 0, stdout: "", stderr: "" };
    };
    await encodeTrack(run, "mic.wav", join(dir, "mic.opus"), [], s(10));
    expect(args).not.toContain("-filter_complex_script");
  });

  it("passes the input and the output through", async () => {
    let args: readonly string[] = [];
    await encodeTrack(
      async (a) => {
        args = a;
        return { code: 0, stdout: "", stderr: "" };
      },
      "system.wav",
      join(dir, "system.opus"),
      [],
      SECOND,
    );
    expect(args).toContain("system.wav");
    expect(args[args.length - 1]).toBe(join(dir, "system.opus"));
  });
});

describe("probeDurationNs", () => {
  const log = (text: string) => async (): Promise<FfmpegResult> => ({
    // ffmpeg exits non-zero when no output is named, and prints this anyway.
    code: 1,
    stdout: "",
    stderr: text,
  });

  it("reads the duration ffmpeg reports", async () => {
    const run = log("  Duration: 00:41:07.23, start: 0.000000, bitrate: 24 kb/s");
    expect(await probeDurationNs(run, "mic.opus")).toBe((41 * 60 + 7) * SECOND + 230_000_000);
  });

  it("reads a duration past an hour", async () => {
    const run = log("  Duration: 01:00:00.00");
    expect(await probeDurationNs(run, "mic.opus")).toBe(3600 * SECOND);
  });

  it("answers null when ffmpeg said nothing about the duration", async () => {
    const run = log("mic.opus: Invalid data found when processing input");
    expect(await probeDurationNs(run, "mic.opus")).toBeNull();
  });

  it("asks about the file without naming an output", async () => {
    let args: readonly string[] = [];
    await probeDurationNs(async (a) => {
      args = a;
      return { code: 1, stdout: "", stderr: "" };
    }, "mic.opus");
    expect(args[args.indexOf("-i") + 1]).toBe("mic.opus");
    expect(args).not.toContain("-c:a");
  });
});
