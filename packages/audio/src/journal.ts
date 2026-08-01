import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderName, SttSegment } from "./stt/provider.js";
import type { Chunk } from "./timemap.js";

/**
 * The transcription journal — `adr:0012-transcription-is-a-journalled-serial-pipeline`.
 *
 * Transcribing an hour of meeting is the one operation in this product that
 * costs money, takes real time, and can be interrupted halfway. The journal is
 * what makes an interrupted run cost nothing to finish: every chunk's result is
 * on disk before the next one starts, so an application killed mid-run loses at
 * most the chunk in flight.
 *
 * It lives in the recording's own directory, beside the audio it describes, so
 * an interrupted recording is one directory a person can inspect or delete.
 *
 * **`sources/state.ts` reads this file too**, for the progress a sources screen
 * renders, and it does so through its own idea of the shape — `chunks[].done`
 * and `chunks[].error`. That is a contract between two modules and not an
 * accident; a field rename here changes what a stalled recording looks like
 * there.
 */

export type TrackName = "mic" | "system";

/**
 * Both tracks are transcribed. 4.12 labels a passage `me` or `remote` by the
 * track it came from, which is only possible if each was read on its own —
 * and `adr:0006-opus-as-the-provenance-format` keeps them separate precisely
 * so that a recording can be re-read with better attribution later.
 */
export const TRACKS: readonly TrackName[] = ["mic", "system"];

export const JOURNAL_FILE = "journal.json";

/** One unit of work: one chunk of one track. */
export interface JournalChunk {
  /** Unique across the journal. What a progress count addresses. */
  index: number;
  track: TrackName;
  compressedStartNs: number;
  compressedEndNs: number;
  done: boolean;
  text?: string;
  segments?: SttSegment[];
  error?: string;
}

export interface Journal {
  version: 1;
  provider: ProviderName;
  model: string;
  language: string;
  chunks: JournalChunk[];
}

/** What a resume expects the journal to describe. */
export interface JournalExpectation {
  provider: ProviderName;
  model: string;
  chunks: readonly Chunk[];
  tracks?: readonly TrackName[];
  /**
   * The content language now configured. `adr:0012` names the provider, the
   * model and the boundaries; this is the same class of mismatch and is
   * checked with them — resuming a `pt-BR` journal after the setting moved to
   * English produces one transcript in two languages, which reads as one.
   */
  language?: string;
}

export type JournalMatch = { ok: true } | { ok: false; reason: string };

/** A fresh journal: every chunk of every track, nothing done. */
export function planJournal(expected: JournalExpectation, language: string): Journal {
  const tracks = expected.tracks ?? TRACKS;
  const chunks: JournalChunk[] = [];
  for (const track of tracks) {
    for (const chunk of expected.chunks) {
      chunks.push({
        index: chunks.length,
        track,
        compressedStartNs: chunk.compressedStartNs,
        compressedEndNs: chunk.compressedEndNs,
        done: false,
      });
    }
  }
  return { version: 1, provider: expected.provider, model: expected.model, language, chunks };
}

/**
 * Whether a journal describes the same work (plan 4.17).
 *
 * Resuming across a changed segmentation stitches text from two different cuts
 * into one timeline — which produces a plausible, readable, wrong result with
 * correct-looking timestamps, and nothing downstream can tell. The same goes
 * for a changed provider or model: two models' output in one transcript reads
 * as one voice.
 *
 * So this refuses and the caller offers a clean restart, rather than guessing.
 */
export function journalMatches(journal: Journal, expected: JournalExpectation): JournalMatch {
  if (journal.provider !== expected.provider) {
    return {
      ok: false,
      reason:
        `this journal was written by ${journal.provider} and the provider is now ` +
        `${expected.provider} — resuming would put two models' output in one timeline`,
    };
  }
  if (journal.model !== expected.model) {
    return {
      ok: false,
      reason:
        `this journal was written by model ${journal.model} and the model is now ` +
        `${expected.model} — resuming would put two models' output in one timeline`,
    };
  }
  if (expected.language !== undefined && journal.language !== expected.language) {
    return {
      ok: false,
      reason:
        `this journal was written for ${journal.language} and the content language is now ` +
        `${expected.language} — resuming would produce one transcript in two languages`,
    };
  }
  const tracks = expected.tracks ?? TRACKS;
  const wanted = planJournal(expected, journal.language).chunks;
  if (journal.chunks.length !== wanted.length) {
    // Counted in cuts, not in units of work: the user recognises "the
    // recording cuts into 3 chunks", not the 6 requests that makes over two
    // tracks.
    return {
      ok: false,
      reason:
        `this journal covers ${journal.chunks.length / tracks.length} chunks and the ` +
        `recording now cuts into ${expected.chunks.length} — the boundaries moved`,
    };
  }
  for (const [i, chunk] of journal.chunks.entries()) {
    const want = wanted[i]!;
    if (
      chunk.track !== want.track ||
      chunk.compressedStartNs !== want.compressedStartNs ||
      chunk.compressedEndNs !== want.compressedEndNs
    ) {
      return {
        ok: false,
        reason:
          `chunk ${i} of this journal covers a different stretch of the recording than the ` +
          `current boundaries do — every offset inside it would mean something else`,
      };
    }
  }
  return { ok: true };
}

