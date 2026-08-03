/**
 * What a check reports (plan group 7). With the agent writing pages through the
 * filesystem, this stops being hygiene and becomes the net of record: group 5
 * refuses a malformed write, but a page edited in another editor, written
 * through the shell, or made wrong by a *later* change to something else never
 * passes a gate at all.
 *
 * Every finding carries a **correction path**, not just a complaint. 7.6 shows
 * these in the UI and 7.7 prints them for an agent, and both need to say what
 * to do — a refusal a reader cannot act on becomes an attempt they repeat
 * verbatim (the same reason 9.13 exists).
 */

/**
 * The kinds of finding. Stable strings: the UI groups by them, `ow check
 * --json` prints them, and a CI job greps them, so they are an interface.
 */
export const FINDING_CODES = [
  // 7.1 — reachability and links
  "wikilink.broken",
  "page.orphan",
  "page.duplicate-slug",
  // 7.2 — the records, and sources nothing uses
  "changelog.missing-page",
  "changelog.unrecorded-page",
  "source.uncited",
  // 8.3 — a source is its id wherever it sits, so an id names exactly one
  "source.duplicate-id",
  // 7.3 — provenance
  "provenance.unresolved",
  // 7.4 — vocabulary
  "glossary.synonym",
  "glossary.conflict",
  // 7.5 — codewiki
  "codewiki.citation-unresolved",
  "codewiki.citation-past-end",
  "codewiki.section-uncited",
  "codewiki.misplaced",
  // the page schema itself, re-checked outside the gate
  "page.invalid",
] as const;

export type FindingCode = (typeof FINDING_CODES)[number];

/**
 * `error` is something wrong: a link that goes nowhere, a citation that does
 * not resolve. `warning` is something that is probably wrong but that a project
 * may legitimately choose — a source nobody has cited yet is the common one,
 * on the day it was uploaded.
 */
export type Severity = "error" | "warning";

export interface Finding {
  code: FindingCode;
  severity: Severity;
  /** What is wrong, in one sentence, naming the thing. */
  message: string;
  /** What to do about it. Required: a finding nobody can act on is noise. */
  fix: string;
  /** The page this is about, as a project-relative path. */
  page?: string;
  /** The source id this is about. */
  source?: string;
  /** The 1-based line of `page` the finding sits on, where there is one. */
  line?: number;
  /**
   * The slug a broken wikilink names (`wikilink.broken`).
   *
   * **Carried, not cut back out of `message`.** `checks.ts` learned that once
   * already, at this very site: a caller that reconstructs a value from the
   * sentence produces garbage the first time somebody rewords the sentence, and
   * a *Create the page* button built that way creates a page called
   * "Cutover window, which is not a page".
   *
   * That is the whole of what these three fields are for (desktop-ui 5.6). They
   * are an **interface**: `ow check --json` prints them, MCP serves them and a
   * CI job reads them, which is why the shape is a decision written down
   * (`adr:0023`) rather than three fields somebody added.
   */
  target?: string;
  /**
   * The last instant the recording actually contains, when a citation named one
   * past it (`provenance.unresolved`).
   *
   * An instant in the same format `@open-wiki/audio`'s `formatInstant` writes
   * and `parseInstant` reads, because a second spelling of a time is how two
   * parts of this product come to disagree about which moment a claim was made
   * at.
   */
  endsAt?: string;
  /**
   * The word to stop using and the term to use instead (`glossary.synonym`).
   *
   * Both halves, because a caller that has only the avoided word would have to
   * find the canonical one again — and `avoid` is what a rewrite matches, which
   * is not always what `message` shows: the check matches case-insensitively.
   */
  replace?: { avoid: string; use: string };
}

/**
 * Make a string from a page safe to put in a message.
 *
 * Every interpolated value below reaches a finding from somewhere an agent
 * writes: a frontmatter alias, a heading, a link target, a filename. A
 * double-quoted YAML scalar carries `\n`, `\r` and `\u001b` intact, and
 * `ow check` writes its report straight to a terminal — so an alias holding a
 * newline plus its own "ow check: no findings" line, or a `\r` and a cursor
 * escape, can forge or erase the summary a human reads to decide whether the
 * wiki is sound. The report is the artifact that decision rests on.
 *
 * Control characters go, and the text is bounded: a 10 KB alias should not
 * flood the report either.
 */
export const MAX_QUOTED = 200;

export function safe(text: string): string {
  const stripped = text.replace(/\p{Cc}/gu, " ").trim();
  return stripped.length > MAX_QUOTED ? `${stripped.slice(0, MAX_QUOTED)}…` : stripped;
}

/** Order findings the way a reader wants them: errors first, then by location. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  const rank = (f: Finding): number => (f.severity === "error" ? 0 : 1);
  return [...findings].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.page ?? a.source ?? "").localeCompare(b.page ?? b.source ?? "") ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.code.localeCompare(b.code),
  );
}

/** True when anything found is an error rather than a warning. */
export function hasErrors(findings: readonly Finding[]): boolean {
  return findings.some((f) => f.severity === "error");
}
