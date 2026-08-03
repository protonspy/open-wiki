import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerSource } from "./register.js";
import { withdrawProcessed } from "./update.js";
import { assertWithin } from "../paths.js";

/**
 * Upload a Markdown or plain-text source (plan 3.2): register it under
 * `raw/<id>/` (preserving the original) and write the normalised text to
 * `text.md`. The text is the content itself for these formats — there is no
 * extraction step — only normalisation: LF line endings and a single trailing
 * newline, matching the project's `eol=lf` and prettier's `endOfLine: lf`.
 *
 * Nothing else is extracted on the way in any more
 * (`adr:0021-sources-are-stored-not-parsed`): the original is preserved and the
 * agent reads it.
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
  // The bytes of a source never change, so `text.md` landing is the only way
  // readable content arrives at a source somebody has already finished with
  // (`specs/source-status`, R3.1). Withdrawn *first*, so an interrupted run
  // errs the safe way: a declaration gone with no `text.md` yet reads as
  // unprocessed and costs a re-read, where `text.md` present under a standing
  // declaration reads as finished material nobody has read.
  //
  // This is one of the two doors `text.md` comes through. The other is the
  // transcription pipeline, which writes through `@open-wiki/audio` and calls
  // `withdrawProcessed` itself — see `apps/desktop/src/main/transcribe-run.ts`.
  withdrawProcessed(projectRoot, id);
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
