import { join } from "node:path";
import type { Journal } from "./journal.js";
import { RECORDING_TEXT_FILE, renderRecordingText } from "./recording-text.js";
import { sealRecording, type SealRefusal } from "./seal.js";
import { buildTimeline, writeAtomic, writeTimeline, type Timeline } from "./timeline.js";
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
 */

export interface FinishOptions {
  /** The readable title from the source's manifest. */
  title: string;
  /** The project's `deleteWavAfterTranscription` setting. */
  deleteWav?: boolean;
}

export interface FinishResult {
  timeline: Timeline;
  seal: SealRefusal;
}

export function finishRecording(
  dir: string,
  journal: Journal,
  map: TimeMap,
  options: FinishOptions,
): FinishResult {
  const timeline = buildTimeline(journal, map);
  writeTimeline(dir, timeline);
  writeAtomic(join(dir, VTT_FILE), renderVtt(timeline));
  writeAtomic(join(dir, RECORDING_TEXT_FILE), renderRecordingText(timeline, options));

  // Last. `sealRecording` re-checks the journal and the outputs rather than
  // trusting that it was called at the right moment — it is the one step that
  // cannot be undone, so it does not take the caller's word for it.
  const seal = sealRecording(dir, journal, {
    ...(options.deleteWav !== undefined ? { deleteWav: options.deleteWav } : {}),
  });
  return { timeline, seal };
}
