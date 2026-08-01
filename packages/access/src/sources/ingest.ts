import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerSource } from "./register.js";
import { assertWithin } from "../paths.js";

/**
 * Upload a Markdown or plain-text source (plan 3.2): register it under
 * `raw/<id>/` (preserving the original) and write the normalised text to
 * `text.md`. The text is the content itself for these formats — there is no
 * extraction step — only normalisation: LF line endings and a single trailing
 * newline, matching the project's `eol=lf` and prettier's `endOfLine: lf`.
 *
 * PDF and DOCX take a different path (3.3, 3.4): their `text.md` is extracted,
 * not copied. Both reach `text.md` through `writeSourceText`.
 */

/**
 * Normalise source text to the canonical form: LF endings, no trailing blank
 * lines, exactly one trailing newline. Whatever the writer handed in, the
 * stored `text.md` is the same shape.
 */
export function normaliseText(text: string): string {
  const lf = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const trimmedEnd = lf.replace(/\s+$/g, "");
  return `${trimmedEnd}\n`;
}

/** Write `text.md` into an existing source directory, normalised. */
export function writeSourceText(projectRoot: string, id: string, text: string): void {
  const file = assertWithin(projectRoot, join(projectRoot, "raw", id, "text.md"));
  writeFileSync(file, normaliseText(text), "utf8");
}

/**
 * Upload a Markdown or plain-text source: register it and write its
 * normalised `text.md`. Returns the frozen source id.
 */
export function uploadTextSource(
  projectRoot: string,
  name: string,
  content: string,
): { id: string } {
  const { id } = registerSource(projectRoot, { name, kind: "file", content: Buffer.from(content) });
  writeSourceText(projectRoot, id, content);
  return { id };
}
