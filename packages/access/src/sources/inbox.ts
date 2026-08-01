import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { assertWithin } from "../paths.js";
import { INBOX } from "./manifest.js";
import { MAX_SOURCE_BYTES, ingestSource, type IngestOutcome } from "./upload.js";

/**
 * `raw/_inbox/` — the doorway (plan 3.7). It is how an agent hands over material
 * it fetched, now that no MCP tool ingests: it writes the file into the inbox
 * with its own tools and the ingestion happens here, through the same path as a
 * file the user dragged onto the window (3.1).
 *
 * **The inbox is the one mutable thing under `raw/`.** It is not a source: it is
 * emptied by ingestion, nothing enumerates it (`listSources` skips it), nothing
 * cites it, and 6.6's "sitting in raw/ and never cited" never reports it. What
 * a file in the inbox turns into is a source, immutable like any other.
 *
 * A file that could not be ingested **stays where it is**, with the reason
 * reported. It is the user's file, and moving or deleting it to keep the
 * doorway tidy would lose material that nothing else holds a copy of.
 *
 * Nothing wires the watcher up yet — group 8's shell is what will run it. Until
 * then `drainInbox` is the whole doorway, callable by hand.
 */

export { INBOX };

/**
 * The inbox directory of a project.
 *
 * Confined against the **project**, not against `raw/`. Rooting the assertion at
 * `raw/` asserts nothing about `raw/` itself, so a symlink or Windows junction
 * standing where `raw/` should be would carry the whole doorway — and the reads
 * and writes that follow it — outside the project. That is the escape
 * `resolveReal` exists to stop (`paths.ts`), and it has to be checked at the
 * outermost segment the caller controls.
 */
export function inboxPath(projectRoot: string): string {
  return assertWithin(projectRoot, join(projectRoot, "raw", INBOX));
}

