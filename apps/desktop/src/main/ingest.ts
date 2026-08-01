import { basename, extname } from "node:path";
import { readFile } from "node:fs/promises";
import {
  uploadDocxSource,
  uploadPdfSource,
  uploadTextSource,
  TakenIdError,
  type InboxOutcome,
} from "@open-wiki/access";

/**
 * Files dropped onto the window (plan 3.5).
 *
 * The task asks for two things and the second is the point: *see what was
 * recognised and what was not*. A drop of eleven files where three are
 * unsupported has to say which three — a partial success reported as success
 * is how a source silently never arrives.
 */

export type DropOutcome =
  { name: string; ok: true; id: string } | { name: string; ok: false; reason: string };

/** What each adapter takes, from `docs/stack.md`'s "text extraction" section. */
const ADAPTERS: Record<string, "text" | "pdf" | "docx"> = {
  ".md": "text",
  ".markdown": "text",
  ".txt": "text",
  ".pdf": "pdf",
  ".docx": "docx",
};

export function recognises(name: string): boolean {
  return extname(name).toLowerCase() in ADAPTERS;
}

/** The extensions the drop zone should say it takes. */
export function recognisedExtensions(): string[] {
  return Object.keys(ADAPTERS).sort();
}

/**
 * Ingest one dropped file through the same path 3.1 registers everything with.
 *
 * It reads the file itself rather than taking the renderer's word for the
 * bytes: Chromium hands a drop over as a path, and the content is the thing
 * that becomes an immutable source.
 */
export async function ingestFile(projectRoot: string, path: string): Promise<DropOutcome> {
  const name = basename(path);
  const adapter = ADAPTERS[extname(name).toLowerCase()];
  if (!adapter) {
    return {
      name,
      ok: false,
      reason: `open-wiki takes ${recognisedExtensions().join(", ")} — not ${extname(name) || "a file with no extension"}`,
    };
  }
  try {
    const content = await readFile(path);
    if (adapter === "pdf") {
      const { id } = await uploadPdfSource(projectRoot, name, content);
      return { name, ok: true, id };
    }
    if (adapter === "docx") {
      const { id } = await uploadDocxSource(projectRoot, name, content);
      return { name, ok: true, id };
    }
    const { id } = uploadTextSource(projectRoot, name, content.toString("utf8"));
    return { name, ok: true, id };
  } catch (e) {
    // A name already taken is the one refusal `adr:0011` chose deliberately —
    // the user renames the file rather than the application inventing
    // `arquitetura-fenix (2).pdf` on their behalf — so it is worth saying as
    // itself rather than as "something went wrong".
    if (e instanceof TakenIdError) {
      return {
        name,
        ok: false,
        reason: `a source named "${e.id}" is already here — rename the file`,
      };
    }
    return { name, ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Ingest a whole drop, one file at a time.
 *
 * Serial, and every result reported. One unsupported file must not stop the
 * other ten, and one that failed must not be lost among the ones that worked.
 */
export async function ingestDrop(
  projectRoot: string,
  paths: readonly string[],
): Promise<DropOutcome[]> {
  const outcomes: DropOutcome[] = [];
  for (const path of paths) outcomes.push(await ingestFile(projectRoot, path));
  return outcomes;
}

/**
 * What the inbox watcher saw (plan 3.7), said the way a drop says it.
 *
 * The doorway and the drop zone are two ways into the same registration, so
 * they are worth reporting through one shape: the window already knows how to
 * show "three of four added, and here is the fourth". `removed` is dropped on
 * the way through — whether the file left the doorway is the watcher's
 * bookkeeping, and a reader who was not told the doorway exists cannot be told
 * something stayed in it.
 */
export function asDropOutcome(outcome: InboxOutcome): DropOutcome {
  return outcome.ok
    ? { name: outcome.name, ok: true, id: outcome.id }
    : { name: outcome.name, ok: false, reason: outcome.reason };
}

/**
 * A doorway that stopped working, as an outcome (plan 3.7).
 *
 * Reported rather than logged, because a watcher that goes quiet is
 * indistinguishable from an inbox nobody is using — and the failure it hides is
 * material an agent believes it handed over.
 */
export function inboxFailure(error: Error): DropOutcome {
  return {
    name: "raw/_inbox",
    ok: false,
    reason: `the inbox stopped being watched: ${error.message}`,
  };
}
