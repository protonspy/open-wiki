import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { readSettings, writeSettings, type ProjectSettings } from "./config/settings.js";
import { writeIgnore } from "./ignore.js";
import { assertWithin } from "./paths.js";
import { scaffoldSkills, type ScaffoldSkillsResult } from "./skills.js";
import { profilesFor, type Harness } from "./harness.js";
import { renderSkills } from "./render.js";
import { recordManaged } from "./update/managed.js";
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
  skills: ScaffoldSkillsResult;
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
export function scaffold(
  projectRoot: string,
  options: { refreshSkills?: boolean; harnesses?: readonly Harness[] } = {},
): ScaffoldResult {
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

  // **Naming a harness adds it; naming none keeps what the project already is.**
  // Re-running `ow init` has always meant "make this project current", and a
  // caller that says nothing about harnesses must not be read as saying "none"
  // — that would strip a project of its convention on an idempotent re-run.
  // Adding rather than replacing is also what makes 5.4 a change to this list
  // instead of a re-scaffold.
  const current = existsSync(projectRoot) ? readSettings(projectRoot).harnesses : [];
  const harnesses =
    options.harnesses && options.harnesses.length > 0
      ? [...new Set([...current, ...options.harnesses])]
      : current;

  const settings = writeSettings(projectRoot, { harnesses });
  writeIgnore(projectRoot);
  // A project that records no harness is one scaffolded before `adr:0024`, and
  // Claude Code is what it already has on disk — see `ScaffoldSkillsOptions`.
  const forHarnesses =
    settings.harnesses.length > 0 ? settings.harnesses : (["claude"] as const satisfies Harness[]);
  const skills = scaffoldSkills(projectRoot, {
    refresh: options.refreshSkills === true,
    harnesses: forHarnesses,
  });
  recordWhatIsOurs(projectRoot, forHarnesses);
  return { createdDirs, settings, skills, wiki: seedWiki(projectRoot) };
}

/**
 * Record which managed files are, right now, exactly what this build renders —
 * so `ow update` can tell an aged file from an edited one (5.1).
 *
 * **Only the ones that match.** `scaffoldSkills` overwrites nothing, so a skill
 * it *skipped* holds somebody else's content; recording our hash for it would
 * claim we wrote it, and the first `ow update` would call it `updatable` and
 * replace it. That is exactly the loss 5.2 exists to prevent, arriving through
 * the door that records rather than the one that writes.
 *
 * So this compares before it records, and a file that differs stays unrecorded
 * — which makes it `unknown`, which is never written over.
 */
function recordWhatIsOurs(projectRoot: string, harnesses: readonly Harness[]): void {
  const ours: Record<string, string> = {};
  for (const profile of profilesFor(harnesses)) {
    for (const [rel, content] of Object.entries(renderSkills(profile))) {
      try {
        const onDisk = readFileSync(join(projectRoot, ...rel.split("/")), "utf8");
        if (onDisk === content) ours[rel] = content;
      } catch {
        // Not there at all — nothing to record.
      }
    }
  }
  if (Object.keys(ours).length > 0) recordManaged(projectRoot, ours);
}

/**
 * Write the wiki's own pages, and never over one that is already there.
 *
 * Scaffolding runs again on an existing project — `ow init` is idempotent, and
 * the launcher and first run go through the same door — so overwriting would
 * mean a second `ow init` silently replacing an index the agent had spent the
 * project curating.
 *
 * **`existsSync` is the wrong question, and it is the dangerous one.** It
 * follows a symlink, so a *dangling* link planted at `wiki/index.md` answers
 * "nothing is there" — and the write then follows the same link and creates
 * the file at its target, wherever on disk that is. `assertWithin` does not
 * catch this one either: `resolveReal` resolves the longest ancestor that
 * exists and appends the rest verbatim, and for a dangling link that ancestor
 * is `wiki/` itself.
 *
 * So the guard is `lstat`, which answers about the name rather than about what
 * the name points at: **anything at all there means this function does not
 * write.** That holds identically on every platform, where `O_CREAT | O_EXCL`
 * refusing a symlink is a POSIX rule with no Win32 equivalent — and Windows is
 * what this ships on. `wx` stays for the sliver between the two calls; a lost
 * race is `EEXIST`, which is the same answer the guard would have given.
 */
function seedWiki(projectRoot: string): { written: string[] } {
  const written: string[] = [];
  for (const seed of SEEDS) {
    const file = assertWithin(projectRoot, join(projectRoot, seed.path));
    if (occupied(file)) continue;
    try {
      writeFileSync(file, seed.content, { encoding: "utf8", flag: "wx" });
      written.push(seed.path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  return { written };
}

/**
 * Whether anything at all bears this name — a file, a directory, a symlink
 * pointing anywhere or nowhere. `lstat`, never `stat`: the difference between
 * the two is the whole of the guard above.
 */
function occupied(file: string): boolean {
  try {
    lstatSync(file);
    return true;
  } catch {
    return false;
  }
}
