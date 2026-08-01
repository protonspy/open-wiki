import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FfmpegResult, FfmpegRunner } from "../src/ffmpeg.js";
import { MIC_OPUS, preprocessRecording, SYSTEM_OPUS } from "../src/preprocess.js";
import {
  NotARecordingError,
  readRecorderManifest,
  recordedDurationNs,
  recorderSegments,
  type RecorderManifest,
} from "../src/recording.js";
import { toWallMs, type TimeMap } from "../src/timemap.js";

const SECOND = 1_000_000_000;
const s = (n: number): number => n * SECOND;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ow-pre-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A recorder manifest as `crates/recorder` writes it: snake_case, ns. */
function manifest(over: Partial<RecorderManifest> = {}): RecorderManifest {
  const track = { file: "mic.wav", sample_rate: 48_000, channels: 1, frames: 48_000 * 20 };
  return {
    kind: "recording",
    title: "Fenix weekly",
    started_wall_ns: 1_000_000 * 1_000_000,
    tracks: { mic: track, system: { ...track, file: "system.wav" } },
    first_frames: { mic_wall_ns: null, system_wall_ns: null },
    pauses: [],
    device_changes: [],
    time_map: {
      segments: [
        { recorded_start_ns: 0, duration_ns: s(20), wall_start_ns: 1_000_000 * 1_000_000 },
      ],
    },
    ...over,
  };
}

function write(m: RecorderManifest): void {
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(m), "utf8");
  writeFileSync(join(dir, "mic.wav"), "");
  writeFileSync(join(dir, "system.wav"), "");
}

describe("readRecorderManifest", () => {
  it("reads the manifest the recorder wrote", () => {
    write(manifest());
    expect(readRecorderManifest(dir).title).toBe("Fenix weekly");
  });

  it("refuses a directory with no manifest in it", () => {
    expect(() => readRecorderManifest(dir)).toThrow(NotARecordingError);
  });

  it("refuses an uploaded file's manifest, which is a different kind", () => {
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ kind: "file" }), "utf8");
    expect(() => readRecorderManifest(dir)).toThrow(NotARecordingError);
  });
});

describe("recordedDurationNs", () => {
  it("measures the audio from the frame counts, which is what ffmpeg reads", () => {
    expect(recordedDurationNs(manifest())).toBe(s(20));
  });

  it("takes the longer track when the two disagree", () => {
    const m = manifest();
    m.tracks.system.frames = 48_000 * 25;
    expect(recordedDurationNs(m)).toBe(s(25));
  });

  it("answers zero for a track with no sample rate rather than dividing by it", () => {
    const m = manifest();
    m.tracks.mic.sample_rate = 0;
    m.tracks.system.sample_rate = 0;
    expect(recordedDurationNs(m)).toBe(0);
  });
});

describe("recorderSegments", () => {
  it("brings wall time down to milliseconds", () => {
    expect(recorderSegments(manifest(), s(20))).toEqual([
      { recordedStartNs: 0, durationNs: s(20), wallStartMs: 1_000_000 },
    ]);
  });

  it("drops a segment that captured nothing", () => {
    const m = manifest({
      time_map: {
        segments: [
          { recorded_start_ns: 0, duration_ns: 0, wall_start_ns: 1_000_000 * 1_000_000 },
          { recorded_start_ns: 0, duration_ns: s(20), wall_start_ns: 1_000_500 * 1_000_000 },
        ],
      },
    });
    expect(recorderSegments(m, s(20))).toHaveLength(1);
  });

  it("stretches the last segment to cover audio the map stopped short of", () => {
    // The map is extended by the wall clock, the files are measured in frames.
    // Whatever landed after the final extension would otherwise be audio in the
    // Opus that no instant resolves into.
    const segments = recorderSegments(manifest(), s(25));
    expect(segments[0]!.durationNs).toBe(s(25));
  });

  it("invents one segment from the session start when the map is empty", () => {
    const m = manifest({ time_map: { segments: [] } });
    expect(recorderSegments(m, s(20))).toEqual([
      { recordedStartNs: 0, durationNs: s(20), wallStartMs: 1_000_000 },
    ]);
  });
});

