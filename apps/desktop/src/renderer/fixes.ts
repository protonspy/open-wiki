import type { Finding } from "@open-wiki/access";

/**
 * What a finding can be acted on with (desktop-ui 5.3).
 *
 * **Only what the finding actually carries.** A `Finding` has a code, a
 * severity, a message, a fix, and — where the check could point at one — a
 * page, a source and a line. It does **not** carry the slug a broken wikilink
 * names, the instant a citation overran, or the pair of words a synonym finding
 * is about: those exist only inside the prose of `message`.
 *
 * So three of the draft's five buttons are not built, and are not faked by
 * cutting the value back out of the sentence. `checks.ts` already learned that
 * lesson once and says so at the `wikilink.broken` site: *the target comes off
 * the issue rather than being cut back out of the sentence, which produced
 * garbage the moment the wording changed*. A fix button built that way would
 * create the page named `Cutover window, which is not a page` the first time
 * somebody reworded a check.
 *
 * What is here is what is honest: reach the thing the finding names, and the
 * one true one-click fix that already exists as an operation.
 */
export type FixKind =
  /** Go to the page the finding is about. */
  | "open-page"
  /** Open the source the finding is about, at its start. */
  | "open-source"
  /** Link an orphan from `wiki/index.md` — `registerInIndex`, on its own. */
  | "add-to-index";

export interface Fix {
  kind: FixKind;
  /** What the button says. */
  label: string;
  /** The page slug or the source id it acts on. */
  target: string;
}

/**
 * A page's slug from the path a finding names.
 *
 * `adr:0016-a-page-is-its-slug-wherever-it-sits`: the basename is the slug,
 * whatever folder it sits in, so this is the addressing model and not string
 * trimming that happens to work.
 */
export function slugOfPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.toLowerCase().endsWith(".md") ? base.slice(0, -3) : base;
}

/**
 * The fixes offered for one finding, most specific first.
 *
 * A finding about a page offers the page: whatever is wrong with it, the next
 * thing anybody does is read it. `page.orphan` additionally offers the one
 * write that closes it.
 *
 * **`knownSlugs` is what stops a button that cannot work.** Some findings are
 * about `wiki/changelog.md`, which is not an entity page (5.1 validates it as
 * itself) and is not in the index — so opening it by slug would fail with *no
 * page named changelog*, from a button the pane offered. A fix nobody can take
 * is worse than none, because the reader spends a click finding that out.
 */
export function fixesFor(finding: Finding, knownSlugs: ReadonlySet<string>): Fix[] {
  const fixes: Fix[] = [];
  const slug = finding.page === undefined ? null : slugOfPath(finding.page);
  const openable = slug !== null && knownSlugs.has(slug);

  if (finding.code === "page.orphan" && openable) {
    fixes.push({ kind: "add-to-index", label: "Add to index", target: slug });
  }
  if (finding.source !== undefined) {
    fixes.push({ kind: "open-source", label: "Open the source", target: finding.source });
  }
  if (openable) {
    fixes.push({ kind: "open-page", label: "Open the page", target: slug });
  }
  return fixes;
}
