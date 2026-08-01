/**
 * The transcription boundary (plan 4.8).
 *
 * Two providers sit behind it and they are not variations on one theme: Groq
 * is an HTTP call that sends the audio to somebody else's machine, whisper.cpp
 * is a subprocess that keeps it here. `docs/stack.md` calls the local one "what
 * holds up the privacy argument without rewriting the pipeline" — this
 * interface is where that promise is kept, and it is why the pipeline above it
 * knows about neither.
 *
 * The interface is deliberately narrow: one chunk in, its text and its
 * segments out. Everything the plan calls for around it — journalling,
 * ordering, resuming, reconstructing absolute time — belongs to the pipeline,
 * because an adapter that also decided those would have to be written twice
 * and would drift on the second.
 */

/** What a provider wants a chunk delivered as. */
export interface AudioFormat {
  /** The container's extension, without the dot. */
  extension: string;
  /** The ffmpeg output options that produce it, after the cut. */
  ffmpegArgs: readonly string[];
}

/**
 * 16 kHz mono PCM. What whisper.cpp reads natively and the only thing some
 * builds read at all — no decode, no dependency, and lossless from the Opus so
 * the audio is never encoded twice.
 */
export const WAV_16K: AudioFormat = {
  extension: "wav",
  ffmpegArgs: ["-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"],
};

/**
 * FLAC, for a provider that uploads.
 *
 * The same samples as `WAV_16K` at roughly half the bytes. That matters
 * because a 15-minute chunk of 16 kHz mono PCM is about 28 MB and the upload
 * cap is 25 MB (`adr:0006-opus-as-the-provenance-format`) — the one chunk
 * length this pipeline is allowed to produce is the one that would not fit.
 * Re-encoding the Opus instead would be lossy twice over for no gain.
 */
export const FLAC_16K: AudioFormat = {
  extension: "flac",
  ffmpegArgs: ["-ac", "1", "-ar", "16000", "-c:a", "flac"],
};

export type ProviderName = "groq" | "whispercpp";

export interface SttRequest {
  /** One chunk, already cut out of the track in the provider's format. */
  audio: Uint8Array;
  /** The name the provider sees; its extension is how some pick a demuxer. */
  filename: string;
  /**
   * The content language, as configured
   * (`adr:0008-content-language-is-a-setting-english-by-default`). Sent rather
   * than left to detection — a provider guessing from thirty seconds of a
   * Portuguese meeting that opened in English gets it wrong for the whole
   * chunk, and nothing downstream can tell.
   */
  language: string;
  /**
   * Names already in the project's pages (plan 4.10). It is what stops the
   * project's own name from coming out wrong.
   */
  vocabulary: readonly string[];
}

/** One passage, timed **within the chunk**. Absolute time is 4.11's job. */
export interface SttSegment {
  startNs: number;
  endNs: number;
  text: string;
}

export interface SttResult {
  segments: SttSegment[];
  /** The whole chunk, for a provider or a chunk that produced no segments. */
  text: string;
}

export interface SttProvider {
  readonly name: ProviderName;
  /** Recorded in the journal; a change to it refuses a resume (plan 4.17). */
  readonly model: string;
  readonly audioFormat: AudioFormat;
  transcribe(request: SttRequest): Promise<SttResult>;
}

export class SttError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SttError";
  }
}

const NS_PER_SECOND = 1_000_000_000;

/** Seconds as the nanoseconds every offset in this package is in. */
export function secondsToNs(seconds: number): number {
  return Math.round(seconds * NS_PER_SECOND);
}

/** No single name is this long; one that is came from a hostile or broken page. */
export const MAX_NAME_CHARS = 64;

/**
 * About 250 tokens of names — a little over Whisper's window, so the budget is
 * spent rather than wasted, and bounded in *characters* because that is what
 * actually breaks: a multi-megabyte page title becomes a multi-megabyte form
 * field on the upload, and an argv value past Windows' 32 KB limit on the
 * local provider.
 */
export const MAX_PROMPT_CHARS = 1000;

/**
 * The prompt that carries the project's vocabulary.
 *
 * Both providers take a free-text prompt and use it to bias decoding, so this
 * is one string built one way rather than two adapters each inventing a
 * format.
 *
 * **The best names go last.** Whisper's prompt window holds only its *last*
 * 224 tokens, so anything that overflows is dropped from the front — and a
 * list carefully ordered best-first puts "Fenix" exactly where it gets thrown
 * away. `rankNames` orders them best-first because that is the useful order
 * for a caller to read; this reverses it, because that is the order the model
 * keeps. Getting this backwards degrades the feature precisely on the projects
 * with enough pages for it to matter.
 */
export function vocabularyPrompt(
  vocabulary: readonly string[],
  maxChars = MAX_PROMPT_CHARS,
): string {
  const kept: string[] = [];
  let used = 0;
  for (const raw of vocabulary) {
    const name = raw.trim().slice(0, MAX_NAME_CHARS);
    if (!name) continue;
    const cost = name.length + (kept.length > 0 ? 2 : 0);
    if (used + cost > maxChars) break;
    used += cost;
    kept.push(name);
  }
  // Taken best-first so the budget buys the best names, emitted worst-first so
  // the best are the ones nearest the end.
  return kept.reverse().join(", ");
}
