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

/**
 * Undoes an operation by its id (plan task 2.5). Restores the snapshot for a
 * page that existed before, and removes a page the operation created — the
 * `existed` flag recorded at snapshot time is what tells the two apart.
 */
export function undo(projectRoot: string, id: string): void {
  const op = getOperation(projectRoot, id);
  if (!op) throw new UnknownOperationError(id);
  const snapDir = join(projectRoot, ".state", "snapshots", op.snapshotId);
  for (const page of op.pages) {
    // The paths come off the operation log on disk, so they are input, not
    // fact: confine both ends before restoring or removing anything. Undo is
    // the one operation that deletes, and a `..` in a log entry must not turn
    // it into a delete of something the project never owned.
    const live = assertWithin(projectRoot, join(projectRoot, page.path));
    if (page.existed) {
      const restored = assertWithin(snapDir, join(snapDir, page.path));
      mkdirSync(dirname(live), { recursive: true });
      copyFileSync(restored, live);
    } else {
      rmSync(live, { force: true });
    }
  }
}
