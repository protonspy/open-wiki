import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/**
 * Which project this window is (plan 8.2).
 *
 * `ow` in a directory opens the application scoped to it, the way `code .`
 * does — `adr:0013-the-project-directory-is-the-unit`. There is exactly one
 * project per window and it is fixed when the window opens: everything the
 * renderer can reach is resolved against it, so a path arriving from the
 * renderer can never widen the scope, only fail to be inside it.
 *
 * When the invocation names no project — `ow` run outside one, or the
 * application started from its own shortcut — this answers `null` rather than
 * guessing. The launcher of 8.4 is what happens next; falling back to the
 * current directory would open the user's home folder as a wiki.
 */

/** A directory holding the three the scaffolder creates (plan 2.1). */
export function looksLikeProject(dir: string): boolean {
  return ["raw", "wiki", ".state"].every((part) => isDirectory(resolve(dir, part)));
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export interface LaunchArgs {
  /** `process.argv`, tail included. */
  argv: readonly string[];
  cwd: string;
}

/**
 * The project directory this launch names, or `null`.
 *
 * `--project <dir>` wins, because that is what the `ow` shim passes and it is
 * unambiguous. Otherwise the working directory counts *only if it already
 * looks like a project* — Electron's argv carries the executable, sometimes a
 * script path and any number of Chromium switches, and reading a positional
 * argument out of that is how `--inspect` becomes a project name.
 */
export function resolveProject(args: LaunchArgs): string | null {
  const flag = args.argv.indexOf("--project");
  if (flag >= 0) {
    const named = args.argv[flag + 1];
    if (named && !named.startsWith("--")) {
      const dir = isAbsolute(named) ? named : resolve(args.cwd, named);
      return isDirectory(dir) ? dir : null;
    }
    return null;
  }
  const cwd = resolve(args.cwd);
  return looksLikeProject(cwd) ? cwd : null;
}
