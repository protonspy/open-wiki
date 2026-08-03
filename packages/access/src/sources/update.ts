import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDate } from "../dates.js";
import { assertWithin } from "../paths.js";
import { atomicWrite } from "../write/atomic-write.js";
import {
  MissingSourceError,
  parseManifest,
  readManifest,
  type SourceManifest,
} from "./manifest.js";

/**
 * The **one** thing that writes a `manifest.json` after registration
 * (`specs/source-status`, R2.1).
 *
 * Two different things live under `raw/<id>/` and only one of them is frozen.
 * The source — `source.pdf`, `mic.opus`, an unpacked tree — is written once and
 * never again, because a codewiki citation into it resolves by *position* and
 * nothing can check that the lines still say what they said. The manifest is
 * this application's record *about* the source, it has been mutable since plan
 * task 6.7 made the title correctable, and nothing cites it by position: no
 * `src://<id>#manifest` exists and no citation resolves into one.
 *
 * It lives beside `register.ts` rather than in `manifest.ts` for the reason
 * `register.ts` does — the read surface the MCP process imports (plan 9.9) must
 * pull no write code, and read-only is meant to be what that process *can* do
 * rather than what it agrees to do.
 *
 * Before this, the only mutator was `retitleSource` inside the Electron main
 * process. So the CLI could not correct a title at all, and a status verb built
 * beside a desktop-only mutator would have been the second manifest writer that
 * 9.1's one-implementation rule exists to prevent.
 */

/**
 * Keys never carried through from a manifest this application did not write.
 *
 * Keeping unmodelled fields is the point of the passthrough, but these three
 * are not somebody's data — they are the names that turn a later merge into
 * prototype pollution. Nothing here is vulnerable today: `JSON.parse` makes
 * `__proto__` an ordinary own property and object spread copies it without
 * invoking the setter. But before the passthrough existed this application
 * scrubbed them on first write simply by narrowing, and re-legitimising them in
 * a file explicitly documented as read by tools this application did not write
 * is a guarantee worth keeping rather than a bug worth waiting for.
 */
const UNSAFE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

export interface ManifestChange {
  /** The readable title. The id it was derived from never changes (`adr:0011`). */
  title?: string;
  /**
   * A `YYYY-MM-DD` date to declare the source processed, or `null` to withdraw
   * the declaration. Omitted leaves whatever is there alone.
   */
  processed?: string | null;
  /**
   * What the source is about, or `null` to clear it. Omitted leaves it alone.
   *
   * Replaces rather than appends: it is one statement about the source, made by
   * whoever last read it, and a description that accreted would become the
   * document this deliberately is not.
   */
  description?: string | null;
}

/**
 * The longest description this application will write.
 *
 * Not a storage limit — it is where the plan's line sits. "If what the agent
 * has to say about a source needs sections, it is a wiki page citing that
 * source, and writing pages is the entire product." A couple of thousand
 * characters is a paragraph or two; past that, the refusal is the reminder.
 */
export const MAX_DESCRIPTION = 2000;

/**
 * Apply a change to a source's manifest and return what was written. Throws
 * `MissingSourceError` for an id that names no source, `OutsideProjectError`
 * for one that escapes `raw/`, and `InvalidManifestError` for a manifest this
 * module could not read.
 */
