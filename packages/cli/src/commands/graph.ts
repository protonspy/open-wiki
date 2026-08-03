import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  boundedManifest,
  findOrphans,
  listPages,
  listSourceRefs,
  readFrontmatter,
  readIndex,
  readManifestAt,
  type PageRef,
} from "@open-wiki/access";

/**
 * `ow graph [superseded|orphans|index]` — the structural queries (plan 9.12).
 * They have no other owner, and the supersession walk depends on the fields 5.2
 * records. Local queries print JSON for a harness to read.
 *
 * The supersession walk covers **sources as well as pages** since plan task
 * 8.6, because 8.5 gave a source exactly the fields this already depended on.
 * A traversal that answered "what was replaced, and by what" for half the
 * things a citation can point at would be the more misleading of the two
 * possible gaps: it looks complete.
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

interface SupersededPage {
  slug: string;
  "superseded-by": string;
  updated: string;
}

interface SupersededSource {
  id: string;
  "superseded-by": string;
  superseded: string;
}

/**
 * What the walk answers, since plan task 8.6.
 *
 * **Two lists, not one flattened array**, and the shape change is deliberate.
 * A page and a source are addressed in different vocabularies — a `slug` and an
 * id, a `type:slug` pointer and a bare source id, `updated` and `superseded` —
 * so merging them would force one vocabulary onto the other, which is the
 * second-vocabulary mistake this plan spends task 8.5 avoiding, in reverse. The
 * page half is byte-identical to what this printed before; only the top level
 * moved.
 */
interface SupersessionWalk {
  pages: SupersededPage[];
  sources: SupersededSource[];
}

function supersessionWalk(projectRoot: string, refs: PageRef[]): SupersessionWalk {
  return { pages: supersededPages(projectRoot, refs), sources: supersededSources(projectRoot) };
}

/**
 * The sources somebody replaced (plan 8.5).
 *
 * Walked from `listSourceRefs` rather than from `listSourceStates`, which would
 * read every journal and every `text.md` to answer a question about three
 * fields — and would need the wiki read as well, to fill in `citedBy`.
 *
 * A manifest that will not parse is skipped rather than fatal, for the reason
 * `listSourceStates` skips one: `raw/` is not gated the way `wiki/` is and a
 * manifest arrives with a clone, so one bad directory must not take the answer
 * about every other source with it.
 *
 * **Through `boundedManifest`, because this prints into an agent's context.**
 * `superseded-by` is free text out of a file that arrived with a clone, and a
 * planted manifest naming a megabyte-long replacement would crowd out
 * everything else this query answers. A security review found it unbounded
 * here; the fix is the shared bound rather than a `boundedText` call added to
 * this function, which is how the same field came to be missed on two surfaces
 * at once.
 */
function supersededSources(projectRoot: string): SupersededSource[] {
  const out: SupersededSource[] = [];
  for (const { id, dir } of listSourceRefs(projectRoot)) {
    let manifest;
    try {
      manifest = boundedManifest(readManifestAt(dir, id));
    } catch {
      continue;
    }
    if (manifest.status !== "superseded") continue;
    out.push({
      id,
      "superseded-by": manifest["superseded-by"] ?? "",
      superseded: manifest.superseded ?? "",
    });
  }
  return out;
}

function supersededPages(projectRoot: string, refs: PageRef[]): SupersededPage[] {
  const out: SupersededPage[] = [];
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
