import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listEntityPages, readFrontmatter } from "@open-wiki/access";

/**
 * `ow search <query>` — lexical search over the wiki (plan 9.12). A scan over a
 * few megabytes already does this; there is no index to build. Prints JSON: the
 * pages whose title or body mention the query, case-insensitively, with the
 * count per page.
 */
export function runSearch(projectRoot: string, query: string): string {
  const q = query.toLowerCase();
  const results: Array<{ slug: string; title: string; matches: number }> = [];
  for (const slug of listEntityPages(projectRoot)) {
    const text = readFileSync(join(projectRoot, "wiki", `${slug}.md`), "utf8");
    const lower = text.toLowerCase();
    const matches = countOccurrences(lower, q);
    if (matches === 0) continue;
    const block = readFrontmatter(text);
    const title =
      block && block.parsed && typeof (block.frontmatter as Record<string, unknown>)?.["title"] === "string"
        ? String((block.frontmatter as Record<string, unknown>)["title"])
        : slug;
    results.push({ slug, title, matches });
  }
  return JSON.stringify(results, null, 2);
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let i = haystack.indexOf(needle);
  while (i >= 0) {
    count++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return count;
}