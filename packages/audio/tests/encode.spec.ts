import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FfmpegResult } from "../src/ffmpeg.js";
import { encodeArgs, encodeTrack, selectFilter } from "../src/encode.js";

const SECOND = 1_000_000_000;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ow-encode-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("selectFilter", () => {
  it("keeps exactly the wanted stretches, in seconds", () => {
    const filter = selectFilter([
      { startNs: 0, endNs: 5 * SECOND },
      { startNs: 8 * SECOND, endNs: 12 * SECOND },
    ]);
    expect(filter).toContain("between(t,0.000000,5.000000)");
    expect(filter).toContain("between(t,8.000000,12.000000)");
  });

  it("restamps what survives so the output is contiguous", () => {
    // Without asetpts the removed gaps come back as silence and nothing was cut.
    expect(selectFilter([{ startNs: 0, endNs: SECOND }])).toContain("asetpts=N/SR/TB");
  });

  it("keeps sub-second boundaries rather than rounding them to whole seconds", () => {
    const filter = selectFilter([{ startNs: 1_234_500_000, endNs: 2_000_000_000 }]);
    expect(filter).toContain("1.234500");
  });
});

describe("encodeArgs", () => {
  const args = encodeArgs("mic.wav", "mic.opus", null);

  it("downmixes to 16 kHz mono", () => {
    expect(args).toContain("-ac");
    expect(args[args.indexOf("-ac") + 1]).toBe("1");
    expect(args).toContain("-ar");
    expect(args[args.indexOf("-ar") + 1]).toBe("16000");
  });

  it("encodes Opus at 24 kbps, which is what fits under the upload cap", () => {
    expect(args[args.indexOf("-c:a") + 1]).toBe("libopus");
    expect(args[args.indexOf("-b:a") + 1]).toBe("24k");
  });

  it("reads the filter from a file, because the command line has a length limit", () => {
    const withFilter = encodeArgs("mic.wav", "mic.opus", "mic.opus.filter.txt");
    expect(withFilter[withFilter.indexOf("-filter_script:a") + 1]).toBe("mic.opus.filter.txt");
  });

  it("omits the filter entirely when there is none", () => {
    expect(args).not.toContain("-filter_script:a");
  });

  it("names the output last", () => {
    expect(args[args.length - 1]).toBe("mic.opus");
  });
});

describe("encodeTrack", () => {
  const ok = async (): Promise<FfmpegResult> => ({ code: 0, stdout: "", stderr: "" });

  it("writes the cut list to a script and hands ffmpeg the path", async () => {
    let script: string | undefined;
    const run = async (args: readonly string[]): Promise<FfmpegResult> => {
      const i = args.indexOf("-filter_script:a");
      script = args[i + 1];
      expect(script).toBeDefined();
      expect(readFileSync(script!, "utf8")).toContain("between(t,0.000000,5.000000)");
      return { code: 0, stdout: "", stderr: "" };
    };
    await encodeTrack(
      run,
      "mic.wav",
      join(dir, "mic.opus"),
      [{ startNs: 0, endNs: 5 * SECOND }],
      10 * SECOND,
    );
    expect(existsSync(script!)).toBe(false);
  });

  it("leaves no filter script behind even when ffmpeg fails", async () => {
    const failing = async (args: readonly string[]): Promise<FfmpegResult> => {
      const script = args[args.indexOf("-filter_script:a") + 1]!;
      expect(existsSync(script)).toBe(true);
      return { code: 1, stdout: "", stderr: "boom" };
    };
    await expect(
      encodeTrack(
        failing,
        "mic.wav",
        join(dir, "mic.opus"),
        [{ startNs: 0, endNs: SECOND }],
        10 * SECOND,
      ),
    ).rejects.toThrow(/boom/);
    expect(existsSync(join(dir, "mic.opus.filter.txt"))).toBe(false);
  });

  it("skips the filter when the cut list already covers the whole track", async () => {
    let args: readonly string[] = [];
    const run = async (a: readonly string[]): Promise<FfmpegResult> => {
      args = a;
      return { code: 0, stdout: "", stderr: "" };
    };
    await encodeTrack(
      run,
      "mic.wav",
      join(dir, "mic.opus"),
      [{ startNs: 0, endNs: 10 * SECOND }],
      10 * SECOND,
    );
    expect(args).not.toContain("-filter_script:a");
  });

  it("encodes the whole track when there is nothing to keep", async () => {
    let args: readonly string[] = [];
    const run = async (a: readonly string[]): Promise<FfmpegResult> => {
      args = a;
      return { code: 0, stdout: "", stderr: "" };
    };
    await encodeTrack(run, "mic.wav", join(dir, "mic.opus"), [], 10 * SECOND);
    expect(args).not.toContain("-filter_script:a");
  });

  it("passes the input and the output through", async () => {
    let args: readonly string[] = [];
    await encodeTrack(
      async (a) => {
        args = a;
        return (await ok()) as FfmpegResult;
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
