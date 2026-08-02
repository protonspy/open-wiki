// **Type-only, and that is load-bearing.** A value import from
// `@open-wiki/access` pulls its barrel into this browser bundle, and the barrel
// reaches `paths.ts`, which imports `node:fs` and `node:path` — rollup then
// fails with *"resolve" is not exported by `__vite-browser-external`*. It is
// the same trap `App.tsx` names for `main/watcher.js` and chokidar, and neither
// `typecheck` nor `lint` sees it: only the bundle does.
import type { Finding, FindingCode } from "@open-wiki/access";

/**
 * How the checks pane arranges what `ow check` found (desktop-ui 5.2).
 *
 * **By family, in the draft's order, with the task that owns the check.** A
 * flat list of findings is a list of unrelated complaints; grouped, it says
 * *the links are fine and the vocabulary is not*, which is the shape somebody
 * decides what to fix from. 7.6 shipped the rendering — this is the shape.
 *
 * The task tag is on the group rather than on each finding. It is the draft's,
 * and it answers "why does this project check this at all" once per group
 * rather than eleven times.
 */

export interface Family {
  /** Stable key, for React and for a test. */
  key: string;
  /** What the group is called on screen. */
  title: string;
  /** The plan task that owns these checks. */
  task: string;
}

const LINKS: Family = { key: "links", title: "Links and reachability", task: "7.1" };
const RECORDS: Family = { key: "records", title: "Sources and the changelog", task: "7.2" };
const PROVENANCE: Family = { key: "provenance", title: "Provenance", task: "7.3" };
const VOCABULARY: Family = { key: "vocabulary", title: "Vocabulary", task: "7.4" };
const CODEWIKI: Family = { key: "codewiki", title: "Codewiki", task: "7.5" };
const SCHEMA: Family = { key: "schema", title: "The page schema", task: "5.1" };

/** The order they are read in: the draft's four, then the two it does not draw. */
export const FAMILIES: readonly Family[] = [
  LINKS,
  RECORDS,
  PROVENANCE,
  VOCABULARY,
  CODEWIKI,
  SCHEMA,
];

/**
 * Which family each code belongs to.
 *
 * **Exhaustive by type**, so a code added to `FINDING_CODES` and forgotten here
 * is a compile error rather than a finding that quietly renders in no group at
 * all — which is the same failure mode as not reporting it.
 */
const OF_CODE: Record<FindingCode, Family> = {
  "wikilink.broken": LINKS,
  "page.orphan": LINKS,
  "page.duplicate-slug": LINKS,
  "changelog.missing-page": RECORDS,
  "changelog.unrecorded-page": RECORDS,
  "source.uncited": RECORDS,
  "provenance.unresolved": PROVENANCE,
  "glossary.synonym": VOCABULARY,
  "glossary.conflict": VOCABULARY,
  "codewiki.citation-unresolved": CODEWIKI,
  "codewiki.citation-past-end": CODEWIKI,
  "codewiki.section-uncited": CODEWIKI,
  "codewiki.misplaced": CODEWIKI,
  "page.invalid": SCHEMA,
};

export function familyOf(code: FindingCode): Family {
  return OF_CODE[code];
}

export interface FindingGroup {
  family: Family;
  findings: Finding[];
}

/**
 * The findings as groups, empty ones left out.
 *
 * **The groups are ordered; what is inside one is not reordered.** `FAMILIES`
 * fixes the order of the bands, so the pane does not rearrange itself between
 * two runs of the same check. Inside a band the findings keep the order they
 * arrived in — which is `sortFindings`', because `checkProject` sorts before it
 * returns and the pane reads what `ow check` produced.
 *
 * Sorting again here would be a second authority on what order findings are
 * read in, and the two would disagree the day one of them changed.
 */
export function groupFindings(findings: readonly Finding[]): FindingGroup[] {
  const byKey = new Map<string, Finding[]>();
  for (const finding of findings) {
    const key = familyOf(finding.code).key;
    const group = byKey.get(key);
    if (group) group.push(finding);
    else byKey.set(key, [finding]);
  }
  return FAMILIES.filter((family) => byKey.has(family.key)).map((family) => ({
    family,
    findings: byKey.get(family.key) ?? [],
  }));
}

/**
 * Where a finding is, as one string.
 *
 * A finding is about a page, or about a source, or about neither — and the line
 * is there only when the check could point at one. Empty rather than "unknown":
 * a location nobody can act on is better absent than guessed at.
 */
export function whereOf(finding: Finding): string {
  const at = finding.page ?? finding.source ?? "";
  if (at === "") return "";
  return finding.line === undefined ? at : `${at}:${finding.line}`;
}
