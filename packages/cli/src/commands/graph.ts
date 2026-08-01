import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  findOrphans,
  listPages,
  readFrontmatter,
  readIndex,
  type PageRef,
} from "@open-wiki/access";

/**
 * `ow graph [superseded|orphans|index]` — the structural queries (plan 9.12).
 * They have no other owner, and the supersession walk depends on the fields 5.2
 * records. Local queries print JSON for a harness to read.
 */
export function runGraph(projectRoot: string, sub: string | undefined): string {
  // The refs, not just the slugs: a page is its slug wherever it sits under
  // `wiki/` (`adr:0016`), so reading one means looking up where it is. Assuming
  // `wiki/<slug>.md` threw ENOENT — a stack, not a sentence — the moment a
  // project filed a page the way the plan's layout describes.
  const refs = listPages(projectRoot);
  const pages = refs.map((p) => p.slug);
  if (sub === "orphans") return JSON.stringify(findOrphans(projectRoot), null, 2);
  if (sub === "superseded") return JSON.stringify(supersessionWalk(projectRoot, refs), null, 2);
  if (sub === "index") return JSON.stringify(indexState(projectRoot, pages), null, 2);
  // default: the whole structure
  return JSON.stringify(
    {
      pages,
      orphans: findOrphans(projectRoot),
      superseded: supersessionWalk(projectRoot, refs),
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

function supersessionWalk(projectRoot: string, refs: PageRef[]): SupersededEntry[] {
  const out: SupersededEntry[] = [];
  for (const { slug, path } of refs) {
    const text = readPage(projectRoot, path);
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
  const indexText = readIndex(projectRoot);
  return pages.filter((slug) => new RegExp(`\\[\\[${slug}(\\||#|\\]\\])`).test(indexText));
}

function readPage(projectRoot: string, relPath: string): string {
  return readFileSync(join(projectRoot, relPath), "utf8");
}
