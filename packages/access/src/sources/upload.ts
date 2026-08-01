import { basename } from "node:path";
import { uploadTextSource } from "./ingest.js";
import { uploadPdfSource } from "./pdf.js";
import { uploadDocxSource } from "./docx.js";

/**
 * The largest file any door accepts. The inbox refuses on the `stat`, before
 * reading; this is the ceiling for a caller that already holds the bytes — the
 * drag-and-drop surface of 3.5, or a test.
 */
export const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

/**
 * One door for every uploaded file, whichever way it arrived — dragged onto the
 * window (plan 3.5), dropped into `raw/_inbox/` (3.7), or handed over by the
 * CLI. It recognises the format and dispatches to the adapter that turns it
 * into `text.md`; registration itself is always 3.1's, so a source is the same
 * source whichever door it came through.
 *
 * Nothing here throws for a condition the person who dropped the file caused —
 * an unreadable PDF, a format nobody supports, a name already taken. Those come
 * back as an outcome carrying the reason, because the callers are a drag-and-drop
 * surface and a watcher, and both have to report a batch rather than stop at the
 * first file that did not work.
 */

export type SourceFormat = "text" | "pdf" | "docx";

export type IngestOutcome =
  | { ok: true; name: string; format: SourceFormat; id: string }
  | { ok: false; name: string; format: SourceFormat | null; reason: string };

/** Extension → adapter. Everything absent from here is not recognised. */
const FORMATS: ReadonlyMap<string, SourceFormat> = new Map([
  [".md", "text"],
  [".markdown", "text"],
  [".txt", "text"],
  [".text", "text"],
  [".pdf", "pdf"],
  [".docx", "docx"],
]);

/** The lowercased extension of a filename, `.pdf`, or `""` when it has none. */
function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

/**
 * The format this file will be read as, or `null` when nothing reads it. The
 * drag-and-drop surface of 3.5 asks this before ingesting, so it can say what
 * it recognised and what it did not without touching the disk.
 */
export function recogniseSource(name: string): SourceFormat | null {
  return FORMATS.get(extensionOf(name)) ?? null;
}

/** Every extension a caller may advertise as accepted. */
export function recognisedExtensions(): string[] {
  return [...FORMATS.keys()];
}

function unrecognised(name: string): string {
  const ext = extensionOf(name);
  const known = recognisedExtensions().join(", ");
  if (ext === ".doc") {
    // The legacy binary format is a different file format wearing a similar
    // name; saying "unsupported" without saying that sends people in circles.
    return `"${name}" is the legacy .doc format, which nothing here reads — save it as .docx and drop it again`;
  }
  return ext === ""
    ? `"${name}" has no extension, so there is nothing to recognise it by (known: ${known})`
    : `"${name}" is a ${ext} file, which is not a source format (known: ${known})`;
}

/**
 * Register an uploaded file and write its `text.md`, choosing the adapter by
 * extension. Returns the frozen source id, or the reason it did not land.
 */
export async function ingestSource(
  projectRoot: string,
  rawName: string,
  content: Buffer,
): Promise<IngestOutcome> {
  // Reduce to the basename once, here. `recogniseSource` looked past directory
  // components while `deriveId` did not, so a caller handing over a full path —
  // which the drag-and-drop surface of 3.5 naturally has — was recognised as a
  // PDF and then registered under the id `home-u-documents-report.pdf`. One
  // answer to "what is `name`" for both.
  const name = basename(rawName);

  const format = recogniseSource(name);
  if (format === null) return { ok: false, name, format: null, reason: unrecognised(name) };

  if (content.byteLength > MAX_SOURCE_BYTES) {
    return {
      ok: false,
      name,
      format,
      reason: `"${name}" is ${content.byteLength} bytes, over the ${MAX_SOURCE_BYTES}-byte limit for a source`,
    };
  }

  try {
    switch (format) {
      case "text": {
        const { id } = uploadTextSource(projectRoot, name, content.toString("utf8"));
        return { ok: true, name, format, id };
      }
      case "pdf": {
        const { id } = await uploadPdfSource(projectRoot, name, content);
        return { ok: true, name, format, id };
      }
      case "docx": {
        const { id } = await uploadDocxSource(projectRoot, name, content);
        return { ok: true, name, format, id };
      }
    }
  } catch (err) {
    // A taken id, an empty name, a document the reader will not open: all of
    // them are things about *this file*, and the caller has more files to try.
    return { ok: false, name, format, reason: err instanceof Error ? err.message : String(err) };
  }
}
