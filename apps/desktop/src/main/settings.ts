import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
  LANGUAGES,
  ProjectRegistry,
  readSettings,
  scaffold,
  scaffoldSkills,
  writeClaudeMd,
  writeIgnore,
  writeSettings,
  type Language,
} from "@open-wiki/access";
// The one import of the secret in the whole product. `config/secrets.ts` says
// the CLI, the hooks and the MCP process must not read it — their stderr is
// consumed by an agent and travels to a model provider. It is reached through
// a named subpath rather than the barrel so that stays visible in one grep.
import {
  defaultAppDataDir,
  readSecrets,
  writeSecrets,
  type ProjectSecrets,
  type SttSecret,
} from "@open-wiki/access/secrets";
import { GROQ_URL, type FetchLike } from "@open-wiki/audio";
import {
  DEFAULT_MODEL,
  parseModelList,
  readAgentPrefs,
  resolveModel,
  writeAgentPrefs,
  type AgentPrefs,
} from "./agent/agent-prefs.js";

/**
 * The credential (plan 8.3), the launcher (8.4) and the content language
 * (8.12).
 *
 * **This is the module that reads the secret, and the only one.**
 * `config/secrets.ts` states the rule: the CLI, the hooks and the MCP process
 * must not, because their stderr is consumed by an agent and travels to a
 * model provider. The desktop application is the exception, and it is this
 * file — which is why nothing here is re-exported to the renderer, and why
 * `credentialState` answers *whether* there is a key rather than what it is.
 */

/** What the settings screen may know about the credential. Never the key. */
export interface CredentialState {
  provider: SttSecret["provider"] | null;
  /** True when a key is stored. The key itself never crosses the bridge. */
  hasKey: boolean;
}

export function credentialState(projectRoot: string, appDataDir?: string): CredentialState {
  const secrets = readSecrets(projectRoot, appDataDir ?? defaultAppDataDir());
  if (!secrets?.stt) return { provider: null, hasKey: false };
  return { provider: secrets.stt.provider, hasKey: Boolean(secrets.stt.apiKey) };
}

/**
 * The credential check doubles as the model-list fetch (R2.5, 5.4): a successful
 * `GET /models` proves the key and returns the catalogue, so the list comes
 * back with the verdict and is persisted beside the secrets file.
 */
export type CredentialCheck = { ok: true; models: string[] } | { ok: false; reason: string };

export interface SaveCredentialInput {
  provider: SttSecret["provider"];
  /** Absent for whisper.cpp, which needs no credential at all. */
  apiKey?: string;
}

export interface CredentialDeps {
  fetch?: FetchLike;
  appDataDir?: string;
}

/**
 * Validate a Groq key **on the spot** and store it only if it works.
 *
 * The plan says "typed and validated on the spot" and that is the whole point:
 * a key that is wrong is discovered now, at the settings screen with the user
 * looking at it, rather than an hour later when a meeting has been recorded
 * and the transcription of it fails on every chunk. `adr:0012`'s journal makes
 * that recoverable; it does not make it pleasant.
 *
 * The check is a `GET` of the models list rather than a transcription: it
 * costs nothing, it needs no audio, and a 401 from it means exactly what a 401
 * from the real call would mean.
 */
/** No key is this long; one that is did not come from a person typing. */
const MAX_KEY_CHARS = 512;

/**
 * What the renderer sent, or a refusal.
 *
 * Every other channel coerces its arguments; this one used to cast an
 * arbitrary value straight through — so `provider: "bogus"` took the Groq
 * branch and was then *stored* as `"bogus"`, and a `whispercpp` request
 * persisted whatever `apiKey` came with it without checking anything at all.
 */
export function parseCredentialInput(value: unknown): SaveCredentialInput | null {
  if (typeof value !== "object" || value === null) return null;
  const input = value as Partial<SaveCredentialInput>;
  if (input.provider !== "groq" && input.provider !== "whispercpp") return null;
  if (input.provider === "whispercpp") return { provider: "whispercpp" };
  if (typeof input.apiKey !== "string" || input.apiKey.length > MAX_KEY_CHARS) return null;
  return { provider: "groq", apiKey: input.apiKey };
}

