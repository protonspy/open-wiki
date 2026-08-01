import { relative, sep } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { areaOf, isOpenPage, type ChangeKind, type ProjectChange } from "../shared/changes.js";

/**
 * Watching the project and reflecting it on screen live (plan 8.10).
 *
 * Whoever wrote it — the agent through its own tools, a hook, the user in
 * Obsidian, this application's own editor. The plan is explicit that this is
 * the path that catches what the gate cannot see, and group 5 says what it can
 * and cannot do: it records and redraws, and it refuses nothing.
 *
 * `awaitWriteFinish` is not tuning. `fs.watch` reports a file the moment it
 * appears, which on a copy is halfway through being written — and a page read
 * halfway through is a page with no frontmatter, which the screen would then
 * render as broken (`docs/stack.md`, on chokidar).
 */

/**
 * Re-exported for the main process and the tests, which reach the whole of this
 * concern through one module. **The renderer must import them from
 * `../shared/changes.js` instead** — reaching them through here drags chokidar
 * into a browser bundle, which is a build failure rather than a preference.
 */
export { areaOf, isOpenPage, type ChangeKind, type ProjectChange };

export interface WatchOptions {
  /** Milliseconds of quiet before a write counts as finished. */
  stabilityMs?: number;
}

/** The two directories a screen renders. `.state/` is not content (plan 2.1). */
const WATCHED = ["wiki", "raw"];

/** A project-relative, forward-slashed path, or `null` when it escaped. */
export function toProjectPath(projectRoot: string, absolute: string): string | null {
  const rel = relative(projectRoot, absolute);
  // `startsWith("..")` alone would reject a legitimate top-level entry named
  // `..foo`. The separator is what makes it mean "above here".
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) return null;
  return rel.split(sep).join("/");
}

export function describeChange(
  projectRoot: string,
  kind: ChangeKind,
  absolute: string,
): ProjectChange | null {
  const path = toProjectPath(projectRoot, absolute);
  if (path === null) return null;
  return { kind, path, area: areaOf(path) };
}

/**
 * Start watching. Returns the watcher so a window can close it — an Electron
 * window that reloads without doing so leaves a second watcher on the same
 * tree, and every change then arrives twice.
 */
export function watchProject(
  projectRoot: string,
  onChange: (change: ProjectChange) => void,
  options: WatchOptions = {},
): FSWatcher {
  const stabilityMs = options.stabilityMs ?? 200;
  const watcher = chokidar.watch(
    WATCHED.map((part) => `${projectRoot}/${part}`),
    {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: stabilityMs, pollInterval: 50 },
    },
  );
  const emit = (kind: ChangeKind) => (absolute: string) => {
    const change = describeChange(projectRoot, kind, absolute);
    if (change) onChange(change);
  };
  watcher.on("add", emit("added"));
  watcher.on("change", emit("changed"));
  watcher.on("unlink", emit("removed"));
  // A watcher that throws takes the window's live view with it, and a project
  // on a network share raises EPERM for reasons that have nothing to do with
  // this application. The screen stops updating; it does not go blank.
  watcher.on("error", () => {});
  return watcher;
}
