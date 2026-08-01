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

const BLOCK = [
  OPEN_BLOCK,
  "# Recorded audio and .state/ are ignored by default; committing them is",
  "# opt-in. .state/ holds every page as it was before each write, which is",
  "# where a redaction survives the redaction (adr:0013).",
  ".state/",
  "raw/**/*.wav",
  "raw/**/*.opus",
  CLOSE_BLOCK,
].join("\n");

/**
 * Writes the managed block into `<project>/.gitignore`, idempotently. A block
 * already present is left untouched (the user may have opted in by editing it),
 * and any other content is preserved.
 */
export function writeIgnore(projectRoot: string): void {
  const file = join(projectRoot, ".gitignore");
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (existing.includes(OPEN_BLOCK)) return; // already managed — do not clobber
  const body = existing.length === 0 ? BLOCK : `${existing.trimEnd()}\n\n${BLOCK}\n`;
  writeFileSync(file, body, "utf8");
}
