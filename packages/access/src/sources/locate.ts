import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The doorway under `raw/` (plan 3.7). It lives in this module — the lowest one
 * every source module reaches — because `listSourceRefs` must skip it and
 * `manifest.ts` now depends on this file rather than the other way round.
 * `manifest.ts` re-exports it, so every existing importer is unaffected.
 *
 * One string, because it is load-bearing in four places at once: the scaffolder
 * creates it, the walk must skip it, `isIdTaken` must not treat it as a taken
 * id, and the inbox itself reads it. Four copies mean a rename breaks the
 * quietest of them, and the quietest is the walk starting to return `_inbox` as
 * a citable source.
 */
export const INBOX = "_inbox";

/**
 * Where a source actually sits — plan task 8.3.
 *
 * **A source is its id wherever it sits under `raw/`**, which is the decision
 * `adr:0016-a-page-is-its-slug-wherever-it-sits` already made for `wiki/`,
 * applied a second time rather than reasoned about afresh. A folder is
 * organisation, the id is the name, and uniqueness of the id is the one rule
 * the model needs. It buys the same things it bought there: a source can be
 * filed and refiled without a citation changing, and `src://<id>` keeps
 * resolving because it never encoded a location.
 *
 * What it costs is the enumeration. Reading one level of `raw/` made every
 * filed source invisible to the listing, the checks, the CLI and MCP — the same
 * failure `listEntityPages` had before `adr:0016`, and just as quiet.
 *
 * It is a read module, so the MCP process (plan 9.9) can resolve an id without
 * pulling any write code.
 */

export interface SourceRef {
  /** The directory's name, which is the id a citation spells (`adr:0011`). */
  id: string;
  /** Absolute path of the source's own directory. */
  dir: string;
}

/** How deep an organising tree may go before this stops looking. */
const MAX_DEPTH = 8;

/**
 * Every source under `raw/`, at any depth, sorted by id and then by path so a
 * report built on this is stable.
 *
 * **A directory holding `manifest.json` is a source, and the walk does not go
 * inside it.** That rule is what group 6 makes non-optional: an unpacked
 * repository lives under `raw/<id>/` and routinely contains a `manifest.json`
 * of its own — an npm package, an extension, anything. Descending would
 * enumerate somebody else's file as a source of this project, and the id it
 * produced would collide with whatever else shared that directory name.
 *
 * Links are not followed, for the reason `listPages` does not follow them: a
 * link inside `raw/` pointing elsewhere on disk would enumerate that elsewhere
 * as this project's content, which is the escape `paths.ts` exists to stop.
 */
export function listSourceRefs(projectRoot: string): SourceRef[] {
  const raw = join(projectRoot, "raw");
  if (!existsSync(raw)) return [];

  const refs: SourceRef[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // A directory that cannot be read costs its own subtree and nothing else.
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      // The doorway is not a source and holds none: it is emptied by ingestion.
      if (depth === 0 && entry.name === INBOX) continue;
      const full = join(dir, entry.name);
      if (existsSync(join(full, "manifest.json"))) {
        // Found one. Its contents are the source's own files, not more sources.
        refs.push({ id: entry.name, dir: full });
        continue;
      }
      walk(full, depth + 1);
    }
  };
  walk(raw, 0);
  return refs.sort((a, b) => a.id.localeCompare(b.id) || a.dir.localeCompare(b.dir));
}

/**
 * The directory of the source with this id, or `undefined`.
 *
 * An id is a name and never a path — it reaches here straight out of a page's
 * prose, where `src://../../elsewhere#p1` parses as the id `../../elsewhere`.
 * Because this matches against directory *names* the walk produced, a
 * path-shaped id matches nothing, and this cannot become an existence oracle
 * for anything on disk.
 *
 * Where two directories claim one id it answers the first in sorted order,
 * deterministically. That is not a resolution of the ambiguity — the finding
 * from `duplicateSourceIds` is — it is only what keeps a report from varying
 * between runs.
 */
export function sourceDirOf(projectRoot: string, id: string): string | undefined {
  return listSourceRefs(projectRoot).find((ref) => ref.id === id)?.dir;
}

/**
 * Ids claimed by more than one directory.
 *
 * `src://weekly#p1` cannot mean two sources, so this is a finding rather than
 * something to settle by silently choosing — the same answer `adr:0016` gave
 * for two pages sharing a slug.
 */
export function duplicateSourceIds(projectRoot: string): Array<{ id: string; dirs: string[] }> {
  const byId = new Map<string, string[]>();
  for (const ref of listSourceRefs(projectRoot)) {
    const dirs = byId.get(ref.id);
    if (dirs) dirs.push(ref.dir);
    else byId.set(ref.id, [ref.dir]);
  }
  return [...byId.entries()]
    .filter(([, dirs]) => dirs.length > 1)
    .map(([id, dirs]) => ({ id, dirs }));
}
