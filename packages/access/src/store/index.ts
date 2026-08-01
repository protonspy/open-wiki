import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { assertWithin } from "../paths.js";
import { NON_ENTITY_PAGES } from "./page.js";

/**
 * Maintain `index.md` so every page is reachable from it (plan 5.7, and the
 * knowledge-base rule an orphan is a page nobody will find again). The store
 * registers a new page by adding a `[[slug]]` link, and flags a page that has
 * become unreachable — one whose slug no link in the index points at.
 *
 * The agent curates the index by topic; the store only guarantees reachability:
 * a new page lands under a `## Pages` section the agent is expected to move, and
 * a page the agent unlinked surfaces here as an orphan for group 7 to report.
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

function readIndex(projectRoot: string): string {
  const file = assertWithin(projectRoot, join(projectRoot, "wiki", "index.md"));
  mkdirSync(join(projectRoot, "wiki"), { recursive: true });
  return existsSync(file) ? readFileSync(file, "utf8") : INDEX_HEADER;
}

/**
 * Register a page in the index if it is not already reachable. Adds a
 * `## Pages` section (the agent is expected to relocate the entry) and is
 * idempotent. Returns true if it added a link, false if the page was already
 * indexed.
 */
export function registerInIndex(projectRoot: string, slug: string, title?: string): boolean {
  const file = assertWithin(projectRoot, join(projectRoot, "wiki", "index.md"));
  const text = readIndex(projectRoot);
  if (isIndexed(text, slug)) return false;

  const bullet = title ? `- [[${slug}]] — ${title}` : `- [[${slug}]]`;
  const lines = text.split("\n");
  const sectionIdx = lines.findIndex((l) => l === PAGES_SECTION);

  let next: string;
  if (sectionIdx >= 0) {
    // Prepend the bullet as the first bullet of the section.
    let insertAt = sectionIdx + 1;
    while (insertAt < lines.length && lines[insertAt] === "") insertAt++;
    lines.splice(insertAt, 0, bullet);
    next = lines.join("\n");
  } else {
    const tail = text.endsWith("\n") ? text : `${text}\n`;
    next = `${tail}${PAGES_SECTION}\n\n${bullet}\n`;
  }
  writeFileSync(file, next.endsWith("\n") ? next : `${next}\n`, "utf8");
  return true;
}

/**
 * The entity pages nothing in the index links to — the unreachable ones. A
 * page the agent unlinked from the index surfaces here; group 7 reports it.
 */
export function findOrphans(projectRoot: string): string[] {
  const indexText = readIndex(projectRoot);
  return listEntityPages(projectRoot).filter((slug) => !isIndexed(indexText, slug));
}
