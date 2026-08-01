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

export interface WikiIndex {
  pages: PageRef[];
  /** Slugs, so the renderer can tell a live wikilink from a dead one. */
  slugs: string[];
}

/** Every page in the wiki, wherever it sits — `adr:0016-a-page-is-its-slug-wherever-it-sits`. */
export function wikiIndex(projectRoot: string): WikiIndex {
  const pages = listPages(projectRoot);
  return { pages, slugs: pages.map((p) => p.slug) };
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
  const parsed = block?.parsed === true ? block.frontmatter : null;
  return {
    slug: ref.slug,
    path: ref.path,
    markdown,
    body: block?.body ?? markdown,
    // A page whose frontmatter is a list, or a string, is malformed rather
    // than absent; the screen shows the body either way and 7.x reports it.
    frontmatter:
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null,
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
