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
  const tracks = expected.tracks ?? TRACKS;
  const wanted = planJournal(expected, journal.language).chunks;
  if (journal.chunks.length !== wanted.length) {
    return {
      ok: false,
      reason:
        `this journal covers ${journal.chunks.length} chunks across ${tracks.length} tracks ` +
        `and the recording now cuts into ${wanted.length} — the boundaries moved`,
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

export function isJournal(value: unknown): value is Journal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const journal = value as Partial<Journal>;
  if (journal.version !== 1) return false;
  if (journal.provider !== "groq" && journal.provider !== "whispercpp") return false;
  if (typeof journal.model !== "string" || typeof journal.language !== "string") return false;
  if (!Array.isArray(journal.chunks)) return false;
  return journal.chunks.every(
    (chunk) =>
      typeof chunk === "object" &&
      chunk !== null &&
      Number.isFinite(chunk.index) &&
      (chunk.track === "mic" || chunk.track === "system") &&
      Number.isFinite(chunk.compressedStartNs) &&
      Number.isFinite(chunk.compressedEndNs) &&
      typeof chunk.done === "boolean",
  );
}
