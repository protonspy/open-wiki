import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { boundedManifest, readManifestAt, requireSourceDir, type SourceKind } from "./manifest.js";
import { listSourceRefs } from "./locate.js";

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
  /**
   * The date somebody declared they had finished reading this source, absent
   * when nobody has (`specs/source-status`, R1.1).
   *
   * **Beside `stage`, deliberately not inside it.** Every member of
   * `SourceStage` is observed on disk; this one is a judgement somebody made,
   * and it is the only thing here that is. Folding it in would put one declared
   * value among four derived ones in a single field, and every reader would
   * then have to know which of its members it may not trust the filesystem for.
   *
   * The two are also independent: a source can be processed and uncited — read
   * and found not worth writing about, which is the case this exists for — or
   * cited and never declared.
   */
  processed?: string;
  /**
   * What the source is about, written by whoever read it (plan 8.1).
   *
   * Carried here because this is what the agent's loop reads. The whole point
   * of writing a description is that the next reader — another agent, the
   * sources pane, a consulting project — gets it **without opening the source
   * again**, and opening it is the expensive part.
   */
  description?: string;
  /**
   * Present once this source has been replaced by another (plan 8.5): the
   * replacement's id, and the day it was recorded.
   *
   * **Beside `stage` for the same reason `processed` is** — supersession is a
   * judgement, not a place in the pipeline, and a superseded source still has
   * whatever stage its files give it. Carried here rather than left to a second
   * read because this is the view every reader already builds, and a
   * supersession nobody sees is the silent resolution to withdrawn evidence
   * that recording it exists to prevent.
   *
   * `by` is `""` when the record says it was replaced but not by what, which is
   * only reachable from a manifest this application did not write.
   */
  superseded?: { by: string; date?: string };
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

function readJournal(dir: string): Journal | null {
  try {
    const file = join(dir, "journal.json");
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
  resolvedDir?: string,
): SourceState {
  // Where the source actually sits, which since task 8.3 is not necessarily
  // `raw/<id>`: a folder is organisation and the id is the name. Resolved once
  // and reused, so this and the manifest cannot end up describing two different
  // directories — and confined against `raw/`, not merely the project, because
  // an id like `../wiki` stays inside the project and still names no source.
  //
  // `resolvedDir` is what a caller iterating over sources passes in. Without
  // it, resolving here *and* inside `readManifest` meant two full walks of
  // `raw/` per source, so listing N sources walked the tree 2N+1 times.
  const dir = resolvedDir ?? requireSourceDir(projectRoot, id);
  // Bounded as a whole rather than field by field. Three successive security
  // reviews found a view that bounded the fields it knew and missed one added
  // later — the last of them `superseded-by`, at task 8.5 — so the rule lives
  // in `boundedManifest` and a field added there reaches every view at once.
  const manifest = boundedManifest(readManifestAt(dir, id));
  const textReady = existsSync(join(dir, "text.md"));

  const journal = readJournal(dir);
  const chunks = journal?.chunks ?? [];
  const done = chunks.filter((c) => c.done).length;
  const failed = chunks.find((c) => c.error)?.error ?? journal?.error;

  // **The free text is bounded here, once, for every reader.**
  //
  // `readManifest` is the file and keeps whatever length it finds — truncating
  // on the read path would destroy somebody's data on a manifest that arrived
  // with a `git clone` and that nobody asked to write. `sourceState` is the
  // *view*, and a multi-megabyte description is one source crowding every other
  // out of whoever is looking.
  //
  // It sits here rather than in each caller because there turned out to be
  // four — `ow source list`, the desktop's `sources()`, its `sourceRows` and
  // its `sourceDetail` — and two successive security reviews each found one the
  // previous fix had missed. A rule copied per caller is a rule the next caller
  // does not get. The MCP tools bound separately because they serve
  // `readManifest` directly and never build a `SourceState`.
  const base = {
    id,
    title: manifest.title,
    kind: manifest.kind,
    // Carried on every stage, because the question it answers — has anybody
    // finished with this — is orthogonal to how far the pipeline got.
    ...(manifest.processed !== undefined ? { processed: manifest.processed } : {}),
    ...(manifest.description !== undefined ? { description: manifest.description } : {}),
    // Carried on every stage, like `processed`: being replaced says nothing
    // about how far the pipeline got with the bytes that are still there.
    ...(manifest.status === "superseded"
      ? {
          superseded: {
            by: manifest["superseded-by"] ?? "",
            ...(manifest.superseded !== undefined ? { date: manifest.superseded } : {}),
          },
        }
      : {}),
    textReady,
    citedBy: [...citedBy],
  };

  // A chunk that failed is not a transcription that stopped. The pipeline
  // (4.9) records a chunk's error and carries on to the next one, because 6.3
  // offers "redo only what failed" and that needs the rest attempted — so a
  // single 429 twelve minutes into a healthy run would otherwise make the
  // source read as `failed`, with a progress count that keeps climbing, for
  // the rest of the run.
  //
  // `failed` means nothing is left to try: every chunk has been attempted and
  // at least one did not succeed. The error is carried either way, so a caller
  // showing a source in flight can still say what went wrong on the way.
  const untried = chunks.some((c) => !c.done && c.error === undefined);
  const stopped =
    journal?.error !== undefined || (chunks.length > 0 && !untried && done < chunks.length);
  const error = failed !== undefined ? { error: failed } : {};

  if (stopped && !textReady) {
    return { ...base, stage: "failed", ...error, ...progressOf(chunks.length, done) };
  }
  // `textReady` gates "cited" on purpose: a page citing a source whose text
  // never landed is citing something nothing could have read, and reporting
  // that as the last stage of the pipeline would hide it. The citation is still
  // recorded in `citedBy`, so the caller can say both things.
  if (textReady) return { ...base, stage: citedBy.length > 0 ? "cited" : "text-ready" };
  if (chunks.length > 0) {
    return { ...base, stage: "transcribing", ...error, ...progressOf(chunks.length, done) };
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
  const states: SourceState[] = [];
  // One walk for the whole listing, and the directory it found handed to each
  // state. Calling `sourceState` by id alone made this walk `raw/` twice per
  // source — quadratic in a tree whose size grows with the number of sources.
  for (const ref of listSourceRefs(projectRoot)) {
    try {
      states.push(sourceState(projectRoot, ref.id, citations.get(ref.id) ?? [], ref.dir));
    } catch {
      // `listSources` only checks that `manifest.json` exists. One that will
      // not parse, or a source deleted between the listing and the read, must
      // not take the other nineteen with it — a sources screen showing nothing
      // because of one bad directory is worse than one showing nineteen.
      continue;
    }
  }
  return states.sort((a, b) => a.id.localeCompare(b.id));
}
