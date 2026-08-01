import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { planChunks, type ChunkOptions } from "./chunks.js";
import { planCompression } from "./compress.js";
import { encodeTrack, probeDurationNs, SAMPLE_PERIOD_NS } from "./encode.js";
import type { FfmpegRunner } from "./ffmpeg.js";
import { detectSilence, MIN_SILENCE_MS } from "./silence.js";
import { readRecorderManifest, recordedDurationNs, recorderSegments } from "./recording.js";
import { compressedDurationNs, formatInstant, TIMEMAP_FILE, type TimeMap } from "./timemap.js";

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

/**
 * How far the encoded file may differ from what the map says before the map is
 * refused.
 *
 * Not a tolerance for drift — the cut list is snapped to the output sample
 * grid, so agreement should be exact. It is slack for what a container legally
 * adds: Opus carries a pre-skip and rounds its duration to a page boundary, a
 * few milliseconds either way. A second is far above that and far below the
 * seconds a frame-quantised cut would accumulate, so this fires on a filter
 * that did not apply and stays quiet on a file that is simply encoded.
 */
export const DURATION_TOLERANCE_NS = 1_000_000_000;

export class TimeMapDisagreesError extends Error {
  constructor(file: string, expectedNs: number, actualNs: number) {
    super(
      `${file} is ${formatInstant(actualNs)} long but the time map says ` +
        `${formatInstant(expectedNs)}. Every provenance citation of this recording ` +
        `would point at the wrong instant, so no map was written.`,
    );
    this.name = "TimeMapDisagreesError";
  }
}

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
    sampleGridNs: SAMPLE_PERIOD_NS,
  });

  const micOpus = join(dir, MIC_OPUS);
  const systemOpus = join(dir, SYSTEM_OPUS);
  await encodeTrack(run, micWav, micOpus, plan.keeps, durationNs);
  await encodeTrack(run, systemWav, systemOpus, plan.keeps, durationNs);

  const expectedNs = compressedDurationNs(plan.segments);
  await assertAgrees(run, micOpus, expectedNs);
  await assertAgrees(run, systemOpus, expectedNs);

  const map: TimeMap = {
    version: 1,
    compressedDurationNs: expectedNs,
    segments: plan.segments,
    chunks: planChunks(plan.segments, options.chunks),
  };
  writeTimeMap(dir, map);
  return map;
}

/**
 * Refuse a map that does not describe the file it was written beside.
 *
 * The cut list and the encoder are built from the same sample indices, so this
 * should never fire. It exists because the one step nothing in this repository
 * can test is the step where ffmpeg is actually run, and a map that is wrong is
 * worse than a recording with no map at all — the citation resolves, opens the
 * audio, and plays the wrong moment.
 */
async function assertAgrees(run: FfmpegRunner, file: string, expectedNs: number): Promise<void> {
  const actualNs = await probeDurationNs(run, file);
  // A file ffmpeg would not describe is a problem for the encode step, which
  // already threw if it failed. Nothing is learned by refusing here too.
  if (actualNs === null) return;
  if (Math.abs(actualNs - expectedNs) > DURATION_TOLERANCE_NS) {
    throw new TimeMapDisagreesError(file, expectedNs, actualNs);
  }
}

/**
 * Write `timemap.json` so no reader sees half of it — `store/provenance.ts`
 * degrades on a map it cannot parse, and a half-written JSON file is what
 * produces that. See `atomic.ts`.
 */
function writeTimeMap(dir: string, map: TimeMap): void {
  writeAtomic(join(dir, TIMEMAP_FILE), `${JSON.stringify(map, null, 2)}\n`);
}
