import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

export function registerSource(
  projectRoot: string,
  input: RegisterInput,
): { id: string } {
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

  const manifest = {
    id,
    title: input.title ?? input.name,
    kind: input.kind,
    original: input.kind === "file" ? input.name : "",
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return { id };
}