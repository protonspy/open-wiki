import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertWithin,
  OutsideProjectError,
  listEntityPages,
  readIndex,
  isIndexed,
  readFrontmatter,
  readManifest,
  listSources,
  type PageFrontmatter,
  type SourceManifest,
} from "@open-wiki/access/read";

/**
 * The MCP read tools (plan 9.10), implemented as pure functions of a project
 * root. The entrypoint wires these to `McpServer`; the tests call them
 * directly, which is what makes the path-confinement guarantee (9.9) checkable
 * without standing up stdio.
 *
 * Every path a tool resolves is confined with `assertWithin`, so read-only is
 * what the process **can** do, not what it agrees to do: a slug or source id
 * that escapes the project is refused before the filesystem is touched. The
 * import above is the read barrel only — see `tests/mcp.spec.ts` for the static
 * half of the guarantee.
 */

/** A page the agent asked for that does not exist under `wiki/`. */
export class MissingPageError extends Error {
  constructor(public readonly slug: string) {
    super(`no page "${slug}" under wiki/`);
    this.name = "MissingPageError";
  }
}

/** One entry in the structural view of the index (plan 9.10). */
export interface IndexEntry {
  slug: string;
  title: string;
  type: string;
  status: "active" | "superseded";
  /** True when `index.md` links to this slug — false marks an orphan. */
  indexed: boolean;
}

/** A page returned whole (plan 9.10): the markdown, plus its parsed frontmatter. */
export interface WholePage {
  slug: string;
  content: string;
  frontmatter: PageFrontmatter | null;
}

/** A source with its manifest and whether its `text.md` is present. */
export interface SourceState {
  id: string;
  manifest: SourceManifest;
  hasText: boolean;
}

/**
 * The index as structure (plan 9.10): every entity page, marked indexed or
 * orphan, carrying the status the supersession walk (5.2) depends on. The agent
 * curates the index; this is what shows what it reaches and what it does not.
 */
export function indexStructure(projectRoot: string): IndexEntry[] {
  const indexText = readIndex(projectRoot);
  return listEntityPages(projectRoot).map((slug) => {
    const fm = readPageFrontmatter(projectRoot, slug);
    return {
      slug,
      title: fm?.title ?? slug,
      type: fm?.type ?? "unknown",
      status: fm?.status ?? "active",
      indexed: isIndexed(indexText, slug),
    };
  });
}

/** A page returned whole: the full markdown and its frontmatter. */
export function readPageWhole(projectRoot: string, slug: string): WholePage {
  const file = pagePath(projectRoot, slug);
  if (!existsSync(file)) throw new MissingPageError(slug);
  const content = readFileSync(file, "utf8");
  return { slug, content, frontmatter: readPageFrontmatter(projectRoot, slug) };
}

/** Every source under `raw/` with its manifest and a flag for `text.md`. */
export function listSourcesState(projectRoot: string): SourceState[] {
  return listSources(projectRoot).map((id) => {
    const manifest = readManifest(projectRoot, id);
    const text = sourceTextPath(projectRoot, id);
    return { id, manifest, hasText: existsSync(text) };
  });
}

/** A source's `text.md` — the normalised text the citations point into. */
export function readSourceText(projectRoot: string, id: string): string {
  // Confine first so an escaping id is refused before anything is read; then
  // `readManifest` turns a merely-absent id into `MissingSourceError`.
  const file = sourceTextPath(projectRoot, id);
  readManifest(projectRoot, id);
  return readFileSync(file, "utf8");
}

/** The confined path of a page file; throws if the slug escapes the project. */
function pagePath(projectRoot: string, slug: string): string {
  return assertWithin(projectRoot, join(projectRoot, "wiki", `${slug}.md`));
}

/** The confined path of a source's `text.md`; throws if the id escapes. */
function sourceTextPath(projectRoot: string, id: string): string {
  return assertWithin(projectRoot, join(projectRoot, "raw", id, "text.md"));
}

/** Best-effort frontmatter for a page; `null` when it has none or will not parse. */
function readPageFrontmatter(projectRoot: string, slug: string): PageFrontmatter | null {
  const file = pagePath(projectRoot, slug);
  if (!existsSync(file)) return null;
  const block = readFrontmatter(readFileSync(file, "utf8"));
  if (!block || !block.parsed) return null;
  return block.frontmatter as PageFrontmatter;
}

export { OutsideProjectError };