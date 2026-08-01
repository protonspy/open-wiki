import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertWithin } from "../paths.js";
import { deriveId, isIdTaken } from "./id.js";
import { TakenIdError, type SourceKind } from "./manifest.js";

/**
 * Register a source: derive the id, refuse a taken one, create the directory,
 * preserve the original (for a file), and write the manifest. The directory is
 * immutable once written — re-registering the same id is refused, which is the
 * freeze the citations depend on (`adr:0011-sources-are-named-by-what-they-are`).
 *
 * Separated from `manifest.ts` so the read surface the MCP process imports
 * (plan 9.9) pulls no write code — this is the only thing here that writes.
 */
export interface RegisterInput {
  name: string;
  kind: SourceKind;
  content: Buffer | null;
  /** Override the readable title (defaults to `name`). */
  title?: string;
}

/** The path of the original file inside a file source's directory. */
function originalFile(id: string): string {
  // `Arquitetura Fenix.pdf` → `source.pdf`; a name with no extension → `source`.
  const dot = id.lastIndexOf(".");
  const ext = dot > 0 ? id.slice(dot) : "";
  return `source${ext}`;
}

export function registerSource(projectRoot: string, input: RegisterInput): { id: string } {
  const id = deriveId(input.name);
  if (isIdTaken(projectRoot, id)) throw new TakenIdError(id);

  // Confine before creating anything. `deriveId` cannot produce a separator or
  // a `..`, so the id is not the risk — `raw/` standing as a symlink or a
  // Windows junction is, and that would put the directory, the preserved
  // original and the manifest outside the project. Refusing after the write
  // would report a failure with the bytes already on disk.
  const dir = assertWithin(projectRoot, join(projectRoot, "raw", id));

  if (input.kind === "file" && input.content === null) {
    // Checked before the directory exists, so a refused registration leaves no
    // empty source behind under an id that is now taken forever.
    throw new Error(`file source "${id}" has no content to preserve`);
  }

  mkdirSync(dir, { recursive: true });

  if (input.kind === "file") {
    writeFileSync(join(dir, originalFile(id)), input.content!);
  }

  const manifest = {
    id,
    title: input.title ?? input.name,
    kind: input.kind,
    original: input.kind === "file" ? input.name : "",
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return { id };
}
