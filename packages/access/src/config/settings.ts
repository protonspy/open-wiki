import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { assertWithin } from "../paths.js";

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
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  language: "en",
  deleteWavAfterTranscription: true,
};

export function settingsPath(projectRoot: string): string {
  return join(projectRoot, "ow.json");
}

const KNOWN_KEYS: ReadonlyArray<keyof ProjectSettings> = [
  "language",
  "deleteWavAfterTranscription",
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
  return { language: language as Language, deleteWavAfterTranscription: deleteWav };
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
