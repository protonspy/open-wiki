import { resolve } from "node:path";
import {
  DirectoryOccupiedError,
  LANGUAGES,
  ProjectRegistry,
  InvalidNameError,
  readSettings,
  scaffold,
  writeSettings,
  type Harness,
  type Language,
  type ScaffoldSkillsResult,
  type StaleSkill,
} from "@open-wiki/access";
import { writeEntryFiles, writeGate } from "../install.js";

export interface InitOptions {
  projectRoot?: string;
  language?: string;
  name?: string;
  /** Rewrite skills this build has moved on from — see `--refresh-skills`. */
  refreshSkills?: boolean;
  /**
   * The harnesses to scaffold for (2.3). Empty means "whatever this project
   * already records", which is what an idempotent re-run means. Deciding what
   * an *unanswered* one means — picker, or refusal — is `main.ts`'s, because
   * that is where it is known whether anyone is at the terminal.
   */
  harnesses?: readonly Harness[];
}

export interface InitResult {
  projectRoot: string;
  skills: ScaffoldSkillsResult;
  /** The gate files written, one per harness that has an interception. */
  hooks: string[];
  /** The entry files written, one per distinct filename these harnesses need. */
  entryFiles: string[];
  /**
   * The entry files left exactly as found, because this product did not write
   * what was there (`specs/opening-an-existing-project`, R1.4) — a hand-written
   * `CLAUDE.md` in the repository `ow init` was just run inside.
   */
  keptEntryFiles: string[];
  /** What the project records after this run. */
  harnesses: Harness[];
  registeredName?: string;
}

/**
 * What to say about skills that have aged in the project they were written into
 * (plan 5.3).
 *
 * `adr:0015` made the convention ship as a skill and left this open. It bites
 * now: a project scaffolded before the source loop existed keeps a wiki skill
 * that never mentions `ow source`, and a skill is read as current every
 * session — so the agent follows an instruction set the product has moved past,
 * with nothing anywhere saying so.
 *
 * `ow init` overwrites nothing, so the upgrade path has to be a sentence rather
 * than a silent fix. This is that sentence.
 */
export function staleSkillsNotice(outdated: readonly StaleSkill[]): string {
  if (outdated.length === 0) return "";
  const lines = outdated.map((s) => {
    const found = s.found === "unreadable" ? "could not be read" : (s.found ?? "no version marker");
    return `    ${s.dir}: ${found} — this build ships ${s.expected}`;
  });
  return [
    `  skills out of date (${outdated.length}):`,
    ...lines,
    // **`ow update` first, because it is the answer to this.** This notice named
    // only `--refresh-skills`, which overwrites edits and all — and went on
    // saying so after the careful verb existed, steering every user who read it
    // toward the destructive path with no hint that a safe one was there. A
    // review caught two verbs solving one problem with opposite guarantees and
    // no cross-reference between them.
    "    Run `ow update` — it shows what it would rewrite and never touches a file",
    "    you have edited. `ow init --refresh-skills` is the blunt version: it",
    "    overwrites them, edits and all.",
  ].join("\n");
}

/**
 * `ow init` — scaffold a project and install the gate (plan 9.3, 9.4, 9.5).
 * The scaffolder of 2.1 creates the directories, the settings, the ignore
 * entries and the skills; this command adds the two things it does not: the
 * hook configuration that makes writes go through the gate, and the generated
 * entry file that points at the skills and carries the content language.
 *
 * **The entry file is no longer `CLAUDE.md` alone** — it is whatever the
 * harnesses this project carries actually read (`adr:0024`), which is one file
 * for Codex and opencode together and a second for Claude Code.
 */
export function runInit(opts: InitOptions): InitResult {
  const projectRoot = resolve(opts.projectRoot ?? process.cwd());
  let scaffolded;
  try {
    scaffolded = scaffold(projectRoot, {
      refreshSkills: opts.refreshSkills === true,
      ...(opts.harnesses ? { harnesses: opts.harnesses } : {}),
    });
  } catch (err) {
    if (err instanceof DirectoryOccupiedError) {
      throw new Error(
        `${projectRoot} is already occupied by something that is not an open-wiki project. Run ow init in an empty directory, a git repo, or an existing open-wiki project.`,
      );
    }
    throw err;
  }

  const skills = scaffolded.skills;
  // What the project records after the scaffold, which is the caller's answer
  // merged into what was already there — not the caller's answer alone.
  const harnesses =
    scaffolded.settings.harnesses.length > 0 ? scaffolded.settings.harnesses : ["claude" as const];

  let language: Language = readSettings(projectRoot).language;
  if (opts.language) {
    if (!(LANGUAGES as readonly string[]).includes(opts.language)) {
      throw new Error(`--language must be one of: ${LANGUAGES.join(", ")}`);
    }
    language = opts.language as Language;
    const current = readSettings(projectRoot);
    writeSettings(projectRoot, { ...current, language });
  }
  const entry = writeEntryFiles(projectRoot, language, harnesses);
  // Only the harnesses this project carries (3.1). This was `writeHooks`
  // unconditionally, so a Codex-only project got a `.claude/settings.json`
  // written into it — a file for a harness nobody asked for, which is the
  // mirror image of the bug this plan exists to end.
  const hooks = writeGate(projectRoot, harnesses).written;

  let registeredName: string | undefined;
  if (opts.name) {
    try {
      new ProjectRegistry().register(opts.name, projectRoot);
      registeredName = opts.name;
    } catch (err) {
      if (err instanceof InvalidNameError) {
        throw new Error(`--name "${opts.name}" is not a valid project name (a name is not a path)`);
      }
      throw err;
    }
  }

  return {
    projectRoot,
    skills,
    hooks,
    entryFiles: entry.written,
    // R1.4 — an entry file this product did not write is kept, and saying so is
    // the whole point: silently not writing is as confusing as overwriting.
    keptEntryFiles: entry.kept,
    harnesses: [...harnesses],
    registeredName,
  };
}
