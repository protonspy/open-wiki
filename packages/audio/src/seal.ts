import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { isComplete, JOURNAL_FILE, type Journal } from "./journal.js";
import { RECORDING_TEXT_FILE } from "./recording-text.js";
import { TIMELINE_FILE } from "./timeline.js";
import { VTT_FILE } from "./vtt.js";

/**
 * Discarding the WAV (plan 4.14) — the most dangerous seam in
 * `adr:0006-opus-as-the-provenance-format`, in its own file so that the order
 * is readable in one screen.
 *
 * An hour of 48 kHz stereo WAV is ~690 MB and twenty meetings fill 14 GB, so
 * it cannot stay. And the deletion runs at exactly the point in the flow that
 * can be interrupted — application closed, machine shut down, transcription
 * that failed on one chunk and stopped halfway. Deleting early loses a meeting
 * that already happened and cannot be recorded again.
 *
 * So the order is the decision: **every chunk succeeded, and every output is
 * on disk, and only then.** `adr:0012` names the journal as the thing that
 * confirmation is checked against, which is why this takes one rather than
 * inspecting the directory and guessing.
 */

export type SealRefusal = { sealed: true; deleted: string[] } | { sealed: false; reason: string };

export interface SealOptions {
  /**
   * The project's `deleteWavAfterTranscription` setting. False keeps the WAVs,
   * which is a choice someone with disk to spare is allowed to make; it does
   * not make the recording any less sealed.
   */
  deleteWav?: boolean;
}

/** Everything the recording must have produced before its source can go. */
const REQUIRED_OUTPUTS = [TIMELINE_FILE, VTT_FILE, RECORDING_TEXT_FILE];

export function sealRecording(
  dir: string,
  journal: Journal,
  options: SealOptions = {},
): SealRefusal {
  if (!isComplete(journal)) {
    const done = journal.chunks.filter((c) => c.done).length;
    return {
      sealed: false,
      reason:
        `${done} of ${journal.chunks.length} chunks are transcribed. The WAV stays until ` +
        `every one has succeeded — it is the only copy of a meeting that already happened.`,
    };
  }
  for (const output of REQUIRED_OUTPUTS) {
    if (!existsSync(join(dir, output))) {
      return {
        sealed: false,
        reason: `${output} has not been written yet. The WAV stays until every output is on disk.`,
      };
    }
  }

  const deleted: string[] = [];
  if (options.deleteWav !== false) {
    for (const entry of readdirSync(dir)) {
      if (!entry.toLowerCase().endsWith(".wav")) continue;
      const file = join(dir, entry);
      // A directory named `something.wav` is not a track. `readdirSync` without
      // a `statSync` would have made that a recursive delete inside `raw/`.
      if (!statSync(file).isFile()) continue;
      rmSync(file, { force: true });
      deleted.push(entry);
    }
  }

  // The journal goes too. `adr:0012` says a recording's directory "holds a
  // journal and a WAV that both disappear on completion" — and it says why
  // that matters: the text lives in two places until the source seals, and
  // only the timeline may ever be read downstream. A journal left behind is an
  // invitation to read the copy.
  //
  // Last, and only after the WAVs: a crash between the two leaves a directory
  // whose journal still says the work is done, which is recoverable. The other
  // order leaves 690 MB nothing knows to collect.
  const journalFile = join(dir, JOURNAL_FILE);
  if (existsSync(journalFile)) {
    rmSync(journalFile, { force: true });
    deleted.push(JOURNAL_FILE);
  }
  return { sealed: true, deleted };
}