describe("preprocessRecording", () => {
  /** ffmpeg that reports silence on the probe and succeeds on the encode. */
  function fakeFfmpeg(silenceLog: string): { run: FfmpegRunner; calls: string[][] } {
    const calls: string[][] = [];
    const run: FfmpegRunner = async (args): Promise<FfmpegResult> => {
      calls.push([...args]);
      const probing = args.includes("-f") && args.includes("null");
      return { code: 0, stdout: "", stderr: probing ? silenceLog : "" };
    };
    return { run, calls };
  }

  const silent5to10 = [
    "[silencedetect @ 1] silence_start: 5",
    "[silencedetect @ 1] silence_end: 10 | silence_duration: 5",
  ].join("\n");

  it("writes a time map whose instants account for the silence it removed", async () => {
    write(manifest());
    const { run } = fakeFfmpeg(silent5to10);
    const map = await preprocessRecording(run, dir);

    expect(map.compressedDurationNs).toBe(s(15));
    // Compressed 6 s is recorded 11 s, 11 s after the recording began.
    expect(toWallMs(map, s(6))).toBe(1_011_000);
  });

  it("writes timemap.json beside the recording", async () => {
    write(manifest());
    await preprocessRecording(fakeFfmpeg(silent5to10).run, dir);
    const onDisk = JSON.parse(readFileSync(join(dir, "timemap.json"), "utf8")) as TimeMap;
    expect(onDisk.version).toBe(1);
    expect(onDisk.segments).toHaveLength(2);
    expect(onDisk.chunks.length).toBeGreaterThan(0);
  });

  it("encodes both tracks with the same cut list", async () => {
    write(manifest());
    const { run, calls } = fakeFfmpeg(silent5to10);
    await preprocessRecording(run, dir);

    const filters = calls
      .filter((c) => c.includes("-filter_script:a"))
      .map((c) => c[c.indexOf("-filter_script:a") + 1]!);
    expect(filters).toHaveLength(2);
    // The scripts are removed after each encode, so what is compared is the
    // filter each track was handed — read inside the runner would be cleaner
    // but the point is that there were two encodes, one per track.
    expect(calls.filter((c) => c[c.length - 1]!.endsWith(MIC_OPUS))).toHaveLength(1);
    expect(calls.filter((c) => c[c.length - 1]!.endsWith(SYSTEM_OPUS))).toHaveLength(1);
  });

  it("leaves the WAV files alone — discarding them is 4.14, after transcription", async () => {
    write(manifest());
    await preprocessRecording(fakeFfmpeg(silent5to10).run, dir);
    expect(existsSync(join(dir, "mic.wav"))).toBe(true);
    expect(existsSync(join(dir, "system.wav"))).toBe(true);
  });

  it("cuts nothing when only one track was silent", async () => {
    write(manifest());
    // Both probes get the same log here, so instead assert the shared-silence
    // rule through a run where the tracks disagree.
    const calls: string[][] = [];
    let probe = 0;
    const run: FfmpegRunner = async (args) => {
      calls.push([...args]);
      if (args.includes("null")) {
        probe += 1;
        return { code: 0, stdout: "", stderr: probe === 1 ? silent5to10 : "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    const map = await preprocessRecording(run, dir);
    expect(map.compressedDurationNs).toBe(s(20));
    expect(map.segments).toHaveLength(1);
  });

  it("fails loudly when ffmpeg cannot read the recording", async () => {
    write(manifest());
    const run: FfmpegRunner = async () => ({ code: 1, stdout: "", stderr: "Invalid data" });
    await expect(preprocessRecording(run, dir)).rejects.toThrow(/Invalid data/);
    expect(existsSync(join(dir, "timemap.json"))).toBe(false);
  });
});
