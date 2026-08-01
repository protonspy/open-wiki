import { existsSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { isComplete, JOURNAL_FILE, readJournal, type Journal } from "./journal.js";
import { MIC_OPUS, SYSTEM_OPUS } from "./preprocess.js";
import { RECORDING_TEXT_FILE } from "./recording-text.js";
import { TIMELINE_FILE } from "./timeline.js";
import { TIMEMAP_FILE } from "./timemap.js";
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
 * So the order is the decision: **every chunk succeeded, and the Opus that
 * replaces the WAV is on disk, and every output is written, and only then.**
 *
 * It takes a project root and a source id rather than a directory. This is the
 * only destructive operation in the package, and `sources/manifest.ts` states
 * the rule it follows: an id is not a path, it reaches here out of a page's
 * prose or a caller's variable, and confining it is this module's job rather
 * than the caller's.
 */

export type SealResult = { sealed: true; deleted: string[] } | { sealed: false; reason: string };

export interface SealOptions {
  /**
   * The project's `deleteWavAfterTranscription` setting. False keeps the WAVs,
   * which is a choice someone with disk to spare is allowed to make; it does
   * not make the recording any less sealed.
   */
  deleteWav?: boolean;
}

/** The derived files a recording must have produced before its source can go. */
const REQUIRED_OUTPUTS = [TIMELINE_FILE, VTT_FILE, RECORDING_TEXT_FILE, TIMEMAP_FILE];

export class OutsideRawError extends Error {
  constructor(id: string) {
    super(`"${id}" does not name a source directory directly under raw/`);
    this.name = "OutsideRawError";
  }
}

/**
 * The confined directory of a source.
 *
 * Resolves the real path before comparing, so a junction or a symlink pointing
 * out of `raw/` is refused rather than followed — the same rule `paths.ts`
 * applies on the other side of the dependency, restated here because it runs
 * the other way. Exactly one segment: `raw/<id>`, never `raw/<id>/nested` and
 * never `raw/` itself.
 */
export function sourceDir(projectRoot: string, id: string): string {
  const rawDir = resolve(projectRoot, "raw");
  const realRaw = existsSync(rawDir) ? realpathSync(rawDir) : rawDir;
  const candidate = resolve(rawDir, id);
  const real = existsSync(candidate) ? realpathSync(candidate) : candidate;
  const rel = relative(realRaw, real);
  if (rel === "" || rel.startsWith("..") || rel.includes(sep)) throw new OutsideRawError(id);
  return real;
}

export function sealRecording(
  projectRoot: string,
  id: string,
  journal: Journal,
  options: SealOptions = {},
): SealResult {
  const dir = sourceDir(projectRoot, id);

  if (!isComplete(journal)) return incomplete(journal);
  // Re-read rather than trust the argument. This is the step that cannot be
  // undone, and the caller's in-memory journal is the same object it used to
  // build the timeline — checking that twice checks nothing. A journal already
  // removed by an earlier seal is fine; one on disk that disagrees is not.
  const onDisk = readJournal(dir);
  if (onDisk && !isComplete(onDisk)) return incomplete(onDisk);

  // The Opus is what the WAV is being traded for. `adr:0006` makes it the
  // whole reason the WAV is disposable — "provenance keeps working because the
  // Opus is what remains" — so it is checked before anything is removed.
  for (const track of tracksIn(journal)) {
    const opus = track === "mic" ? MIC_OPUS : SYSTEM_OPUS;
    if (!existsSync(join(dir, opus))) {
      return {
        sealed: false,
        reason: `${opus} is not there, and the WAV is the only other copy of this recording.`,
      };
    }
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
      // A directory named `something.wav` is not a track, and an entry that
      // vanished between the listing and here is not a reason to throw out of
      // the middle of the one step whose partial completion is hardest to
      // reason about.
      const stat = statSync(file, { throwIfNoEntry: false });
      if (!stat?.isFile()) continue;
      rmSync(file, { force: true });
      deleted.push(entry);
    }
  }

  // The journal goes too. `adr:0012` says a recording's directory "holds a
  // journal and a WAV that both disappear on completion" — and it says why
  // that matters: the text lives in two places until the source seals, only
  // the timeline may ever be read downstream, and a journal left behind is an
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

function incomplete(journal: Journal): SealResult {
  const done = journal.chunks.filter((c) => c.done).length;
  return {
    sealed: false,
    reason:
      `${done} of ${journal.chunks.length} chunks are transcribed. The WAV stays until ` +
      `every one has succeeded — it is the only copy of a meeting that already happened.`,
  };
}

/**
 * Which tracks this journal covers. A run over one track only says nothing
 * about the other's Opus, and must not be taken as permission to delete the
 * other's WAV.
 */
function tracksIn(journal: Journal): string[] {
  return [...new Set(journal.chunks.map((c) => c.track))];
}
