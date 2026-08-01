import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { planChunks, type ChunkOptions } from "./chunks.js";
import { planCompression } from "./compress.js";
import { encodeTrack } from "./encode.js";
import type { FfmpegRunner } from "./ffmpeg.js";
import { detectSilence, MIN_SILENCE_MS } from "./silence.js";
import { readRecorderManifest, recordedDurationNs, recorderSegments } from "./recording.js";
import { compressedDurationNs, TIMEMAP_FILE, type TimeMap } from "./timemap.js";

/**
 * The whole of 4.6 and 4.7 in one call: two WAVs in, two Opus files and a
 * `timemap.json` out.
 *
 * It stops there. The WAVs stay where they are — deleting them is 4.14's job
 * and runs only once transcription has confirmed success, which
 * `adr:0006-opus-as-the-provenance-format` calls the most dangerous seam in
 * the decision.
 */

export const MIC_OPUS = "mic.opus";
export const SYSTEM_OPUS = "system.opus";

export interface PreprocessOptions {
  minSilenceMs?: number;
  chunks?: ChunkOptions;
}

export async function preprocessRecording(
  run: FfmpegRunner,
  dir: string,
  options: PreprocessOptions = {},
): Promise<TimeMap> {
  const manifest = readRecorderManifest(dir);
  const durationNs = recordedDurationNs(manifest);
  const minSilenceMs = options.minSilenceMs ?? MIN_SILENCE_MS;

  const micWav = join(dir, manifest.tracks.mic.file);
  const systemWav = join(dir, manifest.tracks.system.file);

  // Serial, not parallel: two ffmpeg processes decoding an hour of audio each
  // on a machine that is also holding a meeting is how the recording after
  // this one comes out with dropouts.
  const micSilence = await detectSilence(run, micWav, durationNs, minSilenceMs);
  const systemSilence = await detectSilence(run, systemWav, durationNs, minSilenceMs);

  const plan = planCompression({
    perTrackSilence: [micSilence, systemSilence],
    recordedDurationNs: durationNs,
    recorderSegments: recorderSegments(manifest, durationNs),
    minSilenceNs: minSilenceMs * 1_000_000,
  });

  await encodeTrack(run, micWav, join(dir, MIC_OPUS), plan.keeps, durationNs);
  await encodeTrack(run, systemWav, join(dir, SYSTEM_OPUS), plan.keeps, durationNs);

  const map: TimeMap = {
    version: 1,
    compressedDurationNs: compressedDurationNs(plan.segments),
    segments: plan.segments,
    chunks: planChunks(plan.segments, options.chunks),
  };
  // Written last, and only after both encodes returned. A map naming a file
  // that is not there yet would let a citation resolve against audio nothing
  // can open.
  writeFileSync(join(dir, TIMEMAP_FILE), `${JSON.stringify(map, null, 2)}\n`, "utf8");
  return map;
}
