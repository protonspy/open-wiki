import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RecorderSegment } from "./compress.js";

/**
 * Reading what the recorder left behind (`crates/recorder/src/manifest.rs`).
 *
 * The field names are the Rust struct's, in snake_case, because serde writes
 * them that way and this is the wire between the two languages
 * `adr:0014-typescript-everywhere-except-audio-capture` accepts. Renaming them
 * here would put the mapping in two places at once.
 */

export interface RecorderTrackInfo {
  file: string;
  sample_rate: number;
  channels: number;
  frames: number;
}

export interface RecorderTimeMapSegment {
  recorded_start_ns: number;
  duration_ns: number;
  wall_start_ns: number;
}

export interface RecorderManifest {
  kind: string;
  title: string;
  started_wall_ns: number;
  tracks: { mic: RecorderTrackInfo; system: RecorderTrackInfo };
  first_frames: { mic_wall_ns: number | null; system_wall_ns: number | null };
  pauses: Array<{ start_wall_ns: number; end_wall_ns: number | null }>;
  device_changes: Array<{ track: string; device: string; recorded_ns: number }>;
  time_map: { segments: RecorderTimeMapSegment[] };
}

export const RECORDER_MANIFEST = "manifest.json";

export class NotARecordingError extends Error {
  constructor(dir: string) {
    super(`${dir} holds no recorder manifest — it is not a recording`);
    this.name = "NotARecordingError";
  }
}

export function readRecorderManifest(dir: string): RecorderManifest {
  const file = join(dir, RECORDER_MANIFEST);
  if (!existsSync(file)) throw new NotARecordingError(dir);
  const parsed = JSON.parse(readFileSync(file, "utf8")) as RecorderManifest;
  if (parsed.kind !== "recording") throw new NotARecordingError(dir);
  return parsed;
}

const NS_PER_MS = 1_000_000;
const NS_PER_SECOND = 1_000_000_000;

/**
 * How much audio the WAV files actually hold.
 *
 * Taken from the frame counts rather than from the time map: ffmpeg reads the
 * files, so the files are what its silence offsets are relative to. The two
 * tracks are the same length by construction — 4.1 manufactures silence for
 * whichever device delivered nothing — and taking the longer of them is the
 * safe reading of "by construction" if a build ever fails to honour it.
 */
export function recordedDurationNs(manifest: RecorderManifest): number {
  return Math.max(trackDurationNs(manifest.tracks.mic), trackDurationNs(manifest.tracks.system));
}

function trackDurationNs(track: RecorderTrackInfo): number {
  if (!track.sample_rate) return 0;
  return Math.round((track.frames / track.sample_rate) * NS_PER_SECOND);
}

/**
 * The recorder's capture stretches, with wall time brought down to
 * milliseconds (see the note on units in `timemap.ts`).
 *
 * The last segment is stretched to cover the whole of the audio when the map
 * stops short. The map is extended by the wall clock as frames arrive and the
 * files are measured in frames, so the two can disagree by whatever landed
 * after the final extension. Letting the map end first would drop that tail
 * out of the compressed timeline — audio present in the Opus that no instant
 * resolves into.
 */
export function recorderSegments(
  manifest: RecorderManifest,
  durationNs: number,
): RecorderSegment[] {
  const segments = manifest.time_map.segments
    .filter((s) => s.duration_ns > 0)
    .map((s) => ({
      recordedStartNs: s.recorded_start_ns,
      durationNs: s.duration_ns,
      wallStartMs: Math.round(s.wall_start_ns / NS_PER_MS),
    }));

  if (segments.length === 0) {
    // No map at all — a recording that stopped before the first extension.
    // One segment starting when the session did is the honest reading.
    return [
      {
        recordedStartNs: 0,
        durationNs,
        wallStartMs: Math.round(manifest.started_wall_ns / NS_PER_MS),
      },
    ];
  }

  const last = segments[segments.length - 1]!;
  const mapped = last.recordedStartNs + last.durationNs;
  if (mapped < durationNs) last.durationNs += durationNs - mapped;
  return segments;
}