export function updateManifest(
  projectRoot: string,
  id: string,
  change: ManifestChange,
): SourceManifest {
  if (change.processed !== undefined && change.processed !== null && !isDate(change.processed)) {
    // Refused rather than written, because `parseManifest` degrades a malformed
    // declaration to unprocessed: a bad date stored here would come back as
    // "nobody ever marked it", with the write having reported success. The
    // message says the shape, so an agent can fix it and try again (9.13).
    throw new Error(
      `"${change.processed}" is not a date — a processed declaration is YYYY-MM-DD, the day it was made`,
    );
  }
  if (typeof change.description === "string") {
    if (change.description.trim() === "") {
      // Storing whitespace would leave a source that reports having a
      // description and says nothing, which is worse than having none — the
      // sources pane shows a blank line where "nobody has read this" belongs.
      throw new Error("a description cannot be blank — pass null to clear it instead");
    }
    if (change.description.length > MAX_DESCRIPTION) {
      throw new Error(
        `that description is ${change.description.length} characters, over the ${MAX_DESCRIPTION}-character bound — ` +
          `if what there is to say about this source needs that much room, it is a wiki page citing the source, not a note beside it`,
      );
    }
  }

  // Confined against `raw/` and not merely the project, because an id like
  // `../wiki` stays inside the project and still names no source. This is the
  // path actually written, and it is resolved before anything is read so the
  // read and the write cannot be looking at two different files.
  const rawDir = join(projectRoot, "raw");
  const file = assertWithin(rawDir, join(rawDir, id, "manifest.json"));
  if (!existsSync(file)) throw new MissingSourceError(id);

  // Read the file's own object, not just the fields this module models.
  // `parseManifest` narrows to five keys, so merging onto *that* would delete
  // everything else the file held — and a manifest arrives with a clone, which
  // means "everything else" can be somebody's data that this application simply
  // does not know about yet. Withdrawing a declaration now happens on every
  // `text.md` write, so a lossy merge here would be a frequent, silent, and
  // successful-looking way to destroy it.
  const text = readFileSync(file, "utf8");
  // Still parsed, so a manifest this module cannot read is refused rather than
  // rewritten: overwriting one that will not parse destroys whatever it held in
  // order to set two fields in it.
  const current = parseManifest(id, text);
  const passthrough: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(JSON.parse(text) as Record<string, unknown>)) {
    if (!UNSAFE_KEYS.has(key)) passthrough[key] = value;
  }

  const next: Record<string, unknown> = {
    ...passthrough,
    // The validated fields win over the raw ones — `parseManifest` takes the id
    // from the directory and never from the file (`adr:0011`), so a manifest
    // claiming a different one does not get to keep the claim.
    ...current,
    ...(change.title !== undefined ? { title: change.title } : {}),
  };
  // The passthrough keeps what this module does not model. `processed` is not
  // that — it is modelled, and `parseManifest` *omits* it when it is not a date,
  // so without this the raw `"yesterday"` would survive a write. Preserving a
  // value from a function that refuses to produce one is not preservation, it
  // is writing back garbage this module already rejected once.
  if (current.processed === undefined) delete next["processed"];
  // Absent *is* unprocessed, so withdrawing deletes the key rather than writing
  // a falsy one. There is then no state in which the declaration and its date
  // can disagree.
  if (change.processed === null) delete next["processed"];
  else if (change.processed !== undefined) next["processed"] = change.processed;

  // Same rule for the description: modelled, so the validated view owns it and
  // the passthrough does not get to carry back a value `parseManifest` dropped.
  if (current.description === undefined) delete next["description"];
  if (change.description === null) delete next["description"];
  else if (change.description !== undefined) next["description"] = change.description;

  // `atomicWrite` does temp-plus-rename with a random name — a fixed `.tmp` is
  // both a name an attacker can plant at and a file two concurrent updates of
  // one source would share, the loser's cleanup deleting the winner's in-flight
  // file.
  atomicWrite(projectRoot, join("raw", id, "manifest.json"), `${JSON.stringify(next, null, 2)}\n`);
  return parseManifest(id, JSON.stringify(next));
}

/**
 * Withdraw a processed declaration, if there is one, and write nothing if there
 * is not (`specs/source-status`, R3.1).
 *
 * Exported because **two** paths write a source's `text.md` and both have to
 * withdraw: `writeSourceText` here in the access package, and the transcription
 * pipeline, which writes through `@open-wiki/audio` and cannot call into this
 * package the other way round. One function so the two cannot drift.
 *
 * It tolerates a source with no readable manifest. `writeSourceText` also runs
 * mid-registration and over directories the audio pipeline assembles, and a
 * `text.md` that failed to land because of a malformed manifest would be a
 * worse outcome than a stale declaration.
 */
export function withdrawProcessed(projectRoot: string, id: string): void {
  let declared: string | undefined;
  try {
    declared = readManifest(projectRoot, id).processed;
  } catch {
    return;
  }
  if (declared !== undefined) updateManifest(projectRoot, id, { processed: null });
}
