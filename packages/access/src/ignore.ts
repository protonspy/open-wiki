import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The `.gitignore` block written at `ow init` so that recorded audio and
 * `.state/` are out by default, and committing them is opting in — not
 * discovering after a push (plan task 2.8,
 * `adr:0013-the-project-directory-is-the-unit`). `.state/` holds every page as
 * it was before each write, which is where a redaction survives the redaction.
 */
export const OPEN_BLOCK = "# >>> open-wiki >>>";
export const CLOSE_BLOCK = "# <<< open-wiki <<<";

const BODY = [
  "# Recorded audio and .state/ are ignored by default; committing them is",
  "# opt-in. .state/ holds every page as it was before each write, which is",
  "# where a redaction survives the redaction (adr:0013).",
  ".state/",
  "raw/**/*.wav",
  "raw/**/*.opus",
  "# raw/_inbox/ is a doorway, emptied by ingestion (plan 3.7). What sits in it",
  "# has not been read yet, and committing unreviewed material is not something",
  "# to do by default; a file that became a source is committed as that source.",
  "raw/_inbox/",
  "#",
  "# Everything between the two markers is managed: it is rewritten whenever the",
  "# project is scaffolded, so a rule added in a later version reaches a project",
  "# created by an earlier one. To commit something this ignores, put a negation",
  "# *below* the closing marker — git takes the last matching pattern, and a line",
  "# outside the block is never touched.",
];

const BLOCK = [OPEN_BLOCK, ...BODY, CLOSE_BLOCK].join("\n");

/**
 * Writes the managed block into `<project>/.gitignore`. Content outside the
 * markers is preserved exactly; content between them is replaced.
 *
 * **Replaced, not skipped.** Leaving an existing block untouched meant a rule
 * added later never reached a project scaffolded earlier — and `scaffold` runs
 * again on an existing project, so those projects got the new *directory*
 * without the new ignore rule. For `raw/_inbox/` that is precisely backwards:
 * the doorway appears, and the unreviewed material an agent drops in it is
 * git-visible in exactly the projects that already existed.
 *
 * Opting in is still supported, and is now a thing the file can express rather
 * than a thing the tool has to infer from an edit it cannot tell from a
 * mistake: a negation below the closing marker wins, because git takes the last
 * matching pattern.
 */
export function writeIgnore(projectRoot: string): void {
  const file = join(projectRoot, ".gitignore");
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";

  if (existing === "") {
    writeFileSync(file, `${BLOCK}\n`, "utf8");
    return;
  }

  const lines = existing.split(/\r?\n/);
  const open = lines.indexOf(OPEN_BLOCK);
  const close = lines.indexOf(CLOSE_BLOCK, open + 1);

  if (open === -1 || close === -1) {
    // No managed block yet — or a half-written one, which is not something to
    // guess at. Append a whole one and leave whatever is there alone.
    writeFileSync(file, `${existing.trimEnd()}\n\n${BLOCK}\n`, "utf8");
    return;
  }

  const next = [...lines.slice(0, open), ...BLOCK.split("\n"), ...lines.slice(close + 1)];
  const body = next.join("\n");
  writeFileSync(file, body.endsWith("\n") ? body : `${body}\n`, "utf8");
}
