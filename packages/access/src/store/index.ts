import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { assertWithin } from "../paths.js";
import { NON_ENTITY_PAGES } from "./page.js";

/**
 * Read the index and the entity pages (plan 5.7, and the knowledge-base rule an
 * orphan is a page nobody will find again). The agent curates the index by
 * topic; the store only guarantees reachability, and flags a page that has
 * become unreachable — one whose slug no link in the index points at.
 *
 * **A page is addressed by its slug, wherever it sits under `wiki/`.** Settling
 * that is plan task 7.5's job, and the gap turned out to be wider than the note
 * there described — it was never only about codewiki:
 *
 * - the plan's directory diagram puts pages in `wiki/projects/`,
 *   `wiki/people/`, `wiki/topics/` and `wiki/codewiki/`;
 * - the scaffolded `wiki` skill tells the agent to write `wiki/<slug>.md`, flat;
 * - and this module read only the *top level* of `wiki/`, so every page written
 *   the way the diagram describes was invisible to the index, the orphan check,
 *   `ow graph` and the MCP read tools.
 *
 * Walking the tree and keying on the basename honours both readings: a folder
 * is organisation, a link is a name — the model Obsidian uses, which is where
 * `[[wikilink]]` comes from in the first place. The one rule it needs is that a
 * slug is unique across the wiki, because `[[checkout]]` cannot mean two files.
 * That is a group 7 finding (`page.duplicate-slug`), not something to resolve
 * by silently picking one.
 *
 * The write that registers a page in the index lives in `index-write.ts`, so the
 * read surface the MCP process imports (plan 9.9) pulls no write code.
 */

const INDEX_HEADER =
  "# Index\n\nEvery page is reachable from here; a page that is not is a page nobody will find again.\n\n";
const PAGES_SECTION = "## Pages";

/**
 * What a project's `wiki/` starts as (plan 1.3).
 *
 * **Empty and absent are not the same state**, and absent was the one that had
 * four components each waiting for another to move first: the scaffolded wiki
 * skill tells the agent to link a new page from `index.md`, `checkLinks`
 * reports pages unreachable from `index.md`, `registerInIndex` invents the
 * file on the first write, and the screen said *This wiki has no pages yet*
 * without saying whose move it was. Seeding both means the instruction, the
 * check and the screen are talking about a file that exists.
 *
 * Neither seed contains a wikilink. `checkRecords` reads every `[[…]]` in the
 * changelog as a page that should exist, so an example in the prose would
 * report itself as missing on the first `ow check` a project ever runs.
 */
export const INDEX_SEED = `${INDEX_HEADER}${PAGES_SECTION}\n`;

export const CHANGELOG_SEED = `# Changelog

What changed in this wiki, newest first: one entry per change, under the date it
happened, naming the pages it touched as wikilinks. The names are what \`ow check\`
reads, which is how a page written and never recorded is found.
`;

/** Where codewiki pages live, relative to `wiki/` (plan 7.5). */
export const CODEWIKI_DIR = "codewiki";

/** One entity page: the name it is linked by, and where it actually sits. */
export interface PageRef {
  /** The filename without `.md`. What a `[[wikilink]]` names. */
  slug: string;
  /** Project-relative posix path, e.g. `wiki/codewiki/dispatch.md`. */
  path: string;
  /** True when the page sits under `wiki/codewiki/`. */
  codewiki: boolean;
}

/**
 * Every entity page under `wiki/`, at any depth. `index.md`, `changelog.md` and
 * `log.md` are excluded at the top level — they are the wiki's own pages, not
 * entities.
 *
 * Symlinked directories are not followed. A link inside `wiki/` pointing
 * elsewhere on disk would otherwise enumerate that elsewhere as project
 * content, which is the escape `paths.ts` exists to stop.
 */
export function listPages(projectRoot: string): PageRef[] {
  const wiki = join(projectRoot, "wiki");
  if (!existsSync(wiki)) return [];

  const pages: PageRef[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      // Case-folded, like the gate. `gatedPageRel` lowercases before testing
      // for `.md`, so it validates and accepts `wiki/fenix.MD` — and matching
      // case-sensitively here meant that page was accepted by the gate and then
      // invisible to the index, the orphan check, `ow graph` and MCP. That is
      // the exact failure this addressing model exists to end, one level down.
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;

      const rel = relative(wiki, full).split(sep).join(posix.sep);
      // Only the three at the very top are the wiki's own; a file called
      // `index.md` inside `wiki/topics/` is an ordinary page named "index".
      if (
        !rel.includes(posix.sep) &&
        (NON_ENTITY_PAGES as readonly string[]).includes(rel.toLowerCase())
      ) {
        continue;
      }
      pages.push({
        slug: entry.name.slice(0, -3),
        path: `wiki/${rel}`,
        codewiki: rel.toLowerCase().startsWith(`${CODEWIKI_DIR}/`),
      });
    }
  };
  walk(wiki);
  return pages.sort((a, b) => a.path.localeCompare(b.path));
}

/** The slugs of every entity page under `wiki/`, at any depth. */
export function listEntityPages(projectRoot: string): string[] {
  return listPages(projectRoot).map((page) => page.slug);
}

/** The project-relative path of the page with this slug, or undefined. */
export function pagePath(projectRoot: string, slug: string): string | undefined {
  return listPages(projectRoot).find((page) => page.slug === slug)?.path;
}

/** A slug reaches this from a filename, so it may carry regex metacharacters. */
function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `indexText` links to `slug` (as `[[slug]]`, `[[slug|...]]` or `[[slug#...]]`). */
export function isIndexed(indexText: string, slug: string): boolean {
  return new RegExp(`\\[\\[${escapeForRegExp(slug)}(\\||#|\\]\\])`).test(indexText);
}

/**
 * Read the index, returning an empty one (header only) when absent.
 *
 * **This creates nothing.** It used to `mkdir` `wiki/`, which made every
 * caller a writer: `ow check` run in the wrong directory left a `wiki/` behind,
 * and `checkProject` — which the read-only surface the MCP process imports now
 * exports — quietly wrote to disk, against the guarantee of 9.9 that read-only
 * is what that process *can* do. The directory is the write path's to create;
 * `registerInIndex` does it there.
 */
export function readIndex(projectRoot: string): string {
  const file = assertWithin(projectRoot, join(projectRoot, "wiki", "index.md"));
  return existsSync(file) ? readFileSync(file, "utf8") : INDEX_HEADER;
}

/**
 * The entity pages nothing in the index links to — the unreachable ones. A
 * page the agent unlinked from the index surfaces here; group 7 reports it.
 */
export function findOrphans(projectRoot: string): string[] {
  const indexText = readIndex(projectRoot);
  return listEntityPages(projectRoot).filter((slug) => !isIndexed(indexText, slug));
}

export { PAGES_SECTION };
