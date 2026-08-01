import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FfmpegFailedError,
  FfmpegMissingError,
  resolveFfmpeg,
  runOrThrow,
  spawnFfmpeg,
  tail,
  type FfmpegResult,
} from "../src/ffmpeg.js";

/** A temporary directory posing as a repository root. */
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ow-ffmpeg-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env["OPEN_WIKI_FFMPEG"];
});

function vendor(dir: string): string {
  mkdirSync(join(dir, "vendor", "ffmpeg"), { recursive: true });
  const exe = join(dir, "vendor", "ffmpeg", "ffmpeg.exe");
  writeFileSync(exe, "");
  return exe;
}

describe("resolveFfmpeg", () => {
  it("finds the bundled binary under vendor/ffmpeg", () => {
    const exe = vendor(root);
    expect(resolveFfmpeg(root)).toBe(exe);
  });

  it("prefers OPEN_WIKI_FFMPEG when it points at a file that exists", () => {
    vendor(root);
    const override = join(root, "other-ffmpeg.exe");
    writeFileSync(override, "");
    process.env["OPEN_WIKI_FFMPEG"] = override;
    expect(resolveFfmpeg(root)).toBe(override);
  });

  it("refuses rather than falling back to whatever ffmpeg is on PATH", () => {
    expect(() => resolveFfmpeg(root)).toThrow(FfmpegMissingError);
  });

  it("names every place it looked, including an override that was not there", () => {
    process.env["OPEN_WIKI_FFMPEG"] = join(root, "nope.exe");
    expect(() => resolveFfmpeg(root)).toThrow(/OPEN_WIKI_FFMPEG/);
    expect(() => resolveFfmpeg(root)).toThrow(/vendor/);
  });
});

describe("tail", () => {
  it("keeps only the last lines, which is where ffmpeg puts the reason", () => {
    expect(tail("a\nb\nc\nd", 2)).toBe("c\nd");
  });

  it("returns the whole text when it is shorter than the limit", () => {
    expect(tail("only", 5)).toBe("only");
  });
});

describe("runOrThrow", () => {
  const ok: FfmpegResult = { code: 0, stderr: "", stdout: "" };

  it("passes the result through on a zero exit", async () => {
    await expect(runOrThrow(async () => ok, ["-version"])).resolves.toBe(ok);
  });

  it("throws with the exit code and the tail of the log", async () => {
    const run = async (): Promise<FfmpegResult> => ({
      code: 1,
      stderr: "banner\nInvalid argument",
      stdout: "",
    });
    await expect(runOrThrow(run, [])).rejects.toThrow(FfmpegFailedError);
    await expect(runOrThrow(run, [])).rejects.toThrow(/Invalid argument/);
  });
});

describe("spawnFfmpeg", () => {
  it("collects stdout, stderr and the exit code without throwing on failure", async () => {
    // `process.execPath` stands in for ffmpeg: this is testing the plumbing of
    // the runner, which is the part that has nothing to do with audio.
    const run = spawnFfmpeg(process.execPath);
    const result = await run([
      "-e",
      "process.stdout.write('out');process.stderr.write('err');process.exit(3)",
    ]);
    expect(result).toEqual({ code: 3, stdout: "out", stderr: "err" });
  });

  it("rejects when the executable cannot be started at all", async () => {
    const run = spawnFfmpeg(join(root, "does-not-exist.exe"));
    await expect(run([])).rejects.toThrow();
  });
});
