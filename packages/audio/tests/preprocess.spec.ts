import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FfmpegResult, FfmpegRunner } from "../src/ffmpeg.js";
import {
  MIC_OPUS,
  preprocessRecording,
  SYSTEM_OPUS,
  TimeMapDisagreesError,
} from "../src/preprocess.js";
import {
  InvalidManifestError,
  NotARecordingError,
  readRecorderManifest,
  recordedDurationNs,
  recorderSegments,
  type RecorderManifest,
} from "../src/recording.js";
import { formatInstant, toWallMs, type TimeMap } from "../src/timemap.js";

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

  it("refuses a track whose file climbs out of the recording's directory", () => {
    // `raw/` is content: it arrives with a clone, a shared drive, a restored
    // backup. This field becomes an ffmpeg input path, and the encode of it
    // lands back inside `raw/` as a citable source.
    const m = manifest();
    m.tracks.mic.file = "../../../secrets.wav";
    write(m);
    expect(() => readRecorderManifest(dir)).toThrow(InvalidManifestError);
  });

  it("refuses a track whose file is an absolute path", () => {
    const m = manifest();
    m.tracks.system.file = "C:\\Windows\\System32\\config\\SAM";
    write(m);
    expect(() => readRecorderManifest(dir)).toThrow(InvalidManifestError);
  });

  it("refuses a track with no frame count to speak of", () => {
    const m = manifest();
    (m.tracks.mic as { frames: unknown }).frames = "lots";
    write(m);
    expect(() => readRecorderManifest(dir)).toThrow(InvalidManifestError);
  });

  it("refuses a manifest that names no tracks", () => {
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ kind: "recording" }), "utf8");
    expect(() => readRecorderManifest(dir)).toThrow(InvalidManifestError);
  });

  it("tolerates a missing time map rather than refusing the recording", () => {
    const m = manifest();
    delete (m as Partial<RecorderManifest>).time_map;
    write(m);
    expect(readRecorderManifest(dir).time_map.segments).toEqual([]);
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

  it("refuses a frame count that implies more audio than a day", () => {
    // The number sizes an allocation downstream: `planChunks` emits one object
    // per chunk, so a manifest claiming 1e24 frames asks for ~1e16 of them and
    // takes the process out on memory before the loop ends.
    const m = manifest();
    m.tracks.mic.frames = 1e24;
    expect(() => recordedDurationNs(m)).toThrow(InvalidManifestError);
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
  const silent5to10 = [
    "[silencedetect @ 1] silence_start: 5",
    "[silencedetect @ 1] silence_end: 10 | silence_duration: 5",
  ].join("\n");

  /**
   * ffmpeg standing in for the real one. It answers three shapes of call: the
   * silence probe (`-f null -`), the encode (`-c:a`), and the duration probe
   * (`-i` alone). The filter graph each encode was handed is captured by
   * reading the script *while the process is notionally running*, which is the
   * only moment it exists.
   */
  function fakeFfmpeg(options: { silence?: string[]; durationNs?: number } = {}) {
    const graphs = new Map<string, string>();
    let probe = 0;
    const durationNs = options.durationNs ?? s(15);
    const run: FfmpegRunner = async (args): Promise<FfmpegResult> => {
      if (args.includes("null")) {
        const log = options.silence?.[probe] ?? options.silence?.[0] ?? "";
        probe += 1;
        return { code: 0, stdout: "", stderr: log };
      }
      const script = args.indexOf("-/filter_complex");
      if (args.includes("-c:a")) {
        const output = args[args.length - 1]!;
        graphs.set(output, script >= 0 ? readFileSync(args[script + 1]!, "utf8") : "");
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: `  Duration: ${probeText(durationNs)}` };
    };
    return { run, graphs };
  }

  /** `HH:MM:SS.mm`, the form ffmpeg prints. */
  function probeText(ns: number): string {
    const totalMs = Math.round(ns / 1_000_000);
    const h = Math.floor(totalMs / 3_600_000);
    const m = Math.floor(totalMs / 60_000) % 60;
    const sec = Math.floor(totalMs / 1000) % 60;
    const cs = Math.floor((totalMs % 1000) / 10);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(sec)}.${pad(cs)}`;
  }

  it("writes a time map whose instants account for the silence it removed", async () => {
    write(manifest());
    const map = await preprocessRecording(fakeFfmpeg({ silence: [silent5to10] }).run, dir);

    expect(map.compressedDurationNs).toBe(s(15));
    // Compressed 6 s is recorded 11 s, 11 s after the recording began.
    expect(toWallMs(map, s(6))).toBe(1_011_000);
  });

  it("writes timemap.json beside the recording", async () => {
    write(manifest());
    await preprocessRecording(fakeFfmpeg({ silence: [silent5to10] }).run, dir);
    const onDisk = JSON.parse(readFileSync(join(dir, "timemap.json"), "utf8")) as TimeMap;
    expect(onDisk.version).toBe(1);
    expect(onDisk.segments).toHaveLength(2);
    expect(onDisk.chunks.length).toBeGreaterThan(0);
  });

  it("leaves no temporary file where a half-written map could be read as one", async () => {
    write(manifest());
    await preprocessRecording(fakeFfmpeg({ silence: [silent5to10] }).run, dir);
    expect(readdirSync(dir).filter((f) => f.startsWith(".ow-tmp-"))).toEqual([]);
  });

  it("gives both tracks the identical cut list", async () => {
    // `adr:0017-one-compressed-clock-for-both-tracks`. Cutting each track on
    // its own silence gives the two files different lengths and makes
    // `rec://<id>#14:32` ambiguous — so the two graphs have to be equal, not
    // merely both present.
    write(manifest());
    const { run, graphs } = fakeFfmpeg({ silence: [silent5to10] });
    await preprocessRecording(run, dir);

    const mic = graphs.get(join(dir, MIC_OPUS));
    const system = graphs.get(join(dir, SYSTEM_OPUS));
    expect(mic).toBeTruthy();
    expect(mic).toBe(system);
    expect(mic).toContain("end_sample=80000");
  });

  it("leaves the WAV files alone — discarding them is 4.14, after transcription", async () => {
    write(manifest());
    await preprocessRecording(fakeFfmpeg({ silence: [silent5to10] }).run, dir);
    expect(existsSync(join(dir, "mic.wav"))).toBe(true);
    expect(existsSync(join(dir, "system.wav"))).toBe(true);
  });

  it("cuts nothing when only one track was silent", async () => {
    write(manifest());
    const map = await preprocessRecording(
      fakeFfmpeg({ silence: [silent5to10, ""], durationNs: s(20) }).run,
      dir,
    );
    expect(map.compressedDurationNs).toBe(s(20));
    expect(map.segments).toHaveLength(1);
  });

  it("refuses to write a map that disagrees with the file it describes", async () => {
    // The one step nothing here can test is the step where ffmpeg is actually
    // run. A map that is wrong is worse than no map: the citation resolves,
    // opens the audio, and plays the wrong moment.
    write(manifest());
    const { run } = fakeFfmpeg({ silence: [silent5to10], durationNs: s(19) });
    await expect(preprocessRecording(run, dir)).rejects.toThrow(TimeMapDisagreesError);
    expect(existsSync(join(dir, "timemap.json"))).toBe(false);
  });

  it("says both lengths when it refuses", async () => {
    write(manifest());
    const { run } = fakeFfmpeg({ silence: [silent5to10], durationNs: s(19) });
    await expect(preprocessRecording(run, dir)).rejects.toThrow(formatInstant(s(15)));
  });

  it("accepts the few milliseconds an Opus container legally adds", async () => {
    write(manifest());
    const { run } = fakeFfmpeg({ silence: [silent5to10], durationNs: s(15) + 20_000_000 });
    await expect(preprocessRecording(run, dir)).resolves.toBeTruthy();
  });

  it("fails loudly when ffmpeg cannot read the recording", async () => {
    write(manifest());
    const run: FfmpegRunner = async () => ({ code: 1, stdout: "", stderr: "Invalid data" });
    await expect(preprocessRecording(run, dir)).rejects.toThrow(/Invalid data/);
    expect(existsSync(join(dir, "timemap.json"))).toBe(false);
  });
});