/** Create the inbox if it is not there. Called by the scaffolder and the watcher. */
export function ensureInbox(projectRoot: string): string {
  const dir = inboxPath(projectRoot);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** What happened to one file in the inbox, and whether it is still there. */
export type InboxOutcome = IngestOutcome & { removed: boolean };

export { MAX_SOURCE_BYTES };

/**
 * Ingest everything sitting in the inbox, in name order, and remove each file
 * that became a source. Returns one outcome per file it looked at.
 *
 * Idempotent: a second call sees only what the first could not ingest.
 *
 * **This reads the whole directory.** Pass `stabilityMs` to have each file
 * observed twice before it is read, which is what keeps a file still being
 * copied in from being frozen as half a source. `watchInbox` sets it, and also
 * ingests the one path an event named rather than re-reading everything.
 */
export async function drainInbox(
  projectRoot: string,
  options: IngestEntryOptions = {},
): Promise<InboxOutcome[]> {
  const dir = inboxPath(projectRoot);
  if (!existsSync(dir)) return [];

  const outcomes: InboxOutcome[] = [];
  // Sorted so a batch is reported in a stable order rather than in whatever
  // order the filesystem happens to return.
  for (const name of readdirSync(dir).sort()) {
    // One entry must never end the batch. Everything below reports its own
    // reason and moves to the next file — the caller dropped several.
    const outcome = await ingestInboxEntry(projectRoot, name, options);
    // `null` is "still being written": not a refusal, and not this drain's to
    // report. The next event picks it up.
    if (outcome !== null) outcomes.push(outcome);
  }
  return outcomes;
}

export interface IngestEntryOptions {
  /**
   * Observe the file twice, this many milliseconds apart, and skip it when it
   * changed in between — it is still being written.
   *
   * This is ours rather than chokidar's on purpose. chokidar applies
   * `awaitWriteFinish` **only after it has emitted `ready`** (`index.js`: the
   * `_readyEmitted` guard on the add/change branch), so every file present at
   * startup, and every file created in the window before the initial scan
   * finishes, is announced with no stability check at all. Reading one of those
   * mid-copy freezes half a document as an immutable source and deletes the
   * user's only copy. A guarantee that holds on every path has to live here.
   */
  stabilityMs?: number;
}

/** True when the file's size and mtime are the same on both sides of the wait. */
async function hasSettled(file: string, stabilityMs: number): Promise<boolean> {
  const before = lstatSync(file);
  await new Promise((resolve) => setTimeout(resolve, stabilityMs));
  if (!existsSync(file)) return false;
  const after = lstatSync(file);
  return before.size === after.size && before.mtimeMs === after.mtimeMs;
}

/**
 * Ingest one named entry of the inbox, reporting rather than throwing. `name`
 * is a bare filename; a path is reduced to its basename, because the inbox is
 * flat and nothing below it is the caller's to reach.
 *
 * Returns `null` when the file is still being written — not a refusal, because
 * nothing is wrong with it: it is simply not finished, and the next event picks
 * it up.
 */
export async function ingestInboxEntry(
  projectRoot: string,
  entryName: string,
  options: IngestEntryOptions = {},
): Promise<InboxOutcome | null> {
  const name = basename(entryName);
  const refuse = (reason: string): InboxOutcome => ({
    ok: false,
    name,
    format: null,
    reason,
    removed: false,
  });

  try {
    const dir = inboxPath(projectRoot);
    // `lstat` before anything resolves the path: it describes the link itself,
    // where `assertWithin` would follow it and report the target.
    const stat = lstatSync(join(dir, name));

    if (stat.isSymbolicLink()) {
      // Following it would copy a file from anywhere on disk into the project
      // under a name of the dropper's choosing. The inbox takes files, not
      // pointers at files — including one pointing back inside the project,
      // which would ingest a page as though it were a source.
      return refuse(`"${name}" is a symbolic link; the inbox takes files, not links to them`);
    }
    if (stat.isDirectory()) {
      return refuse(`"${name}" is a directory; drop the files themselves into the inbox`);
    }
    if (!stat.isFile()) {
      return refuse(`"${name}" is not a regular file`);
    }
    if (stat.size > MAX_SOURCE_BYTES) {
      // Refused on the stat, so a file too large to hold in memory is never
      // read into memory to find that out.
      return refuse(
        `"${name}" is ${stat.size} bytes, over the ${MAX_SOURCE_BYTES}-byte limit for a source`,
      );
    }

    const file = assertWithin(dir, join(dir, name));

    const stabilityMs = options.stabilityMs ?? 0;
    if (stabilityMs > 0 && !(await hasSettled(file, stabilityMs))) return null;

    const outcome = await ingestSource(projectRoot, name, readFileSync(file));
    if (outcome.ok) rmSync(file, { force: true });
    return { ...outcome, removed: outcome.ok };
  } catch (err) {
    return refuse(err instanceof Error ? err.message : String(err));
  }
}

export interface InboxWatcher {
  /** Stop watching. Safe to call more than once. */
  close(): Promise<void>;
  /** Drain the whole directory now, without waiting for an event. */
  drain(): Promise<InboxOutcome[]>;
}

export interface WatchInboxHandlers {
  /** Called once per file, whether it became a source or not. */
  onOutcome: (outcome: InboxOutcome) => void;
  /**
   * Called when the doorway itself stops working — an unreadable directory, a
   * watch that failed. Without it these are invisible: the watcher goes quiet
   * and a quiet watcher is indistinguishable from an empty inbox.
   */
  onError?: (error: Error) => void;
}

export interface WatchInboxOptions {
  /**
   * How long a file's size must hold steady before it is considered fully
   * written. A file being copied in arrives in pieces, and ingesting half a PDF
   * would register a source that is permanently wrong.
   */
  stabilityThreshold?: number;
  pollInterval?: number;
}

/**
 * Watch the inbox and ingest what lands there.
 *
 * **Per file, not per directory.** `awaitWriteFinish` holds an event back until
 * *that* file's size has settled, so the path an event names is the one that is
 * safe to read. Draining the whole directory on every event throws that away:
 * the event for a small file that finished copying would pull in a large one
 * still mid-copy, register half of it as an immutable source, and delete the
 * user's only copy. So an event ingests exactly the file it named.
 *
 * chokidar is loaded through a dynamic import so the module graph a hook pays
 * for stays free of a file watcher.
 */
export async function watchInbox(
  projectRoot: string,
  handlers: WatchInboxHandlers,
  options: WatchInboxOptions = {},
): Promise<InboxWatcher> {
  const dir = ensureInbox(projectRoot);
  const { watch } = await import("chokidar");

  const report = (error: unknown): void => {
    handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
  };

  // Work is serialised through this chain: an event and an explicit drain must
  // not both read the same file and both try to register the same id.
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  // A refused file stays in the doorway, so every later drain sees it again and
  // the caller — a UI — must not be told twice about the same one.
  //
  // Keyed by the *file*, not by its name. Remembering the name alone means a
  // second, different file dropped under a name that once failed is silently
  // suppressed, and silence is how success looks here. Nor can this hang off
  // chokidar's `unlink`: its `atomic` option folds a delete-and-recreate into a
  // single `change`, so the unlink for exactly this case never arrives.
  const refused = new Map<string, string>();

  const identify = (name: string): string => {
    try {
      const stat = lstatSync(join(dir, name));
      return `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
    } catch {
      return ""; // gone already; the next sighting is a new file
    }
  };

  const announce = (outcome: InboxOutcome): void => {
    if (outcome.ok) {
      refused.delete(outcome.name);
      handlers.onOutcome(outcome);
      return;
    }
    const key = `${identify(outcome.name)}|${outcome.reason}`;
    if (refused.get(outcome.name) === key) return;
    refused.set(outcome.name, key);
    handlers.onOutcome(outcome);
  };

  /** Forget refusals whose file has left the doorway, so a re-drop is heard. */
  const forgetDeparted = (): void => {
    if (refused.size === 0) return;
    let present: Set<string>;
    try {
      present = new Set(readdirSync(dir));
    } catch {
      return; // the directory is unreadable; the drain below reports that
    }
    for (const name of refused.keys()) {
      if (!present.has(name)) refused.delete(name);
    }
  };

  const stabilityMs = options.stabilityThreshold ?? 400;

  const drainAll = async (): Promise<InboxOutcome[]> => {
    forgetDeparted();
    const outcomes = await drainInbox(projectRoot, { stabilityMs });
    for (const outcome of outcomes) announce(outcome);
    return outcomes;
  };

  const watcher = watch(dir, {
    depth: 0, // the doorway is flat
    ignoreInitial: false, // whatever is already sitting there is work to do
    awaitWriteFinish: {
      stabilityThreshold: stabilityMs,
      pollInterval: options.pollInterval ?? 100,
    },
  });

  // chokidar's FSWatcher is a node EventEmitter, and an EventEmitter that emits
  // `error` with nobody listening *throws* — taking the desktop application or
  // the CLI down with it. EMFILE, ELOOP and EIO all reach here.
  watcher.on("error", report);

  // Not what makes a re-drop heard — the identity key above is — but it keeps
  // the map from growing for the life of the session.
  watcher.on("unlink", (path) => refused.delete(basename(path)));

  const consider = (path: string): void => {
    void enqueue(async () => {
      const outcome = await ingestInboxEntry(projectRoot, path, { stabilityMs });
      if (outcome !== null) announce(outcome);
    }).catch(report);
  };

  watcher.on("add", consider);
  // A file that was still growing when it was first seen comes back as a
  // change. Without this it would sit in the doorway until something else
  // happened to trigger a drain.
  watcher.on("change", consider);

  // Return only once the initial scan is done. Before `ready` chokidar applies
  // no write-stability check of its own, and a caller that starts watching and
  // immediately drops a file would otherwise race the scan.
  await new Promise<void>((resolve) => {
    if (watcher.closed) resolve();
    else watcher.once("ready", () => resolve());
  });

  return {
    drain: () => enqueue(drainAll),
    async close() {
      await watcher.close();
      await queue.catch(() => undefined);
    },
  };
}
