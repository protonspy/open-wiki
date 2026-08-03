import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { assertWithin } from "../paths.js";
import { HARNESSES, isHarness, type Harness } from "../harness.js";

/**
 * The content language of the project — `adr:0008-content-language-is-a-setting-english-by-default`.
 * It reaches exactly two places: the transcription hint and the generated
 * `CLAUDE.md`.
 */
export const LANGUAGES = ["en", "pt-BR", "es"] as const;
export type Language = (typeof LANGUAGES)[number];

/**
 * Project settings committed inside the project. The schema is **closed**:
 * an unknown key is refused rather than tolerated, so the first feature that
 * wants a per-project token cannot quietly put one here. It carries no local
 * path — a path is both a portability bug and someone's username
 * (`adr:0013-the-project-directory-is-the-unit`).
 */
export interface ProjectSettings {
  language: Language;
  deleteWavAfterTranscription: boolean;
  /**
   * The harnesses this project is scaffolded for
   * (`adr:0024-the-convention-ships-to-every-harness`).
   *
   * **Plural, and committed.** An `scc` workspace is one developer's setup, so
   * one answer is right there. A project directory is not: `adr:0013` put the
   * convention *inside the repository* precisely so it reaches everyone who
   * clones, and a team with one person on Claude Code and one on Codex is the
   * normal case rather than the edge. Recording it is what lets `ow update`
   * know which files this product owns, and what makes 5.4's "gain a harness
   * later" a change to this list rather than a re-scaffold.
   *
   * **Empty is a real state, not a missing one.** It is what a project
   * scaffolded before this key existed says about itself, and reading it as
   * "none wanted" would silently leave that project with no convention at the
   * first `ow update`. Telling the two apart is 5.1's problem and it is stated
   * here so that nobody solves it by defaulting.
   */
  harnesses: Harness[];
  /**
   * Which audio endpoint each track records, where somebody chose one
   * (R1.2, R1.5).
   *
   * **An empty string means "follow the Windows default"** (R1.3), and it is
   * the value a project that has never chosen carries. Absent and empty are
   * deliberately the same thing here, unlike `harnesses` above, because
   * following the default is a real answer rather than an unanswered question.
   *
   * **The identifier is machine-local and this file is committed.** A WASAPI
   * endpoint id means nothing on anyone else's machine, so a teammate who
   * clones gets an identifier that resolves to nothing — which is why R1.5
   * says an unresolvable one is *a choice to re-make rather than an error to
   * store*. `resolveEndpoint` below is where that is honoured. It is a real
   * cost of putting this here, accepted in `design.md` rather than discovered:
   * the alternative was a second per-machine store, and one file the user can
   * read beat two nobody can find.
   */
  micEndpoint: string;
  systemEndpoint: string;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  language: "en",
  deleteWavAfterTranscription: true,
  harnesses: [],
  micEndpoint: "",
  systemEndpoint: "",
};

export function settingsPath(projectRoot: string): string {
  return join(projectRoot, "ow.json");
}

const KNOWN_KEYS: ReadonlyArray<keyof ProjectSettings> = [
  "language",
  "deleteWavAfterTranscription",
  "harnesses",
  "micEndpoint",
  "systemEndpoint",
];

export class InvalidSettingsError extends Error {
  constructor(
    public readonly key: string,
    message: string,
  ) {
    super(message);
    this.name = "InvalidSettingsError";
  }
}

/**
 * Validates a raw object against the closed schema. Throws naming the offending
 * key. A path-shaped key is unknown, so "carries no local path" is enforced by
 * the closed schema rather than by a separate check.
 */
export function validateSettings(raw: unknown): ProjectSettings {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InvalidSettingsError("", "settings must be an object");
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.includes(key as keyof ProjectSettings)) {
      throw new InvalidSettingsError(key, `unknown setting "${key}": the schema is closed`);
    }
  }
  const language = obj["language"] ?? DEFAULT_SETTINGS.language;
  if (!LANGUAGES.includes(language as Language)) {
    throw new InvalidSettingsError("language", `unknown language "${String(language)}"`);
  }
  const deleteWav =
    obj["deleteWavAfterTranscription"] ?? DEFAULT_SETTINGS.deleteWavAfterTranscription;
  if (typeof deleteWav !== "boolean") {
    throw new InvalidSettingsError("deleteWavAfterTranscription", "must be boolean");
  }
  return {
    language: language as Language,
    deleteWavAfterTranscription: deleteWav,
    harnesses: validateHarnesses(obj["harnesses"]),
    micEndpoint: validateEndpoint("micEndpoint", obj["micEndpoint"]),
    systemEndpoint: validateEndpoint("systemEndpoint", obj["systemEndpoint"]),
  };
}

