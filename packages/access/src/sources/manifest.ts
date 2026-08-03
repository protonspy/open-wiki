import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listSourceRefs, sourceDirOf } from "./locate.js";
import { isDate } from "../dates.js";
import { boundedText } from "../format.js";
import { assertWithin, OutsideProjectError } from "../paths.js";

/**
 * Read a source — any entry in `raw/`, an uploaded file or a recording
 * (`adr:0011-sources-are-named-by-what-they-are`). The readable title lives in
 * the manifest and may drift; the id never does.
 *
 * The write that registers a source lives in `register.ts`, so the read surface
 * the MCP process imports (plan 9.9) pulls no write code.
 */

/**
 * The doorway under `raw/` (plan 3.7).
 *
 * It moved to `locate.ts` at task 8.3 and is re-exported here so every existing
 * importer is unaffected: the walk that must skip it now sits *below* this
 * module rather than above it, and leaving the constant here would have made
 * the two import each other.
 */
export { INBOX } from "./locate.js";

export type SourceKind = "file" | "recording";

export interface SourceManifest {
  /** Frozen at write time; equal to the directory name. */
  id: string;
  /** Readable, correctable at any time (`adr:0011`). */
  title: string;
  kind: SourceKind;
  /** The original filename for a file; empty for a recording. */
  original: string;
  /**
   * The date somebody declared they had finished reading this source, and the
   * one thing about a source that is **declared rather than derived**.
   *
   * Everything else here and in `state.ts` is observable on disk. *The agent
   * read this and found nothing worth writing* is observable nowhere, and is
   * indistinguishable from a source nobody opened — which made every
   * deliberately-discarded source a permanent `source.uncited` finding
   * (`adr:0021-sources-are-stored-not-parsed`).
   *
   * Absent means unprocessed. There is deliberately no `processed: false`: one
   * field cannot then disagree with its own date, and a manifest written before
   * this existed is a valid manifest of an unprocessed source.
   */
  processed?: string;
  /**
   * What this source is about, and why it matters here — written by whoever
   * read it (plan 8.1).
   *
   * `fnd348r34nr483r.txt` is a real filename and it says nothing, and
   * `adr:0011-sources-are-named-by-what-they-are` freezes the id from it,
   * permanently — so the id says nothing either. Task 6.7 answered half of that
   * by keeping the title editable; this is the other half, and the agent is the
   * only party that can write it, because writing it requires having read the
   * file.
   *
   * A field, not a document. If what there is to say needs sections, it is a
   * wiki page citing this source: `raw/` holding prose with structure would be
   * a second wiki that nothing validates, indexes or links to. `updateManifest`
   * is where that line is drawn, because that is where this application writes.
   */
  description?: string;
  /**
   * `"superseded"` once this source has been replaced, absent while it stands
   * (plan 8.5).
   *
   * **The page's vocabulary, not a second one.** `status`, `superseded-by` and
   * a date are the three fields the glossary's supersession entry names, and
   * task 5.2 already writes them on a page. A source gets the same three, so a
   * reader who learned one has learned the other — which is also why
   * `specs/source-status` deliberately did *not* call the processed declaration
   * `status`.
   *
   * The bytes under `raw/` are frozen, so a correction cannot be an edit: it is
   * a new source that supersedes the old, and every citation into the old one
   * keeps resolving — at something that now says it was replaced, and by what.
   */
  status?: "superseded";
  /**
   * The id of the source that replaced this one; `""` when the record says it
   * was replaced but not by what.
   *
   * Empty is reachable only from a manifest this application did not write. It
   * is kept rather than refused because reading a half-written supersession as
   * *active* is the silent resolution to withdrawn evidence that this whole
   * field exists to prevent — so the two disagree in the loud direction.
   */
  "superseded-by"?: string;
  /**
   * The date the supersession was recorded, absent when the record does not say.
   *
   * A field named for the event, holding the day it happened — the same idiom
   * as `processed`, rather than a page's `updated`. `updated` on a manifest
   * would read as "when this file last changed", which correcting a title or
   * writing a description would falsify immediately.
   */
  superseded?: string;
}

export class TakenIdError extends Error {
  constructor(public readonly id: string) {
    super(`a source named "${id}" already exists — rename it rather than inventing a suffix`);
    this.name = "TakenIdError";
  }
}

export class MissingSourceError extends Error {
  constructor(public readonly id: string) {
    super(`no source "${id}" under raw/`);
    this.name = "MissingSourceError";
  }
}

export class InvalidManifestError extends Error {
  constructor(
    public readonly id: string,
    detail: string,
  ) {
    super(`the manifest of "${id}" is not one: ${detail}`);
    this.name = "InvalidManifestError";
  }
}

/**
 * Parse a manifest, checking its shape rather than asserting it.
 *
 * `manifest.json` is a file in a project directory, so it **arrives with a
 * clone** — it is not something this application necessarily wrote. `JSON.parse`
 * returns `any` and casting it to `SourceManifest` checks nothing, so a `title`
 * that is an object reached the screen as a React child and blanked the whole
 * window: there is no error boundary, and every page citing that source went
 * with it. A refusal naming the source is recoverable; a blank window is not.
 *
 * **The id comes from the directory, never from the file.** `adr:0011` freezes an
 * id as the directory name, so a manifest claiming a different one is claiming
 * something it does not get to decide.
 */
