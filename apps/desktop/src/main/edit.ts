import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  appendOperation,
  assertWithin,
  atomicWrite,
  gateWrite,
  isStoreOnlyChange,
  listOperations,
  listPages,
  NON_ENTITY_PAGES,
  pagesEqual,
  readManifest,
  recordWrite,
  registerInIndex,
  snapshot,
  undo,
  writePage,
  type GateDecision,
  type Operation,
  type PageRef,
} from "@open-wiki/access";
import { writeAtomic } from "@open-wiki/audio";
import { NoSuchPageError } from "./api.js";

/**
 * Writing from the editor (plan 8.7, 8.8, 8.9, 8.11 and 6.7).
 *
 * **It goes through the same gate the agent's writes go through.** Group 5's
 * whole claim is one implementation with three callers, and an editor that
 * validated a page its own way would be the fourth — quietly disagreeing with
 * the hook about what a well-formed page is. So this calls `gateWrite`, takes
 * its `accept` content when it completed the frontmatter, and reports its
 * denial reasons unchanged: 9.13 says the message has three mouths and they
 * have to say the same thing.
 *
 * It is a separate module from `api.ts` on purpose. That one imports
 * `@open-wiki/access/read` and cannot write whatever it is asked to; this one
 * imports the barrel and can. Keeping them apart is what makes "the read
 * surface is read-only" a fact about the import graph rather than a promise.
 */

export interface SaveInput {
  slug: string;
  markdown: string;
  /**
   * What the editor loaded. A save whose base no longer matches disk is
   * refused rather than applied (plan 8.8).
   */
  baseMarkdown: string;
}

export type SaveResult =
  | { saved: true; markdown: string; operationId: string }
  | { saved: false; reason: "stale"; onDisk: string }
  | { saved: false; reason: "invalid"; problems: string[] };

/** Today, as the store writes it. Injected so a test is not about the date. */
export type Clock = () => string;

/** The real one. `YYYY-MM-DD`, which is what the `updated` field carries. */
export const savePageToday: Clock = () => new Date().toISOString().slice(0, 10);

function pageRef(projectRoot: string, slug: string): PageRef | undefined {
  return listPages(projectRoot).find((page) => page.slug === slug);
}

/**
 * A page's name, and nothing else.
 *
 * The renderer supplies this — from a `prompt()`, or from anything that
 * reaches the bridge — and it is used to *build* a path rather than to look
 * one up, which makes it the one input in this module that is not resolved
 * through the index. Unvalidated it was a hole with teeth: `../CLAUDE` renamed
 * a page over the project's `CLAUDE.md`, and `../.claude/rules/autonomy` over
 * a rule file, which is instruction injection into the agent that has tool
 * access to this machine. `adr:0013` and 9.6 put a guard on exactly that, and
 * a rename that never called the gate walked around it.
 *
 * The shape is the store's own: what `deriveId` produces and what 5.1's `id`
 * accepts. Refusing anything else here means the path built from it cannot
 * contain a separator, a `..`, or a drive letter, whatever the caller sent.
 */
const SLUG = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

export class InvalidSlugError extends Error {
  constructor(slug: string) {
    super(
      `"${slug}" is not a page name. Use lower-case letters, digits and hyphens — ` +
        `a name is not a path, and the store's own ids have the same shape.`,
    );
    this.name = "InvalidSlugError";
  }
}

export function assertSlug(slug: string): string {
  if (!SLUG.test(slug)) throw new InvalidSlugError(slug);
  return slug;
}

/**
 * Save an edited page.
 *
 * The order is the interesting part: **staleness first, then the gate.** A page
 * that moved under the editor has to be reported as moved even if the buffer
 * would also have failed validation, because the two have different answers —
 * one is "look at what changed", the other is "fix this field".
 */
