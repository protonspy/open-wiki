import { spawn } from "node:child_process";
import { createGroqProvider, type GroqOptions } from "./groq.js";
import { createWhisperCppProvider, type WhisperCppOptions } from "./whispercpp.js";
import type { ProviderName, SttProvider } from "./provider.js";

/**
 * Choosing the provider from configuration (plan 4.8).
 *
 * The two are swapped here and nowhere else, so the pipeline above never
 * branches on which one it got. That is what makes "the audio never leaves the
 * machine" a setting rather than a fork of the code.
 */

export interface SttConfig {
  provider: ProviderName;
  /** Groq's, and the application's only credential. Unused by whisper.cpp. */
  apiKey?: string;
  model?: string;
  /** whisper.cpp only: where its executable and GGML model are. */
  whisperExe?: string;
  whisperModel?: string;
}

export class MissingCredentialError extends Error {
  constructor() {
    super(
      "the Groq provider needs an API key. Add one in the application's settings, " +
        "or choose whisper.cpp, which needs no credential and keeps the audio here.",
    );
    this.name = "MissingCredentialError";
  }
}

export class MissingWhisperPathError extends Error {
  constructor() {
    super(
      "the whisper.cpp provider needs the path to its executable and its model. " +
        "Neither is bundled — they are large and the choice of model is the user's.",
    );
    this.name = "MissingWhisperPathError";
  }
}

export interface CreateProviderDeps {
  groq?: (options: GroqOptions) => SttProvider;
  whispercpp?: (options: WhisperCppOptions) => SttProvider;
  run?: WhisperCppOptions["run"];
}

/**
 * Run the local binary. It is the default rather than an injected dependency
 * so that a provider can be built from configuration alone — which is the
 * whole job of this function. A caller that forgot to pass a spawn seam should
 * get a working provider, not a message telling them to fix settings that are
 * already right.
 */
function defaultSpawn(): WhisperCppOptions["run"] {
  return async (exe, args) =>
    new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(exe, [...args], { windowsHide: true });
      let stderr = "";
      child.stderr.on("data", (d: Buffer) => {
        // Bounded for the same reason `spawnFfmpeg` bounds its own: a run over
        // a damaged file emits a line per bad frame.
        stderr = (stderr + d.toString("utf8")).slice(-MAX_STDERR_CHARS);
      });
      child.on("error", rejectPromise);
      child.on("close", (code) => resolvePromise({ code: code ?? -1, stderr }));
    });
}

const MAX_STDERR_CHARS = 64 * 1024;

export function createProvider(config: SttConfig, deps: CreateProviderDeps = {}): SttProvider {
  if (config.provider === "groq") {
    if (!config.apiKey) throw new MissingCredentialError();
    const make = deps.groq ?? createGroqProvider;
    return make({
      apiKey: config.apiKey,
      ...(config.model ? { model: config.model } : {}),
    });
  }
  if (!config.whisperExe || !config.whisperModel) throw new MissingWhisperPathError();
  const make = deps.whispercpp ?? createWhisperCppProvider;
  return make({
    exe: config.whisperExe,
    modelPath: config.whisperModel,
    run: deps.run ?? defaultSpawn(),
  });
}

export * from "./provider.js";
export {
  createGroqProvider,
  parseVerboseJson,
  toIso639,
  DEFAULT_REQUEST_TIMEOUT_MS,
  GROQ_MODEL,
  GROQ_URL,
  InsecureEndpointError,
} from "./groq.js";
export {
  createWhisperCppProvider,
  parseWhisperJson,
  WhisperCppMissingError,
  type WhisperCppOptions,
  type SpawnLike,
} from "./whispercpp.js";
export type { GroqOptions, FetchLike } from "./groq.js";
