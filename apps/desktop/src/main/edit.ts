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
  recordWrite,
  registerInIndex,
  snapshot,
  undo,
  readManifest,
  replaceWordInPage,
  updateManifest,
  type ReplaceResult,
  writePage,
  type GateDecision,
  type Operation,
  type PageRef,
} from "@open-wiki/access";
import { NoSuchPageError } from "./api.js";
import { isPageSlug } from "../shared/pages.js";

// Re-exported so the renderer types the result without importing the store.
export type { ReplaceResult };

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
  if (!isPageSlug(slug)) throw new InvalidSlugError(slug);
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
 * A `SaveResult`, plus the slug the copy landed under.
 *
 * An intersection rather than an `extends`, because `SaveResult` is a union:
 * the caller still has to narrow on `saved` before reading `markdown`, and the
 * new page's name is knowable either way.
 */
export type CopyResult = SaveResult & {
  /** The slug the copy landed under, once one was free. */
  slug: string;
};

/**
 * Save the buffer as a page of its own, rather than over the one that changed
 * underneath it (desktop-ui 6.4, and the plan's table against the draft's 8.8).
 *
 * **A named copy is not a silent pick.** 8.8 refuses to overwrite and shows
 * both versions, on the ground that choosing one silently is the only
 * unrecoverable outcome here. That argument does not forbid a third answer — it
 * forbids an *unannounced* one — and "keep both, I will reconcile them" is what
 * somebody actually wants when two hours of writing meets somebody else's edit.
 *
 * The copy takes a free slug beside the original and its `id` follows: the
 * schema is `type:slug` (5.1), so a copy keeping the original's id would be
 * refused on its very next save.
 */
export function savePageAsCopy(
  projectRoot: string,
  slug: string,
  markdown: string,
  today: Clock,
): CopyResult {
  const free = freeSlug(projectRoot, slug);
  const saved = createPage(projectRoot, { slug: free, markdown: renameId(markdown, free) }, today);
  return { ...saved, slug: free };
}

/**
 * `<slug>-copy`, then `-copy-2`, until one is free.
 *
 * Bounded, and the bound is not defensive politeness: `pageRef` walks the wiki
 * on every call, so an unbounded loop over a project that somehow holds a
 * thousand copies is a frozen main process. Past the bound it hands the last
 * candidate to `createPage`, which refuses it by name — a message somebody can
 * act on, rather than a spin.
 */
function freeSlug(projectRoot: string, slug: string): string {
  const base = `${slug}-copy`;
  for (let n = 1; n <= 50; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!pageRef(projectRoot, candidate)) return candidate;
  }
  return `${base}-50`;
}

export interface IndexResult {
  /** False when the page was already linked from the index. */
  added: boolean;
  /** Absent when nothing was written, because nothing happened to undo. */
  operationId?: string;
}

/**
 * Link a page from `wiki/index.md` (desktop-ui 5.3, for 7.1's `page.orphan`).
 *
 * **The operation a create already performs, on its own.** `createPage` calls
 * `registerInIndex` as part of creating a page; this is the same call for a
 * page that exists and is not linked — which is what an orphan is, and what
 * the finding's own `fix` says to do.
 *
 * Nothing is recorded when nothing is written: an operation restoring the file
 * to what it already was is an entry in the history offering to undo a write
 * that never happened, and 8.11's whole claim is that the history is what was
 * observed.
 *
 * `index.md` is not an entity page — 5.1 validates it as itself — so this does
 * not go through `gateWrite`, for the same reason `createPage`'s index write
 * does not.
 */
export function addToIndex(projectRoot: string, slug: string): IndexResult {
  assertSlug(slug);
  // A page that is not there is not an orphan; it is a finding that has gone
  // stale, and linking it would create the broken wikilink 7.1 reports.
  if (!pageRef(projectRoot, slug)) throw new NoSuchPageError(slug);

  const operation = appendOperation(projectRoot, {
    ...snapshotOf(projectRoot, [INDEX_PAGE]),
    origin: "editor",
  });
  if (!registerInIndex(projectRoot, slug)) return { added: false };
  return { added: true, operationId: operation.id };
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
 *
 * The write itself moved into `@open-wiki/access` (`specs/source-status`, R2.1).
 * It used to live here, which meant the CLI could not correct a title at all —
 * and the status verb that reads the same file would have become a second
 * manifest mutator in a second process, which is what 9.1's one-implementation
 * rule exists to prevent.
 */
export function retitleSource(projectRoot: string, id: string, title: string): void {
  updateManifest(projectRoot, id, { title });
}

/**
 * Declare a source read, or withdraw the declaration — by hand, from the
 * sources screen (plan task 7.1).
 *
 * **The one action on that screen that is not the agent's.** Everything else
 * about a source is either observed on disk or written by whoever read the
 * file; this is a judgement a person makes about a source they read outside the
 * loop, or about one the agent marked and they disagree with. `ow source mark`
 * is the same act through the other door (4.2), and both go through the single
 * manifest mutator of `specs/source-status` R2.1 rather than growing a second
 * writer in the Electron process — which is exactly what that rule was written
 * after finding here.
 *
 * The date is the desktop's own local day, for the reason the CLI uses its
 * own: a source marked and a page written in one sitting should carry the same
 * date.
 *
 * **Idempotent, and it keeps the original date**, which is `runSourceMark`'s
 * contract too: the declaration records *when somebody read the source*, so
 * re-stamping it on a repeat would lose the only fact it carries. The first
 * version wrote today's date unconditionally — nothing reached it twice,
 * because the button only offers "Mark read" when there is no declaration, so
 * the divergence was masked by its one caller rather than absent. A review
 * caught it. Two doors onto one act must not disagree about what the act is.
 */
/**
 * Rewrite an avoided synonym as this project's term — desktop-ui 5.6, the write
 * behind the *Replace* button on a `glossary.synonym` finding.
 *
 * It is `@open-wiki/access`'s `replaceWordInPage`, which shares one definition
 * of what counts as prose with the check that reported it. Here for the reason
 * every other write is: this module is the one that may write, and the editor,
 * the agent and this button all go through the same gate.
 */
export function replaceWord(
  projectRoot: string,
  pagePath: string,
  avoid: string,
  use: string,
  today: Clock,
): ReplaceResult {
  return replaceWordInPage(projectRoot, pagePath, avoid, use, today(), "editor");
}

export function markSourceProcessed(
  projectRoot: string,
  id: string,
  processed: boolean,
  today: string,
): void {
  const declared = readManifest(projectRoot, id).processed;
  const wanted = processed ? (declared ?? today) : undefined;
  // Nothing to write when the manifest already says this. A write that changes
  // nothing is still a write: it rewrites the file, and on a repeat mark it
  // would replace the date somebody's read is recorded at.
  if (wanted === declared) return;
  updateManifest(projectRoot, id, { processed: wanted ?? null });
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
