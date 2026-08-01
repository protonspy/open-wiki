import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { writeSettings, type ProjectSettings } from "./config/settings.js";
import { writeIgnore } from "./ignore.js";
import { scaffoldSkills } from "./skills.js";
import { INBOX } from "./sources/manifest.js";

// `raw/_inbox` is created here rather than on first use: a doorway nobody can
// see is a doorway nobody drops anything through (plan 3.7).
const DIRS = ["raw", join("raw", INBOX), "wiki", ".state"];

export class DirectoryOccupiedError extends Error {
  constructor(public readonly dir: string) {
    super(`refused: ${dir} is already occupied by something that is not an open-wiki project`);
    this.name = "DirectoryOccupiedError";
  }
}

export interface ScaffoldResult {
  createdDirs: string[];
  settings: ProjectSettings;
  skills: { written: string[]; skipped: string[] };
}

/**
 * True when the directory is empty or already looks like an open-wiki project
 * (it has `ow.json`, or both `raw/` and `wiki/`). Anything else is "occupied by
 * something else" and is refused.
 */
function isEmptyOrProject(dir: string): boolean {
  const entries = readdirSync(dir, { withFileTypes: true });
  if (entries.length === 0) return true;
  const names = new Set(entries.map((e) => e.name));
  if (names.has("ow.json")) return true;
  return names.has("raw") && names.has("wiki");
}

/**
 * The one scaffolder. `ow init`, the launcher and the first run all go through
 * it, so a project is the same project whichever door it came through (plan
 * task 2.1). It creates `raw/`, `wiki/` and `.state/`, refuses a directory
 * already occupied by something else, and calls the settings of 2.7, the ignore
 * entries of 2.8 and the skills of 9.3 rather than reimplementing any of them.
 */
export function scaffold(projectRoot: string): ScaffoldResult {
  if (existsSync(projectRoot) && !isEmptyOrProject(projectRoot)) {
    throw new DirectoryOccupiedError(projectRoot);
  }
  mkdirSync(projectRoot, { recursive: true });

  const createdDirs: string[] = [];
  for (const dir of DIRS) {
    const p = join(projectRoot, dir);
    mkdirSync(p, { recursive: true });
    createdDirs.push(dir);
  }

  const settings = writeSettings(projectRoot, {});
  writeIgnore(projectRoot);
  const skills = scaffoldSkills(projectRoot);
  return { createdDirs, settings, skills };
}
