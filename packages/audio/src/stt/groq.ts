import {
  FLAC_16K,
  secondsToNs,
  SttError,
  vocabularyPrompt,
  type AudioFormat,
  type SttProvider,
  type SttRequest,
  type SttResult,
  type SttSegment,
} from "./provider.js";

/**
 * Groq `whisper-large-v3-turbo` — the default provider (`docs/stack.md`):
 * ~US$0.04 an hour, ~228x real time, multilingual, which is what lets the
 * content language be a setting rather than a fixed choice.
 *
 * It is the only credential the application holds, so this is the one module
 * in the package that sends anything anywhere. `fetch` is injected: a test
 * that reaches the network is a test that fails when somebody is on a train.
 */

export const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
export const GROQ_MODEL = "whisper-large-v3-turbo";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface GroqOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  /** Attempts per chunk, including the first. */
  attempts?: number;
  /** Injected so a retry test does not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /** How long one attempt may take. A stalled socket must not hang the run. */
  timeoutMs?: number;
}

/**
 * A ten-minute chunk returns in about three seconds at Groq's ~228x real time.
 * Five minutes is far beyond slow and well short of forever — which is what a
 * request with no timeout is, and what `transcribeRecording` would wait for
 * with no journal write and no progress in the meantime.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

/** Enough of an error body to say what went wrong; not enough to be a problem. */
const MAX_ERROR_BODY_BYTES = 8 * 1024;

export class InsecureEndpointError extends Error {
  constructor(url: string) {
    super(`refusing to send the transcription credential to ${url}: it is not https`);
    this.name = "InsecureEndpointError";
  }
}

/** Whisper's `language` is ISO 639-1, so a region tag has to lose its region. */
export function toIso639(language: string): string {
  return language.split("-")[0]!.toLowerCase();
}

interface VerboseJson {
  text?: string;
  segments?: Array<{ start?: number; end?: number; text?: string }>;
}

export function createGroqProvider(options: GroqOptions): SttProvider {
  const model = options.model ?? GROQ_MODEL;
  const baseUrl = options.baseUrl ?? GROQ_URL;
  // The credential rides on every request, so the endpoint is checked once,
  // here, rather than trusted because it usually comes from a constant.
  if (!baseUrl.startsWith("https://")) throw new InsecureEndpointError(baseUrl);
  const doFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const attempts = Math.max(1, options.attempts ?? 3);
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  const audioFormat: AudioFormat = FLAC_16K;

  async function once(request: SttRequest): Promise<SttResult> {
    const form = new FormData();
    form.append("file", new Blob([request.audio as Uint8Array<ArrayBuffer>]), request.filename);
    form.append("model", model);
    form.append("response_format", "verbose_json");
    form.append("language", toIso639(request.language));
    const prompt = vocabularyPrompt(request.vocabulary);
    if (prompt) form.append("prompt", prompt);

    const response = await doFetch(baseUrl, {
      method: "POST",
      // The key goes in a header and never into the body or the URL, so it
      // cannot end up in a log line. `redirect: "error"` is what makes it not
      // end up in a redirect either: undici happens to strip `Authorization`
      // across origins today, but a transcription endpoint has no business
      // redirecting, and this makes that a property of the code rather than of
      // whichever fetch implementation is underneath.
      redirect: "error",
      headers: { authorization: `Bearer ${options.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const detail = await safeText(response);
      // 429 and 5xx are worth another attempt; 401 and 400 are not, and
      // retrying them just spends three times as long saying the same thing.
      const retryable = response.status === 429 || response.status >= 500;
      throw new SttError(`groq returned ${response.status}: ${detail}`, retryable);
    }

    return parseVerboseJson((await response.json()) as VerboseJson);
  }

  return {
    name: "groq",
    model,
    audioFormat,
    async transcribe(request) {
      let last: unknown;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          return await once(request);
        } catch (e) {
          last = e;
          if (!isRetryable(e) || attempt === attempts) break;
          // Exponential, so a rate limit that needs a moment gets one rather
          // than three requests in the same second.
          await sleep(2 ** (attempt - 1) * 1000);
        }
      }
      throw last;
    },
  };
}

/** The provider's answer, with its seconds turned into this package's nanoseconds. */
export function parseVerboseJson(body: VerboseJson): SttResult {
  const segments: SttSegment[] = [];
  for (const raw of body.segments ?? []) {
    const text = (raw.text ?? "").trim();
    if (!text) continue;
    segments.push({
      startNs: secondsToNs(raw.start ?? 0),
      endNs: secondsToNs(raw.end ?? raw.start ?? 0),
      text,
    });
  }
  return { segments, text: (body.text ?? segments.map((s) => s.text).join(" ")).trim() };
}

/**
 * Whether another attempt is worth making.
 *
 * `adr:0012` names "the network drops between chunk four and chunk five" as a
 * motivating failure, and a `fetch` that rejects for that reason throws a
 * `TypeError` or an `AbortError` — not an `SttError`. Retrying only on the
 * errors this module raised itself would give a 503 three attempts and the
 * most common transient failure exactly one.
 *
 * `InsecureEndpointError` never reaches here: it is thrown when the provider is
 * built, not when a request is made.
 */
function isRetryable(error: unknown): boolean {
  if (error instanceof SttError) return error.retryable;
  // Anything else came out of `fetch` — a socket, a name lookup, a timeout.
  return true;
}

async function safeText(response: Response): Promise<string> {
  try {
    const body = response.body;
    if (!body) return "(no body)";
    // Read up to a cap rather than reading it whole and slicing: a response
    // that streams indefinitely would otherwise be consumed to exhaustion
    // before the first character was thrown away.
    const reader = body.getReader();
    const parts: string[] = [];
    let size = 0;
    try {
      while (size < MAX_ERROR_BODY_BYTES) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        size += value.byteLength;
        parts.push(new TextDecoder().decode(value, { stream: true }));
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return parts.join("").slice(0, 500);
  } catch {
    return "(no body)";
  }
}
