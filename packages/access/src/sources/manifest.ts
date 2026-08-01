import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
 * The doorway under `raw/` (plan 3.7). Its name lives here — the leaf every
 * source module already imports — because it is load-bearing in four places at
 * once: the scaffolder creates it, `listSources` must skip it, `isIdTaken` must
 * not treat it as a taken id, and the inbox itself reads it. Four copies of one
 * string mean a rename breaks the quietest of them, and the quietest is
 * `listSources` starting to return `_inbox` as a citable source.
 */
export const INBOX = "_inbox";

export type SourceKind = "file" | "recording";

export interface SourceManifest {
  /** Frozen at write time; equal to the directory name. */
  id: string;
  /** Readable, correctable at any time (`adr:0011`). */
  title: string;
  kind: SourceKind;
  /** The original filename for a file; empty for a recording. */
  original: string;
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
  return { id, title, kind, original: typeof original === "string" ? original : "" };
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
function manifestPath(projectRoot: string, id: string): string {
  const rawDir = join(projectRoot, "raw");
  return assertWithin(rawDir, join(rawDir, id, "manifest.json"));
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
  const raw = join(projectRoot, "raw");
  if (!existsSync(raw)) return [];
  const ids: string[] = [];
  for (const entry of readdirSync(raw, { withFileTypes: true })) {
    if (entry.name === INBOX) continue;
    // `withFileTypes` describes the entry itself, so a dangling symlink is
    // reported rather than stat'd. `statSync` on one throws ENOENT, which used
    // to abort the whole listing — and `ow check` with it.
    if (!entry.isDirectory()) continue;
    const dir = join(raw, entry.name);
    if (!existsSync(join(dir, "manifest.json"))) continue;
    ids.push(entry.name);
  }
  return ids;
}
