import { existsSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { assertWithin } from "../paths.js";
import { NON_ENTITY_PAGES } from "./page.js";

/**
 * Read the index and the entity pages (plan 5.7, and the knowledge-base rule an
 * orphan is a page nobody will find again). The agent curates the index by
 * topic; the store only guarantees reachability, and flags a page that has
 * become unreachable — one whose slug no link in the index points at.
 *
 * The write that registers a page in the index lives in `index-write.ts`, so the
 * read surface the MCP process imports (plan 9.9) pulls no write code.
 */

const INDEX_HEADER =
  "# Index\n\nEvery page is reachable from here; a page that is not is a page nobody will find again.\n\n";
const PAGES_SECTION = "## Pages";

/** The slugs of every entity page at the top of `wiki/`. */
export function listEntityPages(projectRoot: string): string[] {
  const wiki = join(projectRoot, "wiki");
  if (!existsSync(wiki)) return [];
  const slugs: string[] = [];
  for (const entry of readdirSync(wiki)) {
    if (!entry.endsWith(".md")) continue;
    if ((NON_ENTITY_PAGES as readonly string[]).includes(entry)) continue;
    slugs.push(entry.slice(0, -3));
  }
  return slugs;
}

/** True when `indexText` links to `slug` (as `[[slug]]`, `[[slug|...]]` or `[[slug#...]]`). */
export function isIndexed(indexText: string, slug: string): boolean {
  return new RegExp(`\\[\\[${slug}(\\||#|\\]\\])`).test(indexText);
}

/** Read the index, creating an empty one (header only) when absent. */
export function readIndex(projectRoot: string): string {
  const file = assertWithin(projectRoot, join(projectRoot, "wiki", "index.md"));
  mkdirSync(join(projectRoot, "wiki"), { recursive: true });
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