/** What still has to be sent: never attempted, or attempted and failed. */
export function pendingChunks(journal: Journal): JournalChunk[] {
  return journal.chunks.filter((chunk) => !chunk.done);
}

/** True when every unit succeeded — what 4.14 checks before deleting the WAV. */
export function isComplete(journal: Journal): boolean {
  return journal.chunks.length > 0 && journal.chunks.every((chunk) => chunk.done);
}

export function journalPath(dir: string): string {
  return join(dir, JOURNAL_FILE);
}

/**
 * Read the journal, or `null` when there is not a usable one.
 *
 * Every failure reads as absent: no file, unparseable, or parsed into
 * something that is not a journal. A cast is not a check, and this one decides
 * whether a paid-for hour of transcription is resumed or thrown away.
 */
export function readJournal(dir: string): Journal | null {
  try {
    const file = journalPath(dir);
    if (!existsSync(file)) return null;
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return isJournal(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Write the journal through a temporary file and a rename.
 *
 * It is rewritten after every chunk, which makes it the file in this product
 * most likely to be caught mid-write by a machine going down — and a truncated
 * journal reads as no journal, which throws away everything already paid for.
 */
export function writeJournal(dir: string, journal: Journal): void {
  const target = journalPath(dir);
  const temp = `${target}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
    renameSync(temp, target);
  } catch (e) {
    rmSync(temp, { force: true });
    throw e;
  }
}

/**
 * Whether a parsed value is a journal this version can act on.
 *
 * It validates the content fields as well as the scheduling ones, which is
 * not tidiness. `text` and `segments` are what end up in the timeline and then
 * in a wiki page, carrying wall-clock provenance derived from the real time
 * map — and a journal marked complete makes 4.14 delete 690 MB of source audio
 * without a provider ever having been called. A guard that returns
 * `value is Journal` while never looking at those three fields hands every
 * consumer a `string` that is a number and an array that is a string.
 */
export function isJournal(value: unknown): value is Journal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const journal = value as Partial<Journal>;
  if (journal.version !== 1) return false;
  if (journal.provider !== "groq" && journal.provider !== "whispercpp") return false;
  if (typeof journal.model !== "string" || typeof journal.language !== "string") return false;
  if (!Array.isArray(journal.chunks)) return false;
  if (journal.chunks.length > MAX_CHUNKS) return false;
  return journal.chunks.every(isJournalChunk);
}

/**
 * A day of audio at the 10-minute chunks 4.7 plans, over two tracks, is under
 * 300. The bound is here because the array sizes every loop that walks it.
 */
const MAX_CHUNKS = 10_000;

function isJournalChunk(chunk: unknown): chunk is JournalChunk {
  if (typeof chunk !== "object" || chunk === null) return false;
  const c = chunk as Partial<JournalChunk>;
  if (!Number.isFinite(c.index)) return false;
  if (c.track !== "mic" && c.track !== "system") return false;
  if (!Number.isFinite(c.compressedStartNs) || !Number.isFinite(c.compressedEndNs)) return false;
  if (typeof c.done !== "boolean") return false;
  if (c.text !== undefined && typeof c.text !== "string") return false;
  if (c.error !== undefined && typeof c.error !== "string") return false;
  if (c.segments !== undefined) {
    if (!Array.isArray(c.segments)) return false;
    if (!c.segments.every(isSegment)) return false;
  }
  return true;
}

function isSegment(segment: unknown): segment is SttSegment {
  if (typeof segment !== "object" || segment === null) return false;
  const s = segment as Partial<SttSegment>;
  return Number.isFinite(s.startNs) && Number.isFinite(s.endNs) && typeof s.text === "string";
}