export async function checkCredential(
  input: SaveCredentialInput,
  deps: CredentialDeps = {},
): Promise<CredentialCheck> {
  if (input.provider === "whispercpp") {
    // No *credential*, which is not the same as nothing to check. The binary
    // and the model are not bundled — they are large and the size-against-
    // accuracy choice is the user's — and `createProvider` refuses without
    // both. Accepting the choice here and failing an hour later, after a
    // meeting has been recorded, is the shape of a promise this screen has no
    // business making.
    return {
      ok: false,
      reason:
        "whisper.cpp is not bundled: install it and set OPEN_WIKI_WHISPER and " +
        "OPEN_WIKI_WHISPER_MODEL, or use Groq. It needs no credential, but it " +
        "does need a binary and a model.",
    };
  }
  if (!input.apiKey) return { ok: false, reason: "a Groq key is needed, or choose whisper.cpp" };

  const url = modelsUrl();
  // The same assertion `groq.ts` makes, and for the same reason it wrote down:
  // the credential rides on the request, so the endpoint is checked here rather
  // than trusted because it usually comes from a constant.
  if (!url.startsWith("https://")) {
    return { ok: false, reason: "refusing to send the credential over plain http" };
  }
  const doFetch = deps.fetch ?? ((url2, init) => fetch(url2, init));
  try {
    const response = await doFetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${input.apiKey}` },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      // The validation call is the model-list fetch (R2.5, 5.4). A body that
      // does not parse still validates the key — the list is empty, not wrong.
      let models: string[] = [];
      try {
        models = parseModelList(await response.json());
      } catch {
        models = [];
      }
      return { ok: true, models };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: "Groq did not accept that key" };
    }
    return { ok: false, reason: `Groq answered ${response.status}` };
  } catch {
    // A key that could not be checked is not a key that is wrong. Saying so
    // matters: refusing to store it because the user is on a train would be
    // this screen inventing a policy nobody asked for.
    return { ok: false, reason: "could not reach Groq to check the key" };
  }
}

/** The models endpoint sits beside the transcription one. */
function modelsUrl(): string {
  return GROQ_URL.replace(/\/audio\/transcriptions$/, "/models");
}

/**
 * Store the credential, having checked it.
 *
 * It goes to the application's data directory keyed by project path — never
 * into the project directory, unconditionally, because `git init` a week later
 * turns a conditional rule into a leak (plan 2.7,
 * `adr:0007-plaintext-credentials-in-the-config`).
 */
export async function saveCredential(
  projectRoot: string,
  input: SaveCredentialInput,
  deps: CredentialDeps = {},
): Promise<CredentialCheck> {
  const check = await checkCredential(input, deps);
  if (!check.ok) return check;
  const secrets: ProjectSecrets = {
    stt: { provider: input.provider, apiKey: input.apiKey ?? "" },
  };
  writeSecrets(projectRoot, secrets, deps.appDataDir ?? defaultAppDataDir());

  // The validation call doubled as the model-list fetch (5.4): persist the list
  // beside the secrets file, with the default selected. whisper.cpp carries no
  // agent model — its list stays empty and the agent refuses to run for it
  // (R2.4, 5.3).
  if (input.provider === "groq") {
    writeAgentPrefs(
      projectRoot,
      {
        models: check.models,
        selectedModel: resolveModel({ models: check.models, selectedModel: "" }),
      },
      deps.appDataDir ?? defaultAppDataDir(),
    );
  }
  return { ok: true, models: check.models };
}

/**
 * The agent's model list and current selection, for the settings screen (R2.5).
 * Empty when no Groq credential has been saved — the screen shows nothing to
 * pick until a key is checked, which is also when the agent can run.
 */
export function agentModels(
  projectRoot: string,
  appDataDir: string = defaultAppDataDir(),
): AgentPrefs {
  const prefs = readAgentPrefs(projectRoot, appDataDir);
  if (prefs) return prefs;
  return { models: [], selectedModel: DEFAULT_MODEL };
}

/**
 * Record the model the user picked from the list (R2.5). The selection must be
 * one Groq offered — a model the catalogue never returned is refused, so a stale
 * dropdown choice or a hand-edited value cannot become the agent's model.
 */
export function selectAgentModel(
  projectRoot: string,
  model: string,
  appDataDir: string = defaultAppDataDir(),
): AgentPrefs {
  const prefs = readAgentPrefs(projectRoot, appDataDir);
  const models = prefs?.models ?? [];
  if (!models.includes(model)) {
    throw new Error(`"${model}" is not one of the models Groq offered for this project`);
  }
  const next: AgentPrefs = { models, selectedModel: model };
  writeAgentPrefs(projectRoot, next, appDataDir);
  return next;
}

/**
 * Change the content language (plan 8.12).
 *
 * It reaches exactly two places — `adr:0008` is explicit — and one of them has
 * to be rewritten when it changes: `CLAUDE.md` is *generated*, so it carries
 * the language and must be regenerated. The skills are not generated and are
 * left alone, which is the distinction 9.4 draws.
 */
export function setLanguage(projectRoot: string, language: Language): Language {
  if (!LANGUAGES.includes(language)) {
    throw new Error(`unknown language "${language}" — one of ${LANGUAGES.join(", ")}`);
  }
  const settings = writeSettings(projectRoot, { language });
  writeClaudeMd(projectRoot, settings.language);
  return settings.language;
}

export function currentLanguage(projectRoot: string): Language {
  return readSettings(projectRoot).language;
}

/** One entry in the launcher (plan 8.4). */
export interface KnownProject {
  name: string;
  path: string;
  /** False when the directory moved or was deleted since it was registered. */
  present: boolean;
}

/**
 * The projects this machine knows about.
 *
 * The registry "is a cache, never truth" (plan 2.2), so a directory that moved
 * degrades to a refusal rather than a search — and the launcher renders that
 * as an entry it will not open, rather than hiding it. Hiding it would leave
 * the user wondering where their project went; showing it says what happened.
 */
export function knownProjects(appDataDir?: string): KnownProject[] {
  const registry = new ProjectRegistry(appDataDir ?? defaultAppDataDir());
  return registry.known().map((name) => {
    try {
      return { name, path: registry.resolve(name), present: true };
    } catch {
      return { name, path: "", present: false };
    }
  });
}

/** The registry's own rule, applied before anything is written. */
const PROJECT_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export class InvalidProjectNameError extends Error {
  constructor(name: string) {
    super(`"${name}" is not a project name — letters, digits, dot, dash and underscore`);
    this.name = "InvalidProjectNameError";
  }
}

function assertProjectName(name: string): void {
  if (!PROJECT_NAME.test(name)) throw new InvalidProjectNameError(name);
}

export class RelativeProjectPathError extends Error {
  constructor(directory: string) {
    super(`"${directory}" is not an absolute path — say where the project should live`);
    this.name = "RelativeProjectPathError";
  }
}

export class ProjectNameTakenError extends Error {
  constructor(name: string) {
    super(`this machine already knows a project called "${name}"`);
    this.name = "ProjectNameTakenError";
  }
}

/**
 * Create a project from the launcher (plan 8.4).
 *
 * It goes through the scaffolder of 2.1 — the same one `ow init` and the first
 * run use — so a project is the same project whichever door it came through.
 * That is 2.1's whole sentence, and a launcher that made its own directories
 * would be the fourth door that disagreed.
 */
export function createProject(
  name: string,
  directory: string,
  language: Language = "en",
  appDataDir?: string,
): KnownProject {
  // Absolute, always. A relative directory resolves against whatever the
  // Electron process happens to have as its working directory — which is not a
  // place the user chose, and is how a stray `y/` gets scaffolded inside the
  // application's own source tree. The launcher picks a real folder; this
  // refusal is for every caller that is not the launcher.
  if (!isAbsolute(directory)) throw new RelativeProjectPathError(directory);
  // **Before the scaffold.** The registry validated the name inside
  // `register`, which is the last statement — so a name with a space in it,
  // which is an ordinary thing to type, created the whole directory tree and
  // then threw, leaving an orphan on disk that nothing knew about.
  assertProjectName(name);
  const registry = new ProjectRegistry(appDataDir ?? defaultAppDataDir());
  if (registry.has(name)) throw new ProjectNameTakenError(name);

  scaffold(directory);
  writeSettings(directory, { language });
  writeIgnore(directory);
  scaffoldSkills(directory);
  writeClaudeMd(directory, language);
  registry.register(name, directory);
  return { name, path: directory, present: existsSync(directory) };
}

export function forgetProject(name: string, appDataDir?: string): void {
  // Only the entry. The directory is the user's, and a launcher that deleted
  // a wiki because somebody tidied a list would be unforgivable.
  new ProjectRegistry(appDataDir ?? defaultAppDataDir()).remove(name);
}
