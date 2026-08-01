import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertWithin } from "../paths.js";
import { appendOperation, type Origin } from "./log.js";

export interface SnapshotPage {
  path: string;
  existed: boolean;
}

export interface Snapshot {
  id: string;
  dir: string;
  pages: SnapshotPage[];
}

const SNAPSHOTS_DIR = join(".state", "snapshots");

/**
 * Copies the current content of the named pages into `.state/snapshots/<id>/`,
 * recording whether each existed. Callable on its own: on the hook path the
 * agent's own tool performs the write, so the snapshot has to happen without
 * this module performing the write it is protecting (plan task 2.3).
 */
export function snapshot(projectRoot: string, pagePaths: string[]): Snapshot {
  const id = randomUUID();
  const dir = join(projectRoot, SNAPSHOTS_DIR, id);
  mkdirSync(dir, { recursive: true });
  const pages: SnapshotPage[] = [];
  for (const rel of pagePaths) {
    const abs = join(projectRoot, rel);
    const existed = existsSync(abs);
    pages.push({ path: rel, existed });
    if (existed) {
      const dest = join(dir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(abs, dest);
    }
  }
  return { id, dir, pages };
}

/**
 * Writes a file atomically — temp file plus rename — so an application killed
 * midway does not leave half a page behind. Refuses a path that resolves
 * outside the project (`adr:0002-workspace-as-a-local-markdown-folder`).
 */
export function atomicWrite(projectRoot: string, pagePath: string, content: string): string {
  const resolved = assertWithin(projectRoot, join(projectRoot, pagePath));
  mkdirSync(dirname(resolved), { recursive: true });
  const tmp = join(dirname(resolved), `.ow-tmp-${randomUUID()}`);
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, resolved);
  return resolved;
}

/**
 * The direct write path used by the editor and the CLI verb: snapshot, then
 * write atomically, then record the operation. Returns the operation so the
 * caller can hand its id to undo.
 */
export function writePage(projectRoot: string, pagePath: string, content: string, origin: Origin) {
  const snap = snapshot(projectRoot, [pagePath]);
  atomicWrite(projectRoot, pagePath, content);
  return appendOperation(projectRoot, {
    id: snap.id,
    origin,
    pages: snap.pages,
    snapshotId: snap.id,
  });
}
