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
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  language: "en",
  deleteWavAfterTranscription: true,
  harnesses: [],
};

export function settingsPath(projectRoot: string): string {
  return join(projectRoot, "ow.json");
}

const KNOWN_KEYS: ReadonlyArray<keyof ProjectSettings> = [
  "language",
  "deleteWavAfterTranscription",
  "harnesses",
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
  };
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