export function parseManifest(id: string, text: string): SourceManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new InvalidManifestError(id, "it does not parse as JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new InvalidManifestError(id, "it is not a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  const title = record["title"];
  const kind = record["kind"];
  if (typeof title !== "string") {
    throw new InvalidManifestError(id, "`title` is missing or is not a string");
  }
  if (kind !== "file" && kind !== "recording") {
    throw new InvalidManifestError(id, '`kind` is neither "file" nor "recording"');
  }
  const original = record["original"];
  // A declaration that is not a date degrades to unprocessed rather than
  // refusing the manifest, and the direction is chosen rather than convenient:
  // reading as *unprocessed* costs a re-read, reading as *processed* drops the
  // source out of the queue and out of the uncited check at once — a source
  // silently never read again. `title` is refused instead of degraded because
  // there is no safe default for it; here there is.
  const processed = record["processed"];
  // Read whatever length is there. The bound is a rule about what *this*
  // application writes (`updateManifest`), and applying it here would silently
  // truncate somebody else's data on a file that arrived with a clone —
  // destroying it on the read path, where nothing asked for a write at all.
  const description = record["description"];
  // Supersession is read as **one** fact from up to three keys, and either of
  // the two that can carry it is enough. A manifest arrives with a clone, so
  // `status` without a pointer and a pointer without `status` both occur; the
  // safe reading of each is *superseded*, because the alternative is a citation
  // resolving silently to evidence somebody withdrew. An unrecognised `status`
  // is not a claim of supersession and degrades to active, the same direction —
  // and by the same argument — as a malformed `processed`.
  const supersededBy = record["superseded-by"];
  const pointer = typeof supersededBy === "string" ? supersededBy.trim() : "";
  const superseded = record["status"] === "superseded" || pointer !== "";
  const date = record["superseded"];
  return {
    id,
    title,
    kind,
    original: typeof original === "string" ? original : "",
    ...(isDate(processed) ? { processed } : {}),
    ...(typeof description === "string" ? { description } : {}),
    ...(superseded
      ? {
          status: "superseded" as const,
          "superseded-by": pointer,
          ...(isDate(date) ? { superseded: date } : {}),
        }
      : {}),
  };
}

/**
 * A manifest with **every** free-text field cut to what a reader's context can
 * hold. A rendering: the stored file is untouched.
 *
 * `parseManifest` deliberately keeps whatever length it finds, because
 * truncating on the read path would destroy somebody's data on a file that
 * arrived with a `git clone` and that nobody asked to write. Bounding therefore
 * belongs to each *view* — and this is that rule in one place rather than in
 * each view.
 *
 * **It is one function because the per-caller version has now failed three
 * times.** `boundedText` went into `ow source list`, and a security review
 * found the MCP tools; a second pass found three desktop call sites; task 8.5
 * added `superseded-by` and a third review found that `ow graph superseded` and
 * the MCP tools printed the new field unbounded — because each of those callers
 * bounds a *list of fields it knows*, and a field added later is a field the
 * list does not have. Adding one here reaches every view at once, which is what
 * the copies could never do.
 */
export function boundedManifest(manifest: SourceManifest): SourceManifest {
  return {
    ...manifest,
    title: boundedText(manifest.title),
    ...(manifest.description !== undefined
      ? { description: boundedText(manifest.description) }
      : {}),
    ...(manifest["superseded-by"] !== undefined
      ? { "superseded-by": boundedText(manifest["superseded-by"]) }
      : {}),
    // `superseded` and `processed` are not bounded because they are not free
    // text: `parseManifest` drops either unless it is a `YYYY-MM-DD` date, so
    // there is no length for a hostile manifest to choose.
  };
}

/**
 * The confined path of a source's manifest; throws if the id escapes `raw/`.
 *
 * An id is not a path. It reaches here straight out of a page's prose — a
 * citation like `src://../../elsewhere#p1` parses as an id — so confining is
 * this module's job and not the caller's. `raw/` is the root, not the project:
 * a source that resolved to somewhere else inside the project would still not
 * be a source.
 */
/**
 * Where a source's files are: found by the walk, or `raw/<id>` when nothing
 * matches — confined against `raw/` either way.
 *
 * **The one place this rule is written.** Task 8.3 needed it at six call sites
 * — this module twice, `writeSourceText`, MCP's `sourceTextPath`, the desktop's
 * `locateCitation` and `waveformOf`, and `readTimeMap` — and the first version
 * hand-rolled it at each, in two slightly different confinement shapes. A
 * review pointed out that this is precisely the lesson the same branch had
 * already learned twice, in `boundedText` and `readManifestAt`: a rule copied
 * per caller is a rule the next caller does not get. Two of the six were found
 * by review rather than by me, which is the evidence for it.
 *
 * The fallback is not laziness. "Not found" and "escapes `raw/`" are different
 * failures that must both fail, and routing the miss back through
 * `assertWithin` keeps `OutsideProjectError` as the thing an escaping id
 * raises — callers catch it by name — while leaving a merely-absent id to
 * whatever "no such source" answer each caller gives. It also serves a source
 * mid-registration, which has no `manifest.json` yet and so is invisible to the
 * walk while its directory is nonetheless the right one.
 */
