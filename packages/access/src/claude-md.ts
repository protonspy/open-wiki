import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertWithin, refuseSymlink } from "./paths.js";
import { recordManaged } from "./update/managed.js";
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

/**
 * Write the generated entry files for the harnesses this project carries.
 *
 * Overwrites, because they are generated. It sits beside `scaffoldSkills`
 * rather than in the CLI because 9.3 and 9.4 are one act — what `ow init` puts
 * into a project — and 8.12 has to regenerate it when the language changes. A
 * copy in the CLI would have meant the desktop application either reaching into
 * it or growing a second generator that drifts.
 */
export function writeEntryFiles(
  projectRoot: string,
  language: Language,
  harnesses: readonly Harness[],
): string[] {
  const written: string[] = [];
  const rendered = renderEntryFiles(profilesFor(harnesses), language);
  for (const [name, content] of Object.entries(rendered)) {
    const file = assertWithin(projectRoot, join(projectRoot, name));
    // These files are *generated*, so they are overwritten by design — which is
    // exactly why the link check has to be here rather than implied by "we only
    // create". `assertWithin` cannot catch it: for a dangling link `resolveReal`
    // rebuilds the link's own path rather than its target, so the check passes
    // and the write then follows the link at the OS level.
    refuseSymlink(file);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, content, "utf8");
    written.push(file);
  }
  // Recorded unconditionally, unlike the skills: these are *generated* and
  // overwritten every run, so what is on disk afterwards is exactly what was
  // rendered. A skill this product skipped is somebody else's content, which is
  // why `scaffold.ts` compares before it records and this does not need to.
  recordManaged(projectRoot, rendered);
  return written;
}

/**
 * Write the Claude Code entry file, and only it.
 *
 * The pre-`adr:0024` signature, kept for the callers that mean exactly one
 * harness — the desktop's language change among them. It is `writeEntryFiles`
 * with one harness, so there is one write path rather than two.
 */
export function writeClaudeMd(projectRoot: string, language: Language): string {
  return writeEntryFiles(projectRoot, language, ["claude"])[0]!;
}
