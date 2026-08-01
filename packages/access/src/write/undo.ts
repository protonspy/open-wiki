import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertWithin } from "../paths.js";
import { getOperation } from "./log.js";

/**
 * Thrown by {@link undo} when the id matches no recorded operation.
 */
export class UnknownOperationError extends Error {
  constructor(public readonly id: string) {
    super(`no operation with id ${id}`);
    this.name = "UnknownOperationError";
  }
}

/** A snapshot directory is always a `randomUUID()`. Nothing else may name one. */
const SNAPSHOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The directories undo may write into or delete from.
 *
 * `.state/` is deliberately not among them: the snapshots and the log are how
 * undo works, and an entry naming one of them would have undo eat its own
 * record. Nor is `.claude/`, `.mcp.json` or `CLAUDE.md` — 9.6 keeps the gate's
 * own configuration out of reach of an agent-mediated write, and an operation
 * log is agent-reachable in exactly the same way.
 */
const UNDOABLE = ["wiki/", "raw/"];

/**
 * Undoes an operation by its id (plan task 2.5). Restores the snapshot for a
 * page that existed before, and removes a page the operation created — the
 * `existed` flag recorded at snapshot time is what tells the two apart.
 *
 * **Everything here comes off a file on disk, and that file is content.**
 * `.state/log.jsonl` is gitignored by `ow init`, which stops this project's
 * users from committing one — it does not stop a repository *author* from
 * committing one, and the victim's clone carries whatever is in it. So the
 * snapshot id is checked to be a UUID before it is joined onto a path (a
 * crafted `../..` would otherwise make `assertWithin(snapDir, …)` confine
 * against a root the attacker chose, copying files from outside the project
 * *in*), and every page path is checked to be somewhere undo is allowed to
 * act (a crafted `.git/config` with `existed: false` was otherwise a delete).
 */
export function undo(projectRoot: string, id: string): void {
  const op = getOperation(projectRoot, id);
  if (!op) throw new UnknownOperationError(id);
  if (!SNAPSHOT_ID.test(op.snapshotId)) {
    throw new CorruptOperationError(id, `its snapshot id "${op.snapshotId}" is not one`);
  }
  const snapshots = join(projectRoot, ".state", "snapshots");
  const snapDir = assertWithin(snapshots, join(snapshots, op.snapshotId));

  for (const page of op.pages) {
    // The paths come off the operation log on disk, so they are input, not
    // fact: confine both ends before restoring or removing anything. Undo is
    // the one operation that deletes, and a `..` in a log entry must not turn
    // it into a delete of something the project never owned.
    const live = assertWithin(projectRoot, join(projectRoot, page.path));
    if (!isUndoable(page.path)) {
      throw new CorruptOperationError(id, `it names "${page.path}", which undo does not own`);
    }
    if (page.existed) {
      const restored = assertWithin(snapDir, join(snapDir, page.path));
      mkdirSync(dirname(live), { recursive: true });
      copyFileSync(restored, live);
    } else {
      rmSync(live, { force: true });
    }
  }
}

function isUndoable(path: string): boolean {
  const normalised = path.split("\\").join("/");
  return UNDOABLE.some((prefix) => normalised.startsWith(prefix));
}

export class CorruptOperationError extends Error {
  constructor(id: string, reason: string) {
    super(
      `operation ${id} cannot be undone: ${reason}. The operation log is a file in the ` +
        `project directory, so it arrives with a clone — this one does not describe a write ` +
        `this application made.`,
    );
    this.name = "CorruptOperationError";
  }
}
