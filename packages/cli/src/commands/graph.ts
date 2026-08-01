import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findOrphans, listEntityPages, readFrontmatter } from "@open-wiki/access";

/**
 * `ow graph [superseded|orphans|index]` — the structural queries (plan 9.12).
 * They have no other owner, and the supersession walk depends on the fields 5.2
 * records. Local queries print JSON for a harness to read.
 */
export function runGraph(projectRoot: string, sub: string | undefined): string {
  const pages = listEntityPages(projectRoot);
  if (sub === "orphans") return JSON.stringify(findOrphans(projectRoot), null, 2);
  if (sub === "superseded") return JSON.stringify(supersessionWalk(projectRoot, pages), null, 2);
  if (sub === "index") return JSON.stringify(indexState(projectRoot, pages), null, 2);
  // default: the whole structure
  return JSON.stringify(
    {
      pages,
      orphans: findOrphans(projectRoot),
      superseded: supersessionWalk(projectRoot, pages),
    },
    null,
    2,
  );
}

interface SupersededEntry {
  slug: string;
  "superseded-by": string;
  updated: string;
}

function supersessionWalk(projectRoot: string, pages: string[]): SupersededEntry[] {
  const out: SupersededEntry[] = [];
  for (const slug of pages) {
    const text = readPage(projectRoot, slug);
    const block = readFrontmatter(text);
    if (!block || !block.parsed) continue;
    const fm = block.frontmatter as Record<string, unknown>;
    if (fm["status"] === "superseded") {
      out.push({
        slug,
        "superseded-by": String(fm["superseded-by"] ?? ""),
        updated: String(fm["updated"] ?? ""),
      });
    }
  }
  return out;
}

function indexState(projectRoot: string, pages: string[]): string[] {
  const indexText = readFileSync(join(projectRoot, "wiki", "index.md"), "utf8");
  return pages.filter((slug) => new RegExp(`\\[\\[${slug}(\\||#|\\]\\])`).test(indexText));
}

function readPage(projectRoot: string, slug: string): string {
  return readFileSync(join(projectRoot, "wiki", `${slug}.md`), "utf8");
}