export function resolvedSourceDir(projectRoot: string, id: string): string {
  return confine(projectRoot, sourceDirOf(projectRoot, id), id);
}

/**
 * The rule itself, over a directory the caller has already looked up: what the
 * walk found, or `raw/<id>` when it found nothing, confined against `raw/`
 * either way.
 *
 * Separate from `resolvedSourceDir` only so `requireSourceDir` can walk once
 * and still apply the identical rule. Nothing outside this module needs it:
 * a caller that has not walked wants `resolvedSourceDir`.
 */
function confine(projectRoot: string, found: string | undefined, id: string): string {
  const rawDir = join(projectRoot, "raw");
  return assertWithin(rawDir, found ?? join(rawDir, id));
}

/**
 * The confined path of a source's manifest; throws if the id escapes `raw/`.
 *
 * An id is not a path. It reaches here straight out of a page's prose — a
 * citation like `src://../../elsewhere#p1` parses as an id — so confining is
 * this module's job and not the caller's.
 */
function manifestPath(projectRoot: string, id: string): string {
  return join(resolvedSourceDir(projectRoot, id), "manifest.json");
}

/**
 * Where the source with this id sits, or `undefined`.
 *
 * Re-exported here because this is the module every source reader already
 * imports; the walk itself lives in `locate.ts`.
 */
export function sourceDir(projectRoot: string, id: string): string | undefined {
  return sourceDirOf(projectRoot, id);
}

/**
 * The directory of the source with this id, or `MissingSourceError`.
 *
 * What a writer wants: every path under a source is built from this rather than
 * from `raw/<id>`, which stopped being where a source necessarily lives at 8.3.
 */
export function requireSourceDir(projectRoot: string, id: string): string {
  // One walk, not two. Asking `resolvedSourceDir` and then `sourceDirOf`
  // separately walked `raw/` twice on every manifest write — the regression
  // this branch fixed three times elsewhere and reintroduced here. Both now go
  // through `confine`, so the rule is still written once.
  //
  // The confinement is unchanged and still comes first: an escaping id raises
  // `OutsideProjectError` before a miss becomes the softer `MissingSourceError`
  // — different failures, and the callers tell them apart.
  const found = sourceDirOf(projectRoot, id);
  const resolved = confine(projectRoot, found, id);
  if (found === undefined) throw new MissingSourceError(id);
  return resolved;
}

/**
 * Read a source's manifest. Throws `MissingSourceError` if it is not there, and
 * `InvalidManifestError` if what is there is not a manifest.
 */
export function readManifest(projectRoot: string, id: string): SourceManifest {
  const file = manifestPath(projectRoot, id);
  if (!existsSync(file)) throw new MissingSourceError(id);
  return parseManifest(id, readFileSync(file, "utf8"));
}

/**
 * Read a manifest from a directory already resolved.
 *
 * For a caller that has walked once and is iterating: `readManifest` resolves
 * the id itself, so calling it per source turned one walk into one walk *per
 * source*. `checkRecords` and `listSourceStates` both do exactly that, which
 * made a listing quadratic in the size of `raw/` — the regression `checkLinks`
 * already hoists `linkableSlugs` out of its own loop to avoid.
 *
 * **Precondition, unchecked: `dir` must have come from `listSourceRefs`.** This
 * confines nothing itself — it reads the path it is given — and it is safe only
 * because the walk cannot produce a path outside `raw/`, skipping symlinked
 * directories at every level. A security review flagged that the signature says
 * none of this, so: a caller that builds `dir` from a setting, a citation or any
 * other lookup reintroduces an unconfined read, and should use `readManifest`
 * or `resolvedSourceDir` instead.
 */
export function readManifestAt(dir: string, id: string): SourceManifest {
  const file = join(dir, "manifest.json");
  if (!existsSync(file)) throw new MissingSourceError(id);
  return parseManifest(id, readFileSync(file, "utf8"));
}

/** True when a source directory with this id exists under `raw/`. */
export function sourceExists(projectRoot: string, id: string): boolean {
  try {
    return existsSync(manifestPath(projectRoot, id));
  } catch (e) {
    // An id that escapes `raw/` names no source. The caller gets `false` and
    // renders "points at no source", which is both true and the whole answer.
    if (e instanceof OutsideProjectError) return false;
    throw e;
  }
}

/**
 * List every source id under `raw/`, excluding the `_inbox` doorway and any
 * loose file that is not a source directory. A source is a directory holding a
 * `manifest.json`.
 */
export function listSources(projectRoot: string): string[] {
  // At any depth since task 8.3 — a folder is organisation and the id is the
  // name. This read one level of `raw/`, which made every filed source
  // invisible to the listing, the checks, the CLI and MCP, exactly as reading
  // one level of `wiki/` once did before `adr:0016`.
  return listSourceRefs(projectRoot).map((ref) => ref.id);
}
