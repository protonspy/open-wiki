import { existsSync, realpathSync } from "node:fs";
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
