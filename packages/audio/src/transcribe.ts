import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FfmpegRunner } from "./ffmpeg.js";
import { runOrThrow } from "./ffmpeg.js";
import {
  isComplete,
  journalMatches,
  pendingChunks,
  planJournal,
  readJournal,
  writeJournal,
  TRACKS,
  type Journal,
  type JournalChunk,
  type TrackName,
} from "./journal.js";
import { MIC_OPUS, SYSTEM_OPUS } from "./preprocess.js";
import type { AudioFormat, SttProvider } from "./stt/provider.js";
import type { TimeMap } from "./timemap.js";

/**
 * The serial, journalled transcription pipeline
 * (`adr:0012-transcription-is-a-journalled-serial-pipeline`, plan 4.9 and 4.17).
 *
 * One chunk at a time, and the journal written before the next one starts, so
 * an application killed mid-run loses at most the chunk in flight. Serial is
 * not a simplification: Groq runs at ~228x real time, so parallelism buys
 * seconds and multiplies the rate-limit errors the journal exists to survive,
 * and whisper.cpp already saturates every core on one chunk.
 */

const NS_PER_SECOND = 1_000_000_000;

/**
 * How many failures in a row before the run stops.
 *
 * One bad chunk must not strand the other nineteen — 6.3 offers "redo only
 * what failed" and that needs the rest attempted. But a bad credential fails
 * every chunk identically, and sending twenty requests to find that out is
 * both slow and, on a paid provider, expensive. Three in a row is the shape of
 * a systemic failure; one is the shape of a bad chunk.
 */
export const MAX_CONSECUTIVE_FAILURES = 3;

export class JournalMismatchError extends Error {
  constructor(reason: string) {
    super(
      `${reason}. Start this recording's transcription again from the beginning, ` +
        `or put the previous settings back.`,
    );
    this.name = "JournalMismatchError";
  }
}

export interface TranscribeOptions {
  /** The recording's directory under `raw/`. */
  dir: string;
  provider: SttProvider;
  /** `adr:0008` — sent as the hint rather than left to detection. */
  language: string;
  /** Names already in the project's pages (plan 4.10). */
  vocabulary?: readonly string[];
  map: TimeMap;
  run: FfmpegRunner;
  tracks?: readonly TrackName[];
  /** Throw away a journal that no longer matches instead of refusing (4.17). */
  restart?: boolean;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Transcribe what is left to transcribe, and return the journal.
 *
 * Resuming is the default and restarting is the exception: a recording opened
 * with a journal continues from where it stopped. A journal that no longer
 * describes the same work is refused rather than resumed — see
 * `journalMatches`.
 */
export async function transcribeRecording(options: TranscribeOptions): Promise<Journal> {
  const tracks = options.tracks ?? TRACKS;
  const expectation = {
    provider: options.provider.name,
    model: options.provider.model,
    chunks: options.map.chunks,
    tracks,
  };

  let journal = readJournal(options.dir);
  if (journal) {
    const match = journalMatches(journal, expectation);
    if (!match.ok) {
      if (!options.restart) throw new JournalMismatchError(match.reason);
      journal = null;
    }
  }
  if (!journal) {
    journal = planJournal(expectation, options.language);
    writeJournal(options.dir, journal);
  }

  const total = journal.chunks.length;
  let consecutiveFailures = 0;

  for (const chunk of pendingChunks(journal)) {
    try {
      const result = await transcribeChunk(options, chunk);
      chunk.text = result.text;
      chunk.segments = result.segments;
      chunk.done = true;
      delete chunk.error;
      consecutiveFailures = 0;
    } catch (e) {
      chunk.done = false;
      chunk.error = e instanceof Error ? e.message : String(e);
      consecutiveFailures += 1;
    }
    // Written before the next chunk starts. This line is the whole record.
    writeJournal(options.dir, journal);
    options.onProgress?.(journal.chunks.filter((c) => c.done).length, total);
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break;
  }

  return journal;
}

/** Cut one chunk out of its track and send it. */
async function transcribeChunk(options: TranscribeOptions, chunk: JournalChunk) {
  const format = options.provider.audioFormat;
  const dir = mkdtempSync(join(tmpdir(), "ow-chunk-"));
  const file = join(dir, `chunk-${chunk.index}.${format.extension}`);
  try {
    await runOrThrow(
      options.run,
      extractChunkArgs(join(options.dir, trackFile(chunk.track)), chunk, file, format),
    );
    return await options.provider.transcribe({
      audio: readFileSync(file),
      filename: `chunk-${chunk.index}.${format.extension}`,
      language: options.language,
      vocabulary: options.vocabulary ?? [],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function trackFile(track: TrackName): string {
  return track === "mic" ? MIC_OPUS : SYSTEM_OPUS;
}

/**
 * The ffmpeg invocation that cuts one chunk out of a track.
 *
 * `-ss` comes *after* `-i`, which makes the seek accurate rather than
 * packet-aligned. A packet-aligned seek is up to 20 ms off, and a chunk
 * boundary here sits between two stretches of speech with the silence already
 * removed — 20 ms is a clipped syllable at each end, on every chunk.
 *
 * The chunk is decoded to the provider's format rather than copied. Copying
 * would hand the provider Opus, which is what it already is — but cutting Opus
 * without re-encoding cannot be accurate, and re-encoding Opus to Opus is lossy
 * twice for nothing.
 */
export function extractChunkArgs(
  source: string,
  chunk: { compressedStartNs: number; compressedEndNs: number },
  output: string,
  format: AudioFormat,
): string[] {
  return [
    "-hide_banner",
    "-nostats",
    "-y",
    "-i",
    source,
    "-ss",
    seconds(chunk.compressedStartNs),
    "-to",
    seconds(chunk.compressedEndNs),
    ...format.ffmpegArgs,
    output,
  ];
}

function seconds(ns: number): string {
  return (ns / NS_PER_SECOND).toFixed(6);
}

export { isComplete };