export function savePage(projectRoot: string, input: SaveInput, today: Clock): SaveResult {
  const ref = pageRef(projectRoot, input.slug);
  if (!ref) throw new NoSuchPageError(input.slug);
  const file = assertWithin(projectRoot, join(projectRoot, ref.path));
  const onDisk = existsSync(file) ? readFileSync(file, "utf8") : "";

  if (isStale(input.baseMarkdown, onDisk)) {
    return { saved: false, reason: "stale", onDisk };
  }

  const decision: GateDecision = gateWrite({
    projectRoot,
    filePath: ref.path,
    content: input.markdown,
    date: today(),
  });
  if (decision.action === "deny") {
    return { saved: false, reason: "invalid", problems: decision.reasons };
  }
  // `accept` means the store filled something in — `updated`, or a source it
  // read out of the body (5.5). What goes to disk is the store's version.
  const markdown = decision.action === "accept" ? decision.content : input.markdown;

  const operation = writePage(projectRoot, ref.path, markdown, "editor");
  recordWrite(projectRoot, { slug: ref.slug, action: "modified", origin: "editor", date: today() });
  registerInIndex(projectRoot, ref.slug);
  return { saved: true, markdown, operationId: operation.id };
}

/**
 * Whether the file moved under the editor in a way the writer has to see.
 *
 * A correction the store itself made is not somebody else's edit — 5.8 says so
 * in as many words, and it is the reason this is not a string comparison. The
 * editor fills `updated` on save; the next save from the same buffer would
 * otherwise look stale to the writer against a change they did not make.
 */
export function isStale(base: string, onDisk: string): boolean {
  if (base === onDisk) return false;
  if (pagesEqual(base, onDisk)) return false;
  return !isStoreOnlyChange(base, onDisk);
}

export interface CreateInput {
  slug: string;
  markdown: string;
}

/** Where `registerInIndex` writes, and therefore part of a create's operation. */
const INDEX_PAGE = "wiki/index.md";

export class PageExistsError extends Error {
  constructor(slug: string) {
    super(`a page named "${slug}" already exists`);
    this.name = "PageExistsError";
  }
}

/** Create a page (plan 8.9). It goes through the gate like every other write. */
export function createPage(projectRoot: string, input: CreateInput, today: Clock): SaveResult {
  // Before the path is built. `gateWrite` classifies by where a write lands
  // and has *no opinion* about anything outside `wiki/` — so a traversal slug
  // both escaped the wiki and skipped every check the gate exists to apply.
  assertSlug(input.slug);
  if (pageRef(projectRoot, input.slug)) throw new PageExistsError(input.slug);
  const path = `wiki/${input.slug}.md`;
  const decision = gateWrite({
    projectRoot,
    filePath: path,
    content: input.markdown,
    date: today(),
  });
  if (decision.action === "deny") {
    return { saved: false, reason: "invalid", problems: decision.reasons };
  }
  const markdown = decision.action === "accept" ? decision.content : input.markdown;
  // The index is part of the operation, not a write beside it. `writePage`
  // snapshots the one page it writes, and `registerInIndex` then touches
  // `index.md` — so undoing a create removed the page and left the index
  // entry pointing at it, which is a broken wikilink the undo created.
  const operation = appendOperation(projectRoot, {
    ...snapshotOf(projectRoot, [path, INDEX_PAGE]),
    origin: "editor",
  });
  atomicWrite(projectRoot, path, markdown);
  recordWrite(projectRoot, {
    slug: input.slug,
    action: "created",
    origin: "editor",
    date: today(),
  });
  registerInIndex(projectRoot, input.slug);
  return { saved: true, markdown, operationId: operation.id };
}

export interface RenameResult {
  /** Pages whose `[[wikilink]]`s were repointed. */
  repointed: string[];
  operationId: string;
}

export class InvalidRenameError extends Error {
  constructor(
    to: string,
    readonly problems: string[],
  ) {
    super(`renaming to "${to}" would produce a page the store refuses: ${problems.join("; ")}`);
    this.name = "InvalidRenameError";
  }
}

