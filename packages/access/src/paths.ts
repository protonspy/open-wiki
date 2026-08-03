import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

/**
 * Thrown when a target path resolves outside the project directory.
 *
 * The check resolves the *real* path before comparing, because on Windows a
 * directory junction needs no privilege and is not a symlink — a naive string
 * prefix check lets a junction inside the project reach anywhere on disk.
 * See plan task 2.6 and `adr:0013-the-project-directory-is-the-unit`.
 */
export class OutsideProjectError extends Error {
  constructor(
    public readonly projectRoot: string,
    public readonly target: string,
    public readonly resolved: string,
  ) {
    super(`refused: ${target} resolves to ${resolved}, outside the project ${projectRoot}`);
    this.name = "OutsideProjectError";
  }
}

/**
 * Resolves a path to its real location, following symlinks and junctions in
 * the part of the path that already exists. A write target usually does not
 * exist yet, so the longest existing ancestor is resolved and the remaining
 * components are appended verbatim.
 */
export function resolveReal(p: string): string {
  const abs = resolve(p);
  let existing = abs;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break; // reached the filesystem root
    existing = parent;
  }
  const real = existsSync(existing) ? realpathSync(existing) : existing;
  const rest = abs.slice(existing.length);
  return real + rest;
}

/**
 * True when `target` resolves strictly inside `root` (not equal to it). Both
 * sides are resolved to their real paths first, so a junction or symlink that
 * escapes the project is caught rather than followed.
 */
export function isWithin(root: string, target: string): boolean {
  const realRoot = resolveReal(root);
  const realTarget = resolveReal(target);
  const rel = relative(realRoot, realTarget);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Returns the resolved path when it is within the project, or throws. The
 * returned path is the real path the write would land at, which is what the
 * caller should use — never the original, which may still carry the junction.
 */
export function assertWithin(root: string, target: string): string {
  const resolved = resolveReal(target);
  if (!isWithin(root, target)) {
    throw new OutsideProjectError(root, target, resolved);
  }
  return resolved;
}

/**
 * Thrown when a path this product means to write is a symbolic link.
 */
export class SymlinkedTargetError extends Error {
  constructor(public readonly target: string) {
    super(
      `refused: ${target} is a symbolic link. This product writes files, never through links — ` +
        `remove it if you want the file regenerated.`,
    );
    this.name = "SymlinkedTargetError";
  }
}

/**
 * Refuse to write *through* a symbolic link, wherever it points.
 *
 * **`assertWithin` does not cover this and cannot.** `resolveReal` walks up to
 * the longest ancestor that exists and appends the rest verbatim, so for a
 * *dangling* link the ancestor is the parent directory and the link's own name
 * is appended — the check passes, and the plain `writeFileSync` that follows
 * then hands the whole thing to the OS, which follows the link to wherever it
 * actually points. `seedWiki` in `scaffold.ts` documents this exact bug and
 * answers it with `lstat`, which asks about the *name* rather than about what
 * the name points at.
 *
 * That lesson was learned in one function and not carried to the others.
 * Everything this product writes into a project — the skills, the entry files,
 * the seeds — goes through a name it chose, at a path a cloned repository could
 * have planted a link at first. `existsSync` says "nothing there" for a dangling
 * link, so the create path follows it; `refresh` and the regenerated entry files
 * overwrite by design, so they follow an ordinary one.
 *
 * The rule is the same in every case and does not depend on the caller's
 * intent: **a name that is a link is not a file this product will write.**
 */
export function refuseSymlink(target: string): void {
  let stat;
  try {
    stat = lstatSync(target);
  } catch {
    return; // nothing of that name at all, which is the ordinary case
  }
  if (stat.isSymbolicLink()) throw new SymlinkedTargetError(target);
}

/** Whether anything at all bears this name — a file, a directory, or a link to anywhere or nowhere. */
export function occupied(target: string): boolean {
  try {
    lstatSync(target);
    return true;
  } catch {
    return false;
  }
}
