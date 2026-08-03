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
 * **That was true until 5.6.** The three values now come off the finding —
 * `target`, `endsAt` and `replace` — because `adr:0023` decided a check
 * carries what it found instead of formatting it into a sentence and dropping
 * it. Nothing here parses `message`, and nothing here ever will: `checks.ts`
 * learned that lesson once and says so at the `wikilink.broken` site, where
 * cutting the target back out of the prose *produced garbage the moment the
 * wording changed*. A button built that way creates the page named
 * "Cutover window, which is not a page" the first time somebody rewords a check.
 *
 * So a fix is offered exactly when the finding carries what it needs, and never
 * when it does not.
 */
export type FixKind =
  /** Go to the page the finding is about. */
  | "open-page"
  /** Open the source the finding is about, at its start. */
  | "open-source"
  /** Link an orphan from `wiki/index.md` — `registerInIndex`, on its own. */
  | "add-to-index"
  /** Write the page a broken wikilink names (5.6, from `target`). */
  | "create-page"
  /** Open the recording at the last instant it contains (5.6, from `endsAt`). */
  | "open-at"
  /** Rewrite an avoided synonym as the project's term (5.6, from `replace`). */
  | "replace";

export interface Fix {
  kind: FixKind;
  /** What the button says. */
  label: string;
  /** The page slug or the source id it acts on. */
  target: string;
  /**
   * The instant an `open-at` opens, and the words a `replace` rewrites.
   *
   * Carried on the fix rather than looked up again from the finding, so the
   * button and what it does cannot come to disagree about which value it was
   * offered for.
   */
  at?: string;
  replace?: { avoid: string; use: string };
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
  // 5.6 — the three the draft drew and 5.3 could not build. Each is offered
  // only where the check carried the value it needs, which is the whole of what
  // `adr:0023` changed.
  if (finding.code === "wikilink.broken" && finding.target !== undefined) {
    fixes.push({ kind: "create-page", label: "Create the page", target: finding.target });
  }
  if (finding.endsAt !== undefined && finding.source !== undefined) {
    fixes.push({
      kind: "open-at",
      label: `Open at ${finding.endsAt}`,
      target: finding.source,
      at: finding.endsAt,
    });
  }
  if (finding.replace !== undefined && finding.page !== undefined) {
    fixes.push({
      kind: "replace",
      label: `Replace with "${finding.replace.use}"`,
      target: finding.page,
      replace: finding.replace,
    });
  }
  if (finding.source !== undefined) {
    fixes.push({ kind: "open-source", label: "Open the source", target: finding.source });
  }
  if (openable) {
    fixes.push({ kind: "open-page", label: "Open the page", target: slug });
  }
  return fixes;
}