/** The real path, or the path itself when nothing is there yet. */
function realpathOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Point a page's `id` at its new slug, keeping its type.
 *
 * The schema is `type:slug` (plan 5.1), so replacing the whole value would
 * make the page typeless and the gate would refuse every later save of it.
 *
 * **The frontmatter block is split off first, and the substitution runs only
 * inside it.** A regex that reached across the closing `---` did two things
 * wrong: on a page with no `id` in its frontmatter it rewrote the first `id:`
 * it found in the *prose* and swallowed the rest of that line, and on a long
 * page it retried at every line starting `---`, which is quadratic — a
 * megabyte page froze the main process for half a minute, and page content is
 * exactly what arrives with a clone.
 */
export function renameId(markdown: string, to: string): string {
  const match = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)([\s\S]*)$/.exec(markdown);
  if (!match) return markdown;
  const [, open, front, close, body] = match as unknown as [string, string, string, string, string];
  // Anchored to the start of a line *within the block*, so `source-id:` and a
  // value containing `id:` are both left alone.
  const rewritten = front.replace(
    /^([ \t]*id:[ \t]*["']?)([A-Za-z0-9_-]+:)?([^"'\r\n]*)(["']?)/m,
    (_whole, head: string, type = "", _old: string, quote: string) => `${head}${type}${to}${quote}`,
  );
  return `${open}${rewritten}${close}${body}`;
}

