import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeSettings, type ProjectSettings } from "./config/settings.js";
import { writeIgnore } from "./ignore.js";
import { assertWithin } from "./paths.js";
import { scaffoldSkills } from "./skills.js";
import { INBOX } from "./sources/manifest.js";
import { CHANGELOG_SEED, INDEX_SEED } from "./store/index.js";

// `raw/_inbox` is created here rather than on first use: a doorway nobody can
// see is a doorway nobody drops anything through (plan 3.7).
const DIRS = ["raw", join("raw", INBOX), "wiki", ".state"];

/**
 * The wiki's own pages, seeded on the first run (plan 1.3).
 *
 * `log.md` is not among them, and that is the deliberate half of this: it is a
 * log, and an empty log is noise. The other two are files something already
 * refers to — the skills instruct the agent to link from `index.md`, the
 * checks read both — so their absence was four components each assuming
 * somebody else had made the first move.
 */
const SEEDS: ReadonlyArray<{ path: string; content: string }> = [
  { path: join("wiki", "index.md"), content: INDEX_SEED },
  { path: join("wiki", "changelog.md"), content: CHANGELOG_SEED },
];

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
  /** The wiki's own pages this run wrote — empty on a project that had them. */
  wiki: { written: string[] };
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
  return { createdDirs, settings, skills, wiki: seedWiki(projectRoot) };
}

/**
 * Write the wiki's own pages, and never over one that is already there.
 *
 * Scaffolding runs again on an existing project — `ow init` is idempotent, and
 * the launcher and first run go through the same door — so overwriting would
 * mean a second `ow init` silently replacing an index the agent had spent the
 * project curating.
 *
 * **Two guards, because "does it exist" is not the question that matters.**
 * `assertWithin` resolves junctions and symlinks before the write, which is the
 * confinement `adr:0013` states and every other writer in this package honours.
 * And the write itself is `wx` — `O_CREAT | O_EXCL`, which the kernel refuses
 * on a symlink of any kind, dangling included. A dangling link planted at
 * `wiki/index.md` is precisely the case a prior `existsSync` answers "no" to,
 * because it follows the link to a target that is not there, and the write then
 * follows it right out of the project. `EEXIST` here means "something is
 * already at that name", which is the answer this function wanted anyway.
 */
function seedWiki(projectRoot: string): { written: string[] } {
  const written: string[] = [];
  for (const seed of SEEDS) {
    const file = assertWithin(projectRoot, join(projectRoot, seed.path));
    try {
      writeFileSync(file, seed.content, { encoding: "utf8", flag: "wx" });
      written.push(seed.path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  return { written };
}
