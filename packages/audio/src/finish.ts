import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { isComplete, type Journal } from "./journal.js";
import { RECORDING_TEXT_FILE, renderRecordingText } from "./recording-text.js";
import { sealRecording, sourceDir, type SealResult } from "./seal.js";
import { buildTimeline, writeTimeline, type Timeline } from "./timeline.js";
import type { TimeMap } from "./timemap.js";
import { renderVtt, VTT_FILE } from "./vtt.js";

/**
 * Everything after the last chunk comes back: timeline, VTT, `text.md`, seal
 * (plan 4.12, 4.13, 4.14, 4.18).
 *
 * The order is the point and it is the order
 * `adr:0012-transcription-is-a-journalled-serial-pipeline` demands: the
 * outputs are written first and the WAV is discarded last, checked against the
 * journal rather than against the look of the directory. A crash anywhere in
 * here leaves a recording that can be finished; a crash with the steps the
 * other way round leaves one that cannot be recovered, because the meeting
 * already happened.
 *
 * It is separate from `transcribeRecording` because it is also what runs when
 * a *resumed* transcription completes — the last chunk of a run that started
 * yesterday reaches exactly here.
 *
 * **`text.md` is written only when the journal is complete.** It is the file
 * `sources/state.ts` reads to decide a source is `text-ready`, and it outranks
 * everything the journal says — so writing it for a run that stopped at chunk
 * four turns a half-transcribed recording into one that reads as finished,
 * with its 690 MB WAV still on disk under a source nobody will look at again.
 * That is exactly the failure `adr:0012` claims to convert from silent to
 * visible. The timeline and the VTT carry no such meaning and are written
 * either way, so a partial run is still inspectable.
 */

export interface FinishOptions {
  /** The readable title from the source's manifest. */
  title: string;
  /** The project's `deleteWavAfterTranscription` setting. */
  deleteWav?: boolean;
}

export interface FinishResult {
  timeline: Timeline;
  /** True once `text.md` is on disk — which only a complete journal produces. */
  textReady: boolean;
  seal: SealResult;
}

export function finishRecording(
  projectRoot: string,
  id: string,
  journal: Journal,
  map: TimeMap,
  options: FinishOptions,
): FinishResult {
  const dir = sourceDir(projectRoot, id);
  const timeline = buildTimeline(journal, map);
  writeTimeline(dir, timeline);
  writeAtomic(join(dir, VTT_FILE), renderVtt(timeline));

  const complete = isComplete(journal);
  if (complete) {
    writeAtomic(join(dir, RECORDING_TEXT_FILE), renderRecordingText(timeline, options));
  }

  // Last. `sealRecording` re-derives the directory, re-reads the journal from
  // disk and re-checks every output rather than trusting that it was called at
  // the right moment — it is the one step that cannot be undone, so it does
  // not take the caller's word for anything.
  const seal = sealRecording(projectRoot, id, journal, {
    ...(options.deleteWav !== undefined ? { deleteWav: options.deleteWav } : {}),
  });
  return { timeline, textReady: complete, seal };
}