// `[[old]]` and `[[old|label]]`, with the target matched exactly.
function wikilinkTo(slug: string): RegExp {
  return new RegExp(`\\[\\[${escapeForRegExp(slug)}(\\||\\]\\])`, "g");
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rename a page and repoint what pointed at it (plan 8.9).
 *
 * Repointing is the whole of the task. A rename that leaves the links behind
 * turns every one of them into a 7.1 finding, and the user who renamed the
 * page is the one person who knew they all meant it.
 */
export function renamePage(projectRoot: string, from: string, to: string): RenameResult {
  // Both ends. `to` builds a path, and `from` builds the regex that rewrites
  // every page linking to it.
  assertSlug(from);
  assertSlug(to);
  const ref = pageRef(projectRoot, from);
  if (!ref) throw new NoSuchPageError(from);
  if (pageRef(projectRoot, to)) throw new PageExistsError(to);

  const source = assertWithin(projectRoot, join(projectRoot, ref.path));
  const markdown = readFileSync(source, "utf8");
  // The page keeps its folder: a rename changes the name, not the shelf.
  const target = ref.path.replace(/[^/]+\.md$/, `${to}.md`);

  // The page's own `id` has to follow its slug, or 5.1 refuses it forever.
  const renamed = renameId(markdown, to);

  // Through the gate, like every other write. Without this a rename was the
  // one door into the store that no validation stood behind — and the thing
  // it most needed to check was itself: a name that is not a slug produces an
  // `id` the schema refuses, so every later save of the renamed page fails,
  // which is precisely what `renameId` exists to prevent.
  const decision = gateWrite({
    projectRoot,
    filePath: target,
    content: renamed,
    date: savePageToday(),
  });
  if (decision.action === "deny") throw new InvalidRenameError(to, decision.reasons);
  const settled = decision.action === "accept" ? decision.content : renamed;

  // Everything that has to change, snapshotted as one operation — undo puts
  // the rename and every repointed link back together, which is what makes it
  // a rename rather than a page plus a scattering of edits.
  const touched = [ref.path, target];
  const repointed: string[] = [];
  const rewrites: Array<{ path: string; content: string }> = [];
  // `listPages` deliberately excludes `index.md`, `changelog.md` and `log.md`
  // — they are not entity pages. They do carry wikilinks, and `index.md` is
  // guaranteed to link to this page because `registerInIndex` put it there, so
  // a repoint that skipped them left a broken link in the one file certain to
  // have one.
  // `NON_ENTITY_PAGES` are bare filenames; they live at the top of `wiki/`.
  const linkers = [
    ...listPages(projectRoot).map((p) => p.path),
    ...NON_ENTITY_PAGES.map((name) => `wiki/${name}`),
  ];
  for (const path of linkers) {
    if (path === ref.path) continue;
    const file = assertWithin(projectRoot, join(projectRoot, path));
    if (!existsSync(file)) continue;
    const body = readFileSync(file, "utf8");
    const next = body.replace(wikilinkTo(from), `[[${to}$1`);
    if (next !== body) {
      rewrites.push({ path, content: next });
      touched.push(path);
      repointed.push(path.replace(/^wiki\//, "").replace(/\.md$/, ""));
    }
  }

  const operation = appendOperation(projectRoot, {
    ...snapshotOf(projectRoot, touched),
    origin: "editor",
  });

  atomicWrite(projectRoot, target, settled);
  for (const rewrite of rewrites) atomicWrite(projectRoot, rewrite.path, rewrite.content);
  // Only when the target is a different file. On Windows — the platform this
  // product supports — the filesystem is case-insensitive, so renaming
  // `fenix` to `Fenix` writes *onto* the source, and removing the source
  // afterwards deleted the page outright.
  if (realpathOf(source) !== realpathOf(join(projectRoot, target))) {
    rmSync(source, { force: true });
  }

  recordWrite(projectRoot, {
    slug: to,
    action: "created",
    origin: "editor",
    date: savePageToday(),
  });
  recordWrite(projectRoot, {
    slug: from,
    action: "modified",
    origin: "editor",
    date: savePageToday(),
  });
  registerInIndex(projectRoot, to);
  return { repointed, operationId: operation.id };
}

/**
 * Delete a page (plan 8.9).
 *
 * What pointed at it is **not** rewritten. A wikilink to a deleted page is a
 * 7.1 finding and should be: the links are the record that something was
 * expected to be there, and silently unlinking them would erase the only
 * evidence that the page is missing. A rename knows where the reader should go
 * instead; a delete does not.
 */
export function deletePage(projectRoot: string, slug: string): { operationId: string } {
  const ref = pageRef(projectRoot, slug);
  if (!ref) throw new NoSuchPageError(slug);
  const operation = appendOperation(projectRoot, {
    ...snapshotOf(projectRoot, [ref.path]),
    origin: "editor",
  });
  rmSync(assertWithin(projectRoot, join(projectRoot, ref.path)), { force: true });
  // `modified` because the log's vocabulary has no `deleted` — the operation
  // log of 2.4 is what records the removal precisely, and this line is the
  // human-readable trail beside it.
  recordWrite(projectRoot, {
    slug,
    action: "modified",
    origin: "editor",
    date: savePageToday(),
  });
  return { operationId: operation.id };
}

/** The operation history (plan 8.11), newest first. */
export function history(projectRoot: string, limit = 100): Operation[] {
  return [...listOperations(projectRoot)].reverse().slice(0, limit);
}

export function undoOperation(projectRoot: string, id: string): void {
  undo(projectRoot, id);
}

/**
 * Correct a source's readable title without moving its directory or touching a
 * citation (plan 6.7).
 *
 * `adr:0011-sources-are-named-by-what-they-are` freezes the id and says the
 * freeze "is only bearable if the readable name stays editable". This is that.
 */
export function retitleSource(projectRoot: string, id: string, title: string): void {
  const manifest = readManifest(projectRoot, id);
  const rawDir = join(projectRoot, "raw");
  const file = assertWithin(rawDir, join(rawDir, id, "manifest.json"));
  // The package's own hardened writer rather than a third copy of temp-plus-
  // rename: a fixed `${file}.tmp` is a name an attacker can plant at, and two
  // concurrent retitles of one source would share it — the loser's cleanup
  // deleting the winner's in-flight file.
  writeAtomic(file, `${JSON.stringify({ ...manifest, title }, null, 2)}\n`);
}

/**
 * One snapshot covering every path an operation touches.
 *
 * `writePage` snapshots the single page it writes, which is right for a save
 * and wrong for a rename: a rename is a page *and* every link that pointed at
 * it, and undo has to put them all back together or it produces a project
 * where half the rename happened.
 */
function snapshotOf(
  projectRoot: string,
  paths: readonly string[],
): { id: string; pages: ReturnType<typeof snapshot>["pages"]; snapshotId: string } {
  const snap = snapshot(projectRoot, [...paths]);
  return { id: snap.id, pages: snap.pages, snapshotId: snap.id };
}
