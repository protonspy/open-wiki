import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import {
  LANGUAGES,
  ProjectRegistry,
  readSettings,
  settingsPath,
  scaffold,
  scaffoldSkills,
  writeEntryFiles,
  writeIgnore,
  writeSettings,
  type Harness,
  type ProjectSettings,
  type Language,
} from "@open-wiki/access";
// The one import of the secret in the whole product. `config/secrets.ts` says
// the CLI, the hooks and the MCP process must not read it — their stderr is
// consumed by an agent and travels to a model provider. It is reached through
// a named subpath rather than the barrel so that stays visible in one grep.
import {
  defaultAppDataDir,
  readSecrets,
  secretsFile,
  writeSecrets,
  type ProjectSecrets,
  type SttSecret,
} from "@open-wiki/access/secrets";
import { GROQ_URL, type FetchLike } from "@open-wiki/audio";
// The one definition of "this directory holds a project", shared with the
// launch path rather than written a second time here.
import { looksLikeProject } from "./project.js";
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
 * Change the content language (plan 8.12, and `harness-portability` 2.7).
 *
 * It reaches exactly two places — `adr:0008` is explicit — and one of them has
 * to be rewritten when it changes: the entry file is *generated*, so it carries
 * the language and must be regenerated. The skills are not generated and are
 * left alone, which is the distinction 9.4 draws.
 *
 * **Regenerated for every harness the project carries**, not for Claude Code
 * alone (`adr:0024`). A project scaffolded for Codex would otherwise keep an
 * `AGENTS.md` naming the old language while `ow.json` said another — and
 * because the entry file is what the agent actually reads, the file would win
 * and the setting would look broken.
 */
export function setLanguage(projectRoot: string, language: Language): Language {
  if (!LANGUAGES.includes(language)) {
    throw new Error(`unknown language "${language}" — one of ${LANGUAGES.join(", ")}`);
  }
  const settings = writeSettings(projectRoot, { language });
  writeEntryFiles(
    projectRoot,
    settings.language,
    // An empty list is a project scaffolded before harnesses were recorded, and
    // what such a project has on disk is a `CLAUDE.md`.
    settings.harnesses.length > 0 ? settings.harnesses : ["claude"],
  );
  return settings.language;
}

export function currentLanguage(projectRoot: string): Language {
  return readSettings(projectRoot).language;
}

/**
 * Keep the WAV after transcribing, or let it go (desktop-ui 6.1).
 *
 * An hour of raw capture is ~690 MB and the Opus is what a citation opens
 * (`adr:0006`), so the default deletes it — but the toggle is real, and
 * `transcribe-run.ts` reads it on the way into `seal`. Somebody keeping the
 * originals for their own reasons is not this application's business to refuse.
 */
export function setDeleteWav(projectRoot: string, on: boolean): ProjectSettings {
  return writeSettings(projectRoot, { deleteWavAfterTranscription: on });
}

/**
 * The settings sheet's whole subject (desktop-ui 6.1): the values, and the two
 * files they actually live in.
 *
 * **The draft's "this is the whole file" is kept, and is truer here than in the
 * draft.** There is no backend to ask, so support for this application is
 * somebody opening their own configuration — which is worth them knowing exists
 * and what shape it has.
 *
 * It is *two* files rather than the draft's one, and the split is 2.7's:
 * project settings are committed inside the project under a closed schema and
 * carry no secret and no local path, while every secret lives in the
 * application's data directory keyed by project path. So `ow.json` is shown
 * verbatim — by construction it cannot hold a secret — and the credential file
 * is shown as **a path and nothing else**. Its contents never cross the bridge,
 * which is the rule `credentialState` already follows: a window that renders
 * markdown an agent wrote must not have the key in its DOM.
 */
export interface SettingsView {
  settings: ProjectSettings;
  /** Where the project's settings live, committed with the project. */
  settingsFile: string;
  /** `ow.json` as it is on disk, or null before anything has written it. */
  settingsText: string | null;
  /** Where the credential lives. The path only, never what is in it. */
  secretsFile: string;
}

