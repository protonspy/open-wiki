import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertWithin,
  boundedManifest,
  resolvedSourceDir,
  OutsideProjectError,
  listEntityPages,
  readIndex,
  isIndexed,
  readFrontmatter,
  readManifest,
  listSources,
  type PageFrontmatter,
  type SourceManifest,
  pagePath as lookupPagePath,
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

/**
 * Every source under `raw/` with its manifest and a flag for `text.md`.
 *
 * **The manifest's free text is bounded before it leaves**, and by
 * `boundedManifest` rather than by a list of fields kept here. Every field of
 * it comes out of a `manifest.json` that arrived with a `git clone`, and this
 * tool exists so an agent in *another* project can consult this one — so a
 * multi-megabyte value would be one source crowding every other out of a reader
 * who never even opened this repository, over HTTP, with no way to inspect the
 * file first.
 *
 * This bounded `title` and `description` by name until task 8.5 added
 * `superseded-by` and a security review found it going out unbounded here. That
 * is what a per-caller list of fields costs: it is correct on the day it is
 * written and silently incomplete the next time the schema grows. The rule
 * lives in one function now; the stored value is untouched by any of it.
 */
export function listSourcesState(projectRoot: string): SourceState[] {
  return listSources(projectRoot).map((id) => {
    const manifest = readManifest(projectRoot, id);
    const text = sourceTextPath(projectRoot, id);
    return { id, manifest: boundedManifest(manifest), hasText: existsSync(text) };
  });
}

/**
 * What `ow_read_source` answers — the text, or what is known about a source
 * that has none (plan task 7.3).
 *
 * One shape with a discriminator rather than a string that is sometimes an
 * apology: a consulting agent has to branch on *whether there is text* without
 * pattern-matching prose.
 */
export type SourceTextResult =
  | { id: string; hasText: true; text: string }
  | {
      id: string;
      hasText: false;
      title: string;
      kind: SourceManifest["kind"];
      original: string;
      processed?: string;
      description?: string;
      superseded?: { by: string; date?: string };
      reason: string;
    };

/** A source's `text.md`, or what it is when there is none (plan 7.3). */
export function readSourceText(projectRoot: string, id: string): SourceTextResult {
  // Confine first so an escaping id is refused before anything is read; then
  // `readManifest` turns a merely-absent id into `MissingSourceError`.
  const file = sourceTextPath(projectRoot, id);
  const manifest = boundedManifest(readManifest(projectRoot, id));
  if (existsSync(file)) return { id, hasText: true, text: readFileSync(file, "utf8") };

  // **What it has, rather than nothing.** Since `adr:0021` the application
  // stores a source and does not read it, so a great many sources have no
  // `text.md` at all — a PDF, an image, an archive — and throwing ENOENT told a
  // consulting agent only that something went wrong. It could not tell *empty*
  // from *unread*, which are different answers with different next steps.
  //
  // **And it cannot offer the original.** That project is not on this agent's
  // disk; MCP serves a different project over HTTP (`adr:0018`). Saying so is
  // the honest answer, and naming the file is what makes it actionable for
  // somebody who can reach the machine.
  return {
    id,
    hasText: false,
    title: manifest.title,
    kind: manifest.kind,
    original: manifest.original,
    ...(manifest.processed !== undefined ? { processed: manifest.processed } : {}),
    ...(manifest.description !== undefined ? { description: manifest.description } : {}),
    ...(manifest.status === "superseded"
      ? {
          superseded: {
            by: manifest["superseded-by"] ?? "",
            ...(manifest.superseded !== undefined ? { date: manifest.superseded } : {}),
          },
        }
      : {}),
    reason:
      `"${id}" has no text.md. This project stores sources and does not read them ` +
      `(adr:0021-sources-are-stored-not-parsed), so a document, an image or an archive has ` +
      `none until an agent working in that project writes one. The original is on that ` +
      `project's disk and cannot be served from here.`,
  };
}

/**
 * The confined path of a page file; throws if the slug escapes `wiki/`.
 *
 * A page is its slug wherever it sits under `wiki/`
 * (`adr:0016-a-page-is-its-slug-wherever-it-sits`), so the file is looked up
 * rather than assumed at the top level. Assuming it meant a page filed as
 * `wiki/topics/checkout.md` was listed by `ow_index` and then served as "no
 * page \"checkout\" under wiki/" — and its frontmatter read as `null`, so the
 * index reported `type: unknown, status: active` for a page that might be
 * superseded. That is worse than absent: it is confidently wrong.
 */
function pagePath(projectRoot: string, slug: string): string {
  const wikiDir = join(projectRoot, "wiki");
  const found = lookupPagePath(projectRoot, slug);
  // Confine to the `wiki/` directory, not just the project: a slug like
  // `../README` would otherwise resolve to `<root>/README.md`, which is inside
  // the project but is not a wiki page. The server serves `wiki/` only. The
  // fallback keeps "no such page" reachable for a slug that matches nothing.
  return assertWithin(wikiDir, join(projectRoot, found ?? `wiki/${slug}.md`));
}

/**
 * The confined path of a source's `text.md`; throws if the id escapes `raw/`.
 *
 * **Looked up, not assumed**, for the reason spelled out above `pagePath` — and
 * this is that lesson's second half, missed when the first was learned. A source
 * is its id wherever it sits under `raw/`
 * (`adr:0022-a-source-is-its-id-wherever-it-sits`, plan task 8.3), so joining
 * `raw/<id>/text.md` resolves a *filed* source to a directory that is not it.
 *
 * That is worse than not finding it. `readManifest` resolves through the walk
 * while this joined, so the two answered about different directories — and
 * because this required no `manifest.json` at the joined path, a repository
 * could ship a bare `raw/weekly/text.md` and have it served as the text of a
 * real, filed `raw/archive/2026/weekly`. The manifest would say one source and
 * the text would come from another, under a citation that looks sound. A
 * security review found it; the duplicate-id check could not, because the walk
 * only ever registers directories that hold a manifest.
 */
function sourceTextPath(projectRoot: string, id: string): string {
  return join(resolvedSourceDir(projectRoot, id), "text.md");
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
