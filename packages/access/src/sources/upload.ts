import { basename } from "node:path";
import { registerSource } from "./register.js";
import { writeSourceText } from "./ingest.js";
import { isArchive, unpackArchive, type UnpackResult } from "./archive.js";

/**
 * The largest file any door accepts. The inbox refuses on the `stat`, before
 * reading; this is the ceiling for a caller that already holds the bytes — the
 * drag-and-drop surface of 3.5, or a test.
 */
export const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

/**
 * One door for every uploaded file, whichever way it arrived — dragged onto the
 * window (plan 3.5), dropped into `raw/_inbox/` (3.7), or handed over by the
 * CLI.
 *
 * **It stores; it does not parse** — `adr:0021-sources-are-stored-not-parsed`.
 * The original is preserved under `raw/<id>/`, the id is derived from the
 * filename and frozen there (`adr:0011-sources-are-named-by-what-they-are`),
 * and nothing is refused for its extension. Reading a source is the agent's
 * job: it opens a PDF as a document and an image as an image, which is a better
 * answer than any extractor here produced — layout, tables and figures survive
 * — and the set of things a source can be stops being a list somebody
 * maintains.
 *
 * The one thing still written on the way in is a `text.md` for text. Copying
 * text that is already text is not extraction, and it costs one write to have
 * it where every reader already looks.
 *
 * Nothing here throws for a condition the person who dropped the file caused —
 * a name already taken, a file over the ceiling. Those come back as an outcome
 * carrying the reason, because the callers are a drag-and-drop surface and a
 * watcher, and both have to report a batch rather than stop at the first file
 * that did not work.
 */

/** What the store did with a file, which is all there is to say now. */
export type StoredAs =
  /** The bytes were preserved, and copied into `text.md`. */
  | "text"
  /** The bytes were preserved, and nothing was read. */
  | "stored"
  /** The bytes were preserved, and the archive was unpacked beside them (6.1). */
  | "unpacked";

export type IngestOutcome =
  | {
      ok: true;
      name: string;
      id: string;
      stored: StoredAs;
      /** What unpacking refused and what it made inert, when it ran (group 6). */
      unpacked?: UnpackResult;
      /**
       * Why the archive was not unpacked, when it was stored and unpacking
       * failed — a bomb, or a zip that will not open.
       *
       * On the `ok: true` side deliberately: **the source exists**. Reporting
       * `ok: false` for a file whose bytes are on disk and whose id is now
       * taken forever was a real defect, not a wording choice — the inbox
       * leaves a file it was told failed, so every later drain retried the same
       * name and met `TakenIdError`, stranding the file and squatting the id.
       */
      unpackFailed?: string;
    }
  | { ok: false; name: string; reason: string };

/**
 * The extensions whose `text.md` is a **copy** rather than an extraction.
 *
 * Not a list of what is accepted — everything is accepted. It is the list of
 * files for which writing `text.md` on the way in claims nothing the
 * application did not do.
 */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([".md", ".markdown", ".txt", ".text"]);

/** The lowercased extension of a filename, `.pdf`, or `""` when it has none. */
function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  // `> 0`, so `.gitignore` is a name and not an extension.
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

/** Whether this file's `text.md` is a copy of it, rather than the agent's to write. */
export function isTextSource(name: string): boolean {
  return TEXT_EXTENSIONS.has(extensionOf(name));
}

/**
 * Store an uploaded file. Returns the frozen source id, or the reason it did
 * not land.
 */
export async function ingestSource(
  projectRoot: string,
  rawName: string,
  content: Buffer,
): Promise<IngestOutcome> {
  // Reduce to the basename once, here. The drag-and-drop surface of 3.5
  // naturally hands over a full path and `deriveId` takes a name, so this is
  // one answer to "what is `name`" for the id and for the manifest both.
  const name = basename(rawName);

  if (content.byteLength > MAX_SOURCE_BYTES) {
    return {
      ok: false,
      name,
      reason:
        `"${name}" is ${content.byteLength} bytes, over the ${MAX_SOURCE_BYTES}-byte limit for ` +
        `a source. raw/ holds copied bytes and is committed with the project unless it is ` +
        `ignored, so a file this size is a decision to make rather than to discover.`,
    };
  }

  try {
    const { id } = registerSource(projectRoot, { name, kind: "file", content });
    if (isArchive(name)) {
      // Unpacked *after* the bytes are stored, never instead of them. The
      // archive is what arrived and stays the thing a citation can be checked
      // against; the tree beside it is a reading convenience (plan 6.1, 6.4).
      try {
        const unpacked = await unpackArchive(projectRoot, id);
        return { ok: true, name, id, stored: "unpacked", unpacked };
      } catch (err) {
        // **Its own catch, and it reports success.** A bomb or an unreadable
        // zip leaves the source registered — the bytes are on disk and the id
        // is taken forever — so answering `ok: false` describes a state that
        // does not exist. It also stranded the file: the inbox only removes
        // what landed, so every later drain retried the same name and met
        // `TakenIdError`, squatting the id and looping on the file for good.
        //
        // `unpackArchive` has already removed whatever it half-wrote, so what
        // remains is an ordinary stored source that nobody unpacked, which is
        // exactly what this says.
        return {
          ok: true,
          name,
          id,
          stored: "stored",
          unpackFailed: err instanceof Error ? err.message : String(err),
        };
      }
    }
    if (!isTextSource(name)) return { ok: true, name, id, stored: "stored" };
    writeSourceText(projectRoot, id, content.toString("utf8"));
    return { ok: true, name, id, stored: "text" };
  } catch (err) {
    // A taken id, a name that derives to nothing: both are about *this file*,
    // and the caller has more files to try.
    return { ok: false, name, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * `ingestSource` was an `async` function that awaited nothing, kept that way
 * because narrowing the signature would have been an API change for every
 * caller to gain nothing — and because group 6's archive unpacking would put
 * real asynchrony back behind it.
 *
 * It has. `unpackArchive` streams entry by entry, so the door is genuinely
 * asynchronous now and the callers that already awaited it need no change.
 */
