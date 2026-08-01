import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { assertWithin } from "../paths.js";
import { listSources, readManifest, type SourceKind } from "./manifest.js";

/**
 * Each source's state (plan 6.1): received, text ready, cited on a page.
 *
 * **Derived from disk, not persisted beside it.** "Persisted and resumable" is
 * what the plan asks for, and the filesystem already is both: `manifest.json`
 * says the source was received, `text.md` says the text is ready, the pages say
 * what is cited, and `journal.json` says how far a transcription got. A state
 * file next to those would be a second record of one fact — and the copy is the
 * one that goes stale, which is the rule the plan applies to its own checklists
 * (`routing.md`) and to the wiki's index.
 *
 * So a crash loses nothing and there is nothing to reconcile: the next read
 * observes the same directory and reaches the same answer.
 */

export type SourceStage =
  /** The directory and manifest exist; nothing has been extracted yet. */
  | "received"
  /** Transcription is part-done — a journal is present and unfinished (4.9). */
  | "transcribing"
  /** `text.md` is written and the source is readable. */
  | "text-ready"
  /** At least one page cites it. */
  | "cited"
  /** It stopped, and the reason is worth showing rather than retrying blindly. */
  | "failed";

export interface SourceState {
  id: string;
  title: string;
  kind: SourceKind;
  stage: SourceStage;
  /** True once `text.md` exists, whatever the stage says. */
  textReady: boolean;
  /** The pages citing this source, as project-relative paths. */
  citedBy: string[];
  /** Why it stopped, when it did. */
  error?: string;
  /** Chunks done / total, while a transcription is in flight (4.9, 6.3). */
  progress?: { done: number; total: number };
}

/** The transcription journal group 4 writes; read here, never written here. */
interface Journal {
  chunks?: Array<{ index?: number; done?: boolean; error?: string }>;
  error?: string;
}

function readJournal(projectRoot: string, id: string): Journal | null {
  try {
    const file = assertWithin(projectRoot, join(projectRoot, "raw", id, "journal.json"));
    if (!existsSync(file) || !statSync(file).isFile()) return null;
    return JSON.parse(readFileSync(file, "utf8")) as Journal;
  } catch {
    // A journal that will not parse is not a reason to hide the source; the
    // stage falls back to what the rest of the directory says.
    return null;
  }
}

/**
 * The state of one source. `citedBy` is supplied by the caller because working
 * it out means reading every page, and a listing of twenty sources must not do
 * that twenty times.
 */
export function sourceState(
  projectRoot: string,
  id: string,
  citedBy: readonly string[] = [],
): SourceState {
  const manifest = readManifest(projectRoot, id);
  const dir = assertWithin(projectRoot, join(projectRoot, "raw", id));
  const textReady = existsSync(join(dir, "text.md"));

  const journal = readJournal(projectRoot, id);
  const chunks = journal?.chunks ?? [];
  const done = chunks.filter((c) => c.done).length;
  const failed = chunks.find((c) => c.error)?.error ?? journal?.error;

  const base = {
    id,
    title: manifest.title,
    kind: manifest.kind,
    textReady,
    citedBy: [...citedBy],
  };

  if (failed !== undefined && !textReady) {
    return { ...base, stage: "failed", error: failed, ...progressOf(chunks.length, done) };
  }
  // `textReady` gates "cited" on purpose: a page citing a source whose text
  // never landed is citing something nothing could have read, and reporting
  // that as the last stage of the pipeline would hide it. The citation is still
  // recorded in `citedBy`, so the caller can say both things.
  if (textReady) return { ...base, stage: citedBy.length > 0 ? "cited" : "text-ready" };
  if (chunks.length > 0) {
    return { ...base, stage: "transcribing", ...progressOf(chunks.length, done) };
  }
  return { ...base, stage: "received" };
}

function progressOf(total: number, done: number): { progress?: { done: number; total: number } } {
  return total > 0 ? { progress: { done, total } } : {};
}

/**
 * Every source's state in one pass. `citations` maps a source id to the pages
 * citing it — `citedSourcePages` in the check module builds it from one read of
 * the wiki.
 */
export function listSourceStates(
  projectRoot: string,
  citations: ReadonlyMap<string, string[]> = new Map(),
): SourceState[] {
  return listSources(projectRoot)
    .map((id) => sourceState(projectRoot, id, citations.get(id) ?? []))
    .sort((a, b) => a.id.localeCompare(b.id));
}