/**
 * A chosen endpoint identifier, or the empty string for "follow the default".
 *
 * Bounded, because this file arrives from a `git clone` like any other and an
 * endpoint identifier is a GUID-shaped string of about 90 characters — nothing
 * legitimate is anywhere near this, and the value is carried into a `start`
 * request and into `manifest.json`.
 */
function validateEndpoint(key: string, raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") {
    throw new InvalidSettingsError(key, `${key} must be a string`);
  }
  if (raw.length > 512) {
    throw new InvalidSettingsError(key, `${key} is not an endpoint identifier`);
  }
  // Control characters go, for the reason `safe()` in the check findings gives:
  // this file is committed, so the value arrives from whoever wrote the
  // repository, and it is carried into `manifest.json`, into a refusal message
  // and — once there is a picker — onto a screen. A carriage return or an ANSI
  // escape in it can forge or erase what a teammate reads. Nothing legitimate
  // is lost: an endpoint identifier is a GUID-shaped string.
  if (/\p{Cc}/u.test(raw)) {
    throw new InvalidSettingsError(key, `${key} is not an endpoint identifier`);
  }
  return raw;
}

/**
 * What to record with, given what this machine actually has (R1.5).
 *
 * An identifier that resolves to nothing is **a choice to re-make, not an
 * error to keep**: `ow.json` is committed and an endpoint identifier is
 * machine-local, so a teammate who clones — or the same person on a second
 * machine — has a setting that names nothing. Refusing to record would make
 * the committed file a liability; following the default and saying nothing
 * would be the silent substitution the whole spec forbids. So it falls back
 * *and says it did*, and the caller decides who to tell.
 */
export function resolveEndpoint(
  chosen: string,
  available: ReadonlyArray<{ id: string }>,
): { endpoint: string; unresolved: string | null } {
  if (chosen === "") return { endpoint: "", unresolved: null };
  if (available.some((device) => device.id === chosen)) {
    return { endpoint: chosen, unresolved: null };
  }
  return { endpoint: "", unresolved: chosen };
}

/**
 * The recorded harnesses, in `HARNESSES` order and without duplicates.
 *
 * Normalised on the way in rather than trusted, because this file is committed
 * and therefore arrives from a `git clone` like any other — `["codex","codex"]`
 * would otherwise scaffold Codex twice and report it twice. Order is fixed here
 * so that two projects listing the same harnesses produce byte-identical
 * settings, which is what keeps 5.1's hash from reporting a diff nobody made.
 */
function validateHarnesses(raw: unknown): Harness[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new InvalidSettingsError("harnesses", "harnesses must be an array");
  }
  for (const item of raw) {
    if (typeof item !== "string" || !isHarness(item)) {
      throw new InvalidSettingsError(
        "harnesses",
        `unknown harness ${JSON.stringify(item)}: one of ${HARNESSES.join(", ")}`,
      );
    }
  }
  const wanted = new Set(raw as Harness[]);
  return HARNESSES.filter((h) => wanted.has(h));
}

export function readSettings(projectRoot: string): ProjectSettings {
  const file = settingsPath(projectRoot);
  if (!existsSync(file)) return { ...DEFAULT_SETTINGS };
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return validateSettings(parsed);
}

/**
 * Merges a partial update over the current settings and writes the closed
 * schema. Refuses any key the schema does not know.
 */
export function writeSettings(
  projectRoot: string,
  update: Partial<ProjectSettings>,
): ProjectSettings {
  const next = validateSettings({ ...readSettings(projectRoot), ...update });
  const resolved = assertWithin(projectRoot, settingsPath(projectRoot));
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(resolved, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}
