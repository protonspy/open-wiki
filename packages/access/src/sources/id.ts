import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * A source's directory name is derived from what the source is, and frozen
 * there (`adr:0011-sources-are-named-by-what-they-are`). The readable title
 * lives in the manifest and may drift; the id never does.
 *
 * Slugging: lowercase, accents folded to ASCII, anything outside `[a-z0-9]`
 * collapsed to a single `-`, no leading or trailing `-`.
 */
export class EmptyNameError extends Error {
  constructor(public readonly sourceName: string) {
    super(`"${sourceName}" derives to an empty id — give the source a name`);
    this.name = "EmptyNameError";
  }
}

export function deriveId(name: string): string {
  // A file source keeps its extension in the id (adr:0011): the directory is
  // `raw/arquitetura-fenix.pdf/` and the citation is `src://arquitetura-fenix.pdf#p12`.
  // The format is part of the identity — a PDF and a DOCX of the same content are
  // different sources. Slug the base name, then reattach the extension verbatim.
  // Only a trailing alphabetic group counts as an extension: a recording name
  // carries a date, not a format, so `Fenix weekly 2026-07-31` has none (`.31` is
  // digits) and is slugged whole.
  const extMatch = name.match(/\.[a-z]{1,8}$/i);
  const base = extMatch ? name.slice(0, name.length - extMatch[0].length) : name;
  const ext = extMatch ? extMatch[0] : "";
  // Fold accents: NFD splits a letter into its base + combining mark(s); strip
  // the marks to leave the ASCII base (São → Sao). \p{M} matches any mark.
  const folded = base.normalize("NFD").replace(/\p{M}/gu, "");
  const lower = folded.toLowerCase();
  const collapsed = lower.replace(/[^a-z0-9]+/g, "-");
  const trimmed = collapsed.replace(/^-+|-+$/g, "");
  if (trimmed === "") throw new EmptyNameError(name);
  return trimmed + ext;
}

const INBOX = "_inbox";

/** True when a source directory with this id already exists under `raw/`. */
export function isIdTaken(projectRoot: string, id: string): boolean {
  if (id === INBOX) return false; // the inbox is a doorway, not a source
  return existsSync(join(projectRoot, "raw", id));
}
