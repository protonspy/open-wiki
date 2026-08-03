import { resolve } from "node:path";
import {
  DirectoryOccupiedError,
  LANGUAGES,
  ProjectRegistry,
  InvalidNameError,
  readSettings,
  scaffold,
  writeSettings,
  type Language,
  type ScaffoldSkillsResult,
  type StaleSkill,
} from "@open-wiki/access";
import { writeClaudeMd, writeHooks } from "../install.js";

export interface InitOptions {
  projectRoot?: string;
  language?: string;
  name?: string;
  /** Rewrite skills this build has moved on from — see `--refresh-skills`. */
  refreshSkills?: boolean;
}

export interface InitResult {
  projectRoot: string;
  skills: ScaffoldSkillsResult;
  hooks: string;
  claudeMd: string;
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
    "    Re-run with --refresh-skills to rewrite them. That overwrites the files,",
    "    edits and all; copy anything of your own out first.",
  ].join("\n");
}

/**
 * `ow init` — scaffold a project and install the gate (plan 9.3, 9.4, 9.5).
 * The scaffolder of 2.1 creates the directories, the settings, the ignore
 * entries and the skills; this command adds the two things it does not: the
 * hook configuration that makes writes go through the gate, and the short
 * `CLAUDE.md` that points at the skills and carries the content language.
 */
export function runInit(opts: InitOptions): InitResult {
  const projectRoot = resolve(opts.projectRoot ?? process.cwd());
  let skills;
  try {
    skills = scaffold(projectRoot, { refreshSkills: opts.refreshSkills === true }).skills;
  } catch (err) {
    if (err instanceof DirectoryOccupiedError) {
      throw new Error(
        `${projectRoot} is already occupied by something that is not an open-wiki project. Run ow init in an empty directory, a git repo, or an existing open-wiki project.`,
      );
    }
    throw err;
  }

  let language: Language = readSettings(projectRoot).language;
  if (opts.language) {
    if (!(LANGUAGES as readonly string[]).includes(opts.language)) {
      throw new Error(`--language must be one of: ${LANGUAGES.join(", ")}`);
    }
    language = opts.language as Language;
    const current = readSettings(projectRoot);
    writeSettings(projectRoot, { ...current, language });
  }
  const claudeMd = writeClaudeMd(projectRoot, language);
  const hooks = writeHooks(projectRoot).written;

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

  return { projectRoot, skills, hooks, claudeMd, registeredName };
}
