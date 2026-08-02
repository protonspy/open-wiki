import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertWithin,
  listPages,
  listSourceStates,
  readFrontmatter,
  readSettings,
  type PageRef,
  type SourceState,
} from "@open-wiki/access/read";
// From `shared/`: the renderer's reader needs `titleOfPage` too, and a page's
// name must not be one thing in the tree and another on the page itself.
import { groupOfPage, titleOfPage } from "../shared/pages.js";

/**
 * Everything the renderer is allowed to ask for (plan 8.2 and 8.5).
 *
 * **The project root is bound here, not passed in.** Every function takes it
 * as its first argument and the IPC layer supplies the one this window was
 * opened with — so a renderer that asks for a page can name a slug and never a
 * path, and the worst a wrong answer can do is fail to resolve.
 *
 * It imports `@open-wiki/access/read` rather than the barrel, which is the same
 * discipline plan 9.9 applies to the MCP process: what this module cannot
 * import, it cannot be made to do. Writing arrives in 8.7 through a separate
 * module, so the read surface stays readable as a read surface.
 */

export interface PageView {
  slug: string;
  /** Project-relative, already forward-slashed by `listEntityPages`. */
  path: string;
  markdown: string;
  /** The page's own body, without the frontmatter block. */
  body: string;
  frontmatter: Record<string, unknown> | null;
  /** True when the block is there and the YAML will not read (plan 5.1). */
  frontmatterBroken: boolean;
}

/**
 * A page as the tree shows it: where it sits, what it is called, and which
 * band it is listed under (spec `wiki-pane`, R1.1 and R1.3).
 *
 * The two extra fields live here rather than on `PageRef`, which belongs to
 * `@open-wiki/access` and answers a different question — where a page *is*.
 * What it is *called* is a screen's concern, and the store has no opinion on it.
 */
export interface IndexedPage extends PageRef {
  /** The page's `title`, or its slug when it has none (R1.3). */
  title: string;
  /** The folder under `wiki/`, or null for a page at the top (R1.2). */
  group: string | null;
}

export interface WikiIndex {
  pages: IndexedPage[];
  /** Slugs, so the renderer can tell a live wikilink from a dead one. */
  slugs: string[];
}

/**
 * Every page in the wiki, wherever it sits — `adr:0016-a-page-is-its-slug-wherever-it-sits`.
 *
 * **This reads every page**, where it used to only list them: the tree shows
 * titles, and a title is in the frontmatter. That is O(pages) reads on every
 * coalesced folder change, which is bounded by the page count and is the cost
 * `specs/wiki-pane/design.md` accepted — if it ever stops being bounded the
 * answer is a cache with an invalidation story, not a tree of slugs.
 *
 * A page whose frontmatter is absent, broken or not a mapping is listed under
 * its slug rather than dropped. It is a group 7 finding, and a wiki that hides
 * its malformed pages is a wiki nobody fixes.
 */
export function wikiIndex(projectRoot: string): WikiIndex {
  const pages = listPages(projectRoot).map((ref) => ({
    ...ref,
    title: titleOfPage(frontmatterOf(projectRoot, ref), ref.slug),
    group: groupOfPage(ref.path),
  }));
  return { pages, slugs: pages.map((p) => p.slug) };
}

/** One page's frontmatter for the index, or null for any reason it has none. */
function frontmatterOf(projectRoot: string, ref: PageRef): Record<string, unknown> | null {
  try {
    const file = assertWithin(projectRoot, join(projectRoot, ref.path));
    return asObject(readFrontmatter(readFileSync(file, "utf8")));
  } catch {
    // A page listed a moment ago and unreadable now — deleted mid-walk, or on a
    // share that raised EPERM. The index is what the screen redraws from, so it
    // degrades to the slug rather than taking the whole redraw with it.
    return null;
  }
}

/**
 * The frontmatter as a mapping, or null.
 *
 * A page whose frontmatter is a list, or a bare string, is malformed rather
 * than absent — both answer null here, and `readPage` keeps the distinction
 * through `frontmatterBroken` so the reader can say which.
 */
function asObject(block: ReturnType<typeof readFrontmatter>): Record<string, unknown> | null {
  const parsed = block?.parsed === true ? block.frontmatter : null;
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

export class NoSuchPageError extends Error {
  constructor(slug: string) {
    super(`no page "${slug}" in this wiki`);
    this.name = "NoSuchPageError";
  }
}

/**
 * One page, whole.
 *
 * Resolved by slug through the index rather than by joining the slug onto a
 * path. A slug reaches here out of a wikilink in someone else's prose, and
 * `adr:0016` says a page is its slug wherever it sits — so the index is the
 * only thing that knows where that is, and asking it is both correct and the
 * reason no path arithmetic happens on untrusted input.
 */
export function readPage(projectRoot: string, slug: string): PageView {
  const ref = listPages(projectRoot).find((page) => page.slug === slug);
  if (!ref) throw new NoSuchPageError(slug);
  const file = assertWithin(projectRoot, join(projectRoot, ref.path));
  if (!existsSync(file)) throw new NoSuchPageError(slug);
  const markdown = readFileSync(file, "utf8");
  const block = readFrontmatter(markdown);
  return {
    slug: ref.slug,
    path: ref.path,
    markdown,
    body: block?.body ?? markdown,
    // A page whose frontmatter is a list, or a string, is malformed rather
    // than absent; the screen shows the body either way and 7.x reports it.
    frontmatter: asObject(block),
    frontmatterBroken: block?.parsed === false,
  };
}

/** Every source with its state, for the sources screen (plan 6.2). */
export function sources(projectRoot: string): SourceState[] {
  return listSourceStates(projectRoot);
}

export interface ProjectInfo {
  root: string;
  /** The last segment, which is what a person calls the project. */
  name: string;
  language: string;
}

export function projectInfo(projectRoot: string): ProjectInfo {
  return {
    root: projectRoot,
    name: projectRoot.split(/[\\/]/).filter(Boolean).pop() ?? projectRoot,
    language: readSettings(projectRoot).language,
  };
}
