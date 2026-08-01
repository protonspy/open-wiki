import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deriveId, isIdTaken } from "./id.js";

/**
 * A source is any entry in `raw/`: an uploaded file or a recording. It becomes
 * a directory `raw/<id>/` holding the preserved original and a `manifest.json`,
 * and the id is frozen there the moment it is written
 * (`adr:0011-sources-are-named-by-what-they-are`). The readable title lives in
 * the manifest and may drift; the id never does.
 *
 * `raw/_inbox/` is a doorway, not a source — it is not enumerated, cited or
 * reported, so nothing here treats it as one.
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

/** The path of the original file inside a file source's directory. */
function originalFile(id: string): string {
  // `Arquitetura Fenix.pdf` → `source.pdf`; a name with no extension → `source`.
  const dot = id.lastIndexOf(".");
  const ext = dot > 0 ? id.slice(dot) : "";
  return `source${ext}`;
}

export interface RegisterInput {
  name: string;
  kind: SourceKind;
  content: Buffer | null;
  /** Override the readable title (defaults to `name`). */
  title?: string;
}

/**
 * Register a source: derive the id, refuse a taken one, create the directory,
 * preserve the original (for a file), and write the manifest. The directory is
 * immutable once written — re-registering the same id is refused, which is the
 * freeze the citations depend on.
 */
export function registerSource(projectRoot: string, input: RegisterInput): { id: string } {
  const id = deriveId(input.name);
  if (isIdTaken(projectRoot, id)) throw new TakenIdError(id);

  const dir = join(projectRoot, "raw", id);
  mkdirSync(dir, { recursive: true });

  if (input.kind === "file") {
    if (input.content === null) {
      throw new Error(`file source "${id}" has no content to preserve`);
    }
    writeFileSync(join(dir, originalFile(id)), input.content);
  }

  const manifest: SourceManifest = {
    id,
    title: input.title ?? input.name,
    kind: input.kind,
    original: input.kind === "file" ? input.name : "",
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return { id };
}

/** Read a source's manifest. Throws `MissingSourceError` if it is not there. */
export function readManifest(projectRoot: string, id: string): SourceManifest {
  const file = join(projectRoot, "raw", id, "manifest.json");
  if (!existsSync(file)) throw new MissingSourceError(id);
  return JSON.parse(readFileSync(file, "utf8"));
}

/** True when a source directory with this id exists under `raw/`. */
export function sourceExists(projectRoot: string, id: string): boolean {
  return existsSync(join(projectRoot, "raw", id, "manifest.json"));
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
