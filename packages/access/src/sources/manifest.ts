import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

/** Read a source's manifest. Throws `MissingSourceError` if it is not there. */
export function readManifest(projectRoot: string, id: string): SourceManifest {
  const file = manifestPath(projectRoot, id);
  if (!existsSync(file)) throw new MissingSourceError(id);
  return JSON.parse(readFileSync(file, "utf8"));
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
  for (const entry of readdirSync(raw)) {
    if (entry === "_inbox") continue;
    const dir = join(raw, entry);
    if (!statSync(dir).isDirectory()) continue;
    if (!existsSync(join(dir, "manifest.json"))) continue;
    ids.push(entry);
  }
  return ids;
}