export function settingsView(projectRoot: string, appDataDir?: string): SettingsView {
  const file = settingsPath(projectRoot);
  return {
    settings: readSettings(projectRoot),
    settingsFile: file,
    // Read rather than re-serialised from what we parsed: the point of showing
    // the file is that it *is* the file, and a pretty-printed copy would hide
    // exactly the malformed thing somebody opened the sheet to understand.
    settingsText: existsSync(file) ? readFileSync(file, "utf8") : null,
    secretsFile: secretsFile(projectRoot, appDataDir ?? defaultAppDataDir()),
  };
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
 * A registry name for a project nobody named
 * (`specs/opening-an-existing-project`, R2.3).
 *
 * Opening an existing project asks for no name — R2.2 — and the registry is
 * keyed by one, so it comes from the directory. The registry's rule is
 * `PROJECT_NAME` above, and a folder called `Meu Projeto (2024)` is an ordinary
 * thing to have: everything it rejects becomes `-`, the run that leaves is
 * collapsed, and what may not lead or trail a name is trimmed.
 *
 * **A taken name is suffixed, never reused.** `register` overwrites the entry
 * for a name it already has (`packages/access/src/registry.ts:82`), so returning
 * a name another directory holds would silently repoint that entry — this
 * feature quietly losing somebody's other project, which is the worst thing it
 * could do.
 *
 * @param taken every name the registry already holds for a *different*
 *   directory. A directory already registered is answered before this is
 *   reached, by `adoptProject`.
 * @returns null for a directory whose name survives none of the above (`...`).
 *   That is the one case that cannot be named without asking, and asking is what
 *   **New project** is for.
 */
export function deriveProjectName(directory: string, taken: ReadonlySet<string>): string | null {
  // `basename` on a path with a trailing separator answers the last real
  // segment, which is what a directory chooser can hand back.
  const base = basename(directory.replace(/[\\/]+$/, ""));
  const stem = base
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .replace(/[^a-zA-Z0-9]+$/, "");
  if (stem === "") return null;
  if (!taken.has(stem)) return stem;
  // From 2: the unsuffixed name is the first one, so the next is the second.
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}-${n}`;
    if (!taken.has(candidate)) return candidate;
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
  /**
   * The harnesses this project is for (`harness-portability` 2.6).
   *
   * **A form, not a picker, and not a `prompt()` chain.** The desktop has no
   * terminal, so the CLI's answer does not port — and 8.12 already learned what
   * happens when that is ignored: a chain of `prompt()` calls answered nothing
   * at all in a packaged build. The renderer collects this alongside the name
   * and the language and passes it here, where the same scaffolder runs.
   *
   * Defaulted rather than required, because every existing caller means a
   * Claude Code project and this signature is reached by more than the form.
   */
  harnesses: readonly Harness[] = ["claude"],
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

  const chosen = harnesses.length > 0 ? harnesses : (["claude"] as const);
  scaffold(directory, { harnesses: chosen });
  writeSettings(directory, { language });
  writeIgnore(directory);
  scaffoldSkills(directory, { harnesses: chosen });
  writeEntryFiles(directory, language, chosen);
  registry.register(name, directory);
  return { name, path: directory, present: existsSync(directory) };
}

/**
 * What adopting a directory came to (`specs/opening-an-existing-project`).
 *
 * `not-a-project` is an answer rather than a throw: R2.4 turns it into the
 * create form with that directory already filled in, which is a step forward
 * and not a failure.
 */
export type AdoptOutcome =
  { kind: "adopted"; project: KnownProject } | { kind: "not-a-project"; directory: string };

/**
 * Take on a project that already exists on disk (R2.2, R2.3, R2.5).
 *
 * The counterpart of `createProject`, and deliberately not a variant of it:
 * nothing is scaffolded, nothing is written into the directory, and no name,
 * language or harness is asked for. A project that already exists has all four
 * already, and asking again is how the answers on disk get overwritten with
 * whatever a form defaulted to.
 *
 * A directory this machine already knows is answered with the entry it already
 * has (R2.5). That check is by path rather than by name, because the same
 * project registered twice under two names is exactly the duplicate R2.5 exists
 * to prevent.
 */
export function adoptProject(directory: string, appDataDir?: string): AdoptOutcome {
  // Absolute, for `createProject`'s reason: a relative directory resolves
  // against whatever working directory the Electron process happens to have.
  if (!isAbsolute(directory)) throw new RelativeProjectPathError(directory);
  const resolved = resolve(directory);
  if (!looksLikeProject(resolved)) return { kind: "not-a-project", directory: resolved };

  const registry = new ProjectRegistry(appDataDir ?? defaultAppDataDir());
  const known = registry.known();
  for (const name of known) {
    let path: string;
    try {
      path = registry.resolve(name);
    } catch {
      // An entry whose directory moved. It resolves to nothing, so it is not
      // this one, and it is not this function's business to tidy it.
      continue;
    }
    if (samePath(path, resolved)) {
      return { kind: "adopted", project: { name, path: resolved, present: true } };
    }
  }

  const name = deriveProjectName(resolved, new Set(known));
  if (name === null) throw new UnnameableProjectError(resolved);
  registry.register(name, resolved);
  return { kind: "adopted", project: { name, path: resolved, present: true } };
}

export class UnnameableProjectError extends Error {
  constructor(directory: string) {
    super(
      `no project name can be made from "${directory}" — open it with New project and type one`,
    );
    this.name = "UnnameableProjectError";
  }
}

/**
 * One directory, or two.
 *
 * Case-insensitively on Windows only: `C:\Projects\Fenix` and `c:\projects\fenix`
 * are one directory there and two on Linux, and lowercasing everywhere would
 * merge two projects that genuinely differ.
 */
function samePath(a: string, b: string): boolean {
  const left = resolve(a);
  const right = resolve(b);
  if (process.platform !== "win32") return left === right;
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * Where a known project is, by name (desktop-ui 6.3).
 *
 * **The renderer names a project, never a path** — 2.2's rule and 8.2's. The
 * registry resolves a name to a directory, refuses an unknown name rather than
 * guessing, and degrades to a refusal for a directory that moved. So the first
 * run can configure and then open the project it just made, from a window that
 * has no project of its own, without a path crossing the bridge either way.
 */
export function projectPath(name: string, appDataDir?: string): string {
  return new ProjectRegistry(appDataDir ?? defaultAppDataDir()).resolve(name);
}

/**
 * Store a credential for a project this window does not have open (6.3).
 *
 * The first run creates a project and then asks how meetings are transcribed,
 * and the credential belongs to *that* project — the launcher's window has none
 * of its own. Same check, same store; only what it is keyed by is resolved
 * differently.
 */
export async function saveCredentialForProject(
  name: string,
  input: SaveCredentialInput,
  deps: CredentialDeps = {},
): Promise<CredentialCheck> {
  return saveCredential(projectPath(name, deps.appDataDir), input, deps);
}

export function forgetProject(name: string, appDataDir?: string): void {
  // Only the entry. The directory is the user's, and a launcher that deleted
  // a wiki because somebody tidied a list would be unforgivable.
  new ProjectRegistry(appDataDir ?? defaultAppDataDir()).remove(name);
}
