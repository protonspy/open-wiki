import { describe, expect, it } from "vitest";
import type { FfmpegResult } from "../src/ffmpeg.js";
import {
  detectSilence,
  msToNs,
  parseSilenceLog,
  silenceDetectArgs,
  MIN_SILENCE_MS,
} from "../src/silence.js";

const SECOND = 1_000_000_000;

/** An ffmpeg log line as `silencedetect` actually writes it. */
function line(text: string): string {
  return `[silencedetect @ 000001f0a0] ${text}`;
}

describe("silenceDetectArgs", () => {
  it("asks for silence of at least 800 ms, which is the threshold the plan sets", () => {
    const args = silenceDetectArgs("mic.wav");
    expect(MIN_SILENCE_MS).toBe(800);
    expect(args.join(" ")).toContain("d=0.8");
  });

  it("writes no file — it is a probe over the input", () => {
    const args = silenceDetectArgs("mic.wav");
    expect(args).toContain("-i");
    expect(args).toContain("mic.wav");
    expect(args.join(" ")).toContain("-f null -");
  });

  it("carries the threshold in dB", () => {
    expect(silenceDetectArgs("mic.wav", 800, -40).join(" ")).toContain("noise=-40dB");
  });
});

describe("parseSilenceLog", () => {
  it("pairs each start with its end", () => {
    const log = [
      line("silence_start: 5"),
      line("silence_end: 8.5 | silence_duration: 3.5"),
      line("silence_start: 20.25"),
      line("silence_end: 22 | silence_duration: 1.75"),
    ].join("\n");
    expect(parseSilenceLog(log, 60 * SECOND)).toEqual([
      { startNs: 5 * SECOND, endNs: 8.5 * SECOND },
      { startNs: 20.25 * SECOND, endNs: 22 * SECOND },
    ]);
  });

  it("closes a silence the file ended in at the recording's duration", () => {
    // The case that matters: somebody stopped the recording a minute after the
    // meeting went quiet. ffmpeg reports the start and never the end.
    const log = line("silence_start: 50");
    expect(parseSilenceLog(log, 60 * SECOND)).toEqual([
      { startNs: 50 * SECOND, endNs: 60 * SECOND },
    ]);
  });

  it("clamps a negative start back to zero", () => {
    const log = [line("silence_start: -0.5"), line("silence_end: 2")].join("\n");
    expect(parseSilenceLog(log, 60 * SECOND)).toEqual([{ startNs: 0, endNs: 2 * SECOND }]);
  });

  it("clamps an end that runs past the recording", () => {
    const log = [line("silence_start: 55"), line("silence_end: 99")].join("\n");
    expect(parseSilenceLog(log, 60 * SECOND)).toEqual([
      { startNs: 55 * SECOND, endNs: 60 * SECOND },
    ]);
  });

  it("drops an interval that clamped to nothing", () => {
    const log = [line("silence_start: 80"), line("silence_end: 99")].join("\n");
    expect(parseSilenceLog(log, 60 * SECOND)).toEqual([]);
  });

  it("ignores every line that is not silencedetect's", () => {
    const log = ["ffmpeg version 7.0", "  Duration: 00:01:00.00", "frame=  100 fps=0.0"].join("\n");
    expect(parseSilenceLog(log, 60 * SECOND)).toEqual([]);
  });

  it("returns nothing for a log with no silence in it", () => {
    expect(parseSilenceLog("", 60 * SECOND)).toEqual([]);
  });

  it("returns the intervals in order", () => {
    const log = [
      line("silence_start: 30"),
      line("silence_end: 31"),
      line("silence_start: 5"),
      line("silence_end: 6"),
    ].join("\n");
    const parsed = parseSilenceLog(log, 60 * SECOND);
    expect(parsed.map((i) => i.startNs)).toEqual([5 * SECOND, 30 * SECOND]);
  });
});

describe("detectSilence", () => {
  it("probes the track and returns what the log said", async () => {
    let seen: readonly string[] = [];
    const run = async (args: readonly string[]): Promise<FfmpegResult> => {
      seen = args;
      return {
        code: 0,
        stdout: "",
        stderr: [line("silence_start: 1"), line("silence_end: 3")].join("\n"),
      };
    };
    const silences = await detectSilence(run, "system.wav", 10 * SECOND);
    expect(silences).toEqual([{ startNs: SECOND, endNs: 3 * SECOND }]);
    expect(seen).toContain("system.wav");
  });

  it("throws when ffmpeg could not read the track", async () => {
    const run = async (): Promise<FfmpegResult> => ({
      code: 1,
      stdout: "",
      stderr: "no such file",
    });
    await expect(detectSilence(run, "gone.wav", SECOND)).rejects.toThrow(/no such file/);
  });
});

describe("msToNs", () => {
  it("converts milliseconds to the nanoseconds every interval is in", () => {
    expect(msToNs(800)).toBe(800_000_000);
    expect(msToNs(0)).toBe(0);
  });
});
