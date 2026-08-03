import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertWithin, refuseSymlink } from "./paths.js";
import { outcomeOf, readManagedManifest, recordManaged } from "./update/managed.js";
import { profilesFor, type Harness } from "./harness.js";
import { renderEntryFiles } from "./render.js";
import type { Language } from "./config/settings.js";

/**
 * The generated entry file (plan 9.4, and `harness-portability` 2.7).
 *
 * The convention lives in the skills scaffolded into the project, so this file
 * points at them and duplicates nothing they say. The one thing it carries that
 * the skills cannot — because it varies per project — is the configured content
 * language. It is regenerated on change because it is generated, and the skills
 * are not (`adr:0015-the-convention-ships-as-skills`).
 *
 * **It is no longer `CLAUDE.md` alone.** `adr:0024` made the filename the
 * profile's answer: `CLAUDE.md` for Claude Code, `AGENTS.md` for Codex and
 * opencode, and one `AGENTS.md` where a project carries both of those. The
 * generation moved to `render.ts` so there is one template set rather than one
 * per door; what stays here is the writing.
 */

/**
 * The entry file for a Claude-Code-only project.
 *
 * Kept because callers ask for exactly this, and because a function returning
 * one string is a nicer thing to test against than a map with one key. It is
 * rendered through the profile like everything else, so there is no second
 * generator to drift.
 */
export function generateClaudeMd(language: Language): string {
  return renderEntryFiles(profilesFor(["claude"]), language)["CLAUDE.md"]!;
}

/** What one run of `writeEntryFiles` did (`specs/opening-an-existing-project`, R1.4). */
export interface EntryFilesResult {
  /** Rewritten, because this product wrote what was there — or nothing was. */
  written: string[];
  /** Left exactly as found, because this product did not write it. */
  kept: string[];
}

/**
 * Write the generated entry files for the harnesses this project carries.
 *
 * It sits beside `scaffoldSkills` rather than in the CLI because 9.3 and 9.4
 * are one act — what `ow init` puts into a project — and 8.12 has to regenerate
 * it when the language changes. A copy in the CLI would have meant the desktop
 * application either reaching into it or growing a second generator that drifts.
 *
 * **Generated is not the same as ours** (R1.4). These files were overwritten
 * unconditionally, which was safe only for as long as `ow init` refused every
 * directory that was not empty and not already a project. R1.1 lifted that: it
 * now runs inside a repository somebody is already working in — and the users
 * of this product are, definitionally, people who may already have a hand-written
 * `CLAUDE.md`. Overwriting it would destroy their convention in the act of
 * adding ours, silently, on a command that prints success.
 *
 * So each file is classified the way `ow update` classifies it, through the very
 * same function:
 *
 * - **missing, or identical to what we render** — written; nothing is lost.
 * - **exactly what we recorded writing** (`updatable`) — written, which is what
 *   makes a rule added in a later version reach a project made by an earlier one.
 * - **anything else** (`edited`, `unknown`) — kept, and named to the caller.
 *   `unknown` covers both a foreign file and a project older than the manifest,
 *   and neither is ours to overwrite.
 */
export function writeEntryFiles(
  projectRoot: string,
  language: Language,
  harnesses: readonly Harness[],
): EntryFilesResult {
  const written: string[] = [];
  const kept: string[] = [];
  const rendered = renderEntryFiles(profilesFor(harnesses), language);
  const manifest = readManagedManifest(projectRoot);
  /** Only what this run actually wrote: recording a kept file would claim it. */
  const ours: Record<string, string> = {};

  for (const [name, content] of Object.entries(rendered)) {
    const file = assertWithin(projectRoot, join(projectRoot, name));
    // The link check is here rather than implied by "we only create":
    // `assertWithin` cannot catch it, because for a dangling link `resolveReal`
    // rebuilds the link's own path rather than its target, so the check passes
    // and the write then follows the link at the OS level.
    refuseSymlink(file);

    const outcome = outcomeOf(projectRoot, name, content, manifest);
    if (outcome === "edited" || outcome === "unknown") {
      kept.push(file);
      continue;
    }

    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, content, "utf8");
    written.push(file);
    ours[name] = content;
  }

  recordManaged(projectRoot, ours);
  return { written, kept };
}

/**
 * Write the Claude Code entry file, and only it.
 *
 * The pre-`adr:0024` signature, kept for the callers that mean exactly one
 * harness — the desktop's language change among them. It is `writeEntryFiles`
 * with one harness, so there is one write path rather than two.
 */
export function writeClaudeMd(projectRoot: string, language: Language): string {
  // The path either way. A file this product did not write is kept rather than
  // rewritten (R1.4), and the caller still asked where the entry file is.
  const { written, kept } = writeEntryFiles(projectRoot, language, ["claude"]);
  return written[0] ?? kept[0]!;
}
