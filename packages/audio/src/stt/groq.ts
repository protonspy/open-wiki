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
  const doFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const attempts = Math.max(1, options.attempts ?? 3);
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

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
      // cannot end up in a log line or a redirect.
      headers: { authorization: `Bearer ${options.apiKey}` },
      body: form,
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
          if (!(e instanceof SttError) || !e.retryable || attempt === attempts) break;
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

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "(no body)";
  }
}
