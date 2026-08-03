import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { listPages, readIndex, isIndexed, CODEWIKI_DIR, type PageRef } from "../store/index.js";
import { readFrontmatter, validatePage } from "../store/page.js";
import { linkableSlugs, resolveWikilinks } from "../store/wikilinks.js";
import { extractProvenanceLinks, resolveProvenance } from "../store/provenance.js";
import { listSources, readManifest } from "../sources/manifest.js";
import { isDerivedId } from "../sources/id.js";
import { assertWithin } from "../paths.js";
import type { Finding } from "./findings.js";
import { safe, sortFindings } from "./findings.js";

/**
 * The integrity checks (plan group 7). Each one answers a question the gate
 * cannot: the gate sees a single write, and every check here is about a
 * relationship *between* things — a link and its target, a page and the index,
 * a citation and the file it points into, a word and the term it should be.
 *
 * They are pure reads. Nothing here repairs anything: a check that quietly
 * fixed a page would be a write nobody reviewed, and the corrections are the
 * agent's or the user's to make (7.6 shows them, 7.7 prints them).
 */

/** A page read once, so ten checks do not read it ten times. */
export interface LoadedPage extends PageRef {
  text: string;
  body: string;
  frontmatter: Record<string, unknown> | null;
}

function loadPages(projectRoot: string): LoadedPage[] {
  return listPages(projectRoot).map((ref) => {
    const text = readFileSync(join(projectRoot, ref.path), "utf8");
    const block = readFrontmatter(text);
    return {
      ...ref,
      text,
      body: block?.body ?? text,
      frontmatter:
        block?.parsed && block.frontmatter && typeof block.frontmatter === "object"
          ? (block.frontmatter as Record<string, unknown>)
          : null,
    };
  });
}

/**
 * The 1-based line of the *file* that `needle` first appears on in the page's
 * body, or undefined.
 *
 * Searching the whole file found the slug or alias in `id:` or `title:` first
 * and sent the reader into the frontmatter every time. Searching the body and
 * adding the frontmatter's height gives the line the prose is actually on. The
 * match is case-insensitive because the checks that produce these needles are.
 */
function lineInPage(page: LoadedPage, needle: string): number | undefined {
  if (needle === "") return undefined;
  const at = page.body.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return undefined;
  const frontmatterLines = page.text.length - page.body.length;
  const before = page.text.slice(0, frontmatterLines);
  return before.split("\n").length - 1 + page.body.slice(0, at).split("\n").length;
}

/**
 * Blank out fenced code, keeping the line count intact so a reported line still
 * points where the reader expects.
 */
function withoutFences(body: string): string {
  let inFence = false;
  return body
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return "";
      }
      return inFence ? "" : line;
    })
    .join("\n");
}

/** The 1-based line `needle` first appears on in `text`, or undefined. */
function lineOf(text: string, needle: string): number | undefined {
  const at = text.indexOf(needle);
  if (at < 0) return undefined;
  return text.slice(0, at).split("\n").length;
}

/**
 * 7.1 — broken wikilinks, orphan pages, and the rule that makes a slug mean one
 * page.
 */
export function checkLinks(projectRoot: string, pages: LoadedPage[]): Finding[] {
  const findings: Finding[] = [];

  // Built once for the whole run. `resolveWikilinks` walks `wiki/` when it is
  // not handed a set, and calling it per page made the check quadratic — 3
  // seconds over 800 pages, where the pages are already in hand here.
  const known = linkableSlugs(projectRoot);

  for (const page of pages) {
    for (const issue of resolveWikilinks(projectRoot, page.body, page.slug, known)) {
      findings.push({
        code: "wikilink.broken",
        severity: "error",
        page: page.path,
        message: `${page.path}: ${safe(issue.reason)}`,
        fix: "Write the page it names, or correct the link to a slug that exists. `ow graph` lists every page.",
        // The target comes off the issue rather than being cut back out of the
        // sentence, which produced garbage the moment the wording changed.
        line: issue.target ? lineInPage(page, `[[${issue.target}`) : undefined,
      });
    }
  }

  const indexText = readIndex(projectRoot);
  for (const page of pages) {
    if (isIndexed(indexText, page.slug)) continue;
    findings.push({
      code: "page.orphan",
      severity: "error",
      page: page.path,
      message: `${page.path} is not reachable from wiki/index.md`,
      fix: `Add a link to [[${page.slug}]] in wiki/index.md, under the section it belongs to.`,
    });
  }

  // A slug names a page, so two files cannot share one: `[[checkout]]` would
  // have no answer. Reported rather than resolved — picking one silently is how
  // a link starts pointing at the wrong page.
  const bySlug = new Map<string, PageRef[]>();
  for (const page of pages) {
    const group = bySlug.get(page.slug);
    if (group) group.push(page);
    else bySlug.set(page.slug, [page]);
  }
  for (const [slug, group] of bySlug) {
    if (group.length < 2) continue;
    const where = group.map((p) => p.path).join(", ");
    for (const page of group) {
      findings.push({
        code: "page.duplicate-slug",
        severity: "error",
        page: page.path,
        message: `the slug "${slug}" names ${group.length} pages (${where}), so [[${slug}]] is ambiguous`,
        fix: "Rename all but one, and fix the links that pointed at it. A folder is organisation; the slug is the name.",
      });
    }
  }

  return findings;
}

/** 7.2 — the changelog against the pages, and sources nothing cites. */
export function checkRecords(
  projectRoot: string,
  pages: LoadedPage[],
  citedSources: ReadonlySet<string>,
): Finding[] {
  const findings: Finding[] = [];
  const changelogPath = join(projectRoot, "wiki", "changelog.md");
  const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : "";
  const slugs = new Set(pages.map((p) => p.slug));

  // Named in the changelog, gone from the wiki.
  const named = new Set<string>();
  for (const match of changelog.matchAll(/\[\[([^\]|#]+)/g)) {
    const slug = match[1]?.trim();
    if (slug) named.add(slug);
  }
  for (const slug of named) {
    if (slugs.has(slug)) continue;
    findings.push({
      code: "changelog.missing-page",
      // A warning, not an error, and the difference is not cosmetic: a page
      // that was deliberately deleted leaves an entry naming it forever, and a
      // changelog is a record — correcting it to point at nothing is not a
      // thing the syntax can express. An error here would be permanently red
      // with no action that clears it, which teaches a reader to ignore the
      // whole report.
      severity: "warning",
      page: "wiki/changelog.md",
      message: `wiki/changelog.md records [[${safe(slug)}]], which is not a page`,
      fix: "If the page was renamed, name the new slug. If it was deleted, this entry is the record that it existed and the finding is expected — nothing to do.",
      line: lineOf(changelog, `[[${slug}`),
    });
  }

  // In the wiki, never recorded. A page that arrived without a changelog entry
  // is a change nobody can find later.
  for (const page of pages) {
    if (named.has(page.slug)) continue;
    findings.push({
      code: "changelog.unrecorded-page",
      severity: "warning",
      page: page.path,
      message: `${page.path} is not mentioned anywhere in wiki/changelog.md`,
      fix: `Add an entry under today's date recording what [[${page.slug}]] is for.`,
    });
  }

  // A source nobody has finished with. This is the case that disappears from
  // view on its own: nothing links to it, so nobody trips over it.
  //
  // It takes **two** facts, not one (`specs/source-status`, R4.1). "No page
  // cites this" on its own reported every source somebody read and deliberately
  // discarded — which leaves no trace on the filesystem at all — as a permanent
  // finding, and a check that cries wolf is a check people stop reading. So a
  // declared source is out, whether or not anything cites it.
  for (const id of listSources(projectRoot)) {
    if (citedSources.has(id)) continue;
    if (declaredProcessed(projectRoot, id)) continue;
    findings.push({
      code: "source.uncited",
      severity: "warning",
      source: id,
      message: `raw/${id} is a source no page cites and nobody has marked read`,
      // Both ways out, because the reader who discarded this deliberately needs
      // to be told they may record that — not told again to distil it. The verb
      // is named now that plan task 4.2 has built it; while it did not exist
      // this said the judgement instead, since a `fix` naming a command nobody
      // can run is the noise a `fix` exists to avoid.
      //
      // **The command is offered only for an id that could have been derived.**
      // `listSources` reads directory names verbatim and a directory under
      // `raw/` is not necessarily one this application created, so an id can
      // hold `;` or a backtick — and this text is written to be *acted on*, by
      // an agent that has a shell. `safe` is not the guard for that: it strips
      // control characters to stop a forged report line, and shell
      // metacharacters are neither control characters nor a forgery. An id that
      // is not a plain slug is named as data instead, which is the same advice
      // without a command to paste.
      fix: markFix(id),
    });
  }

  return findings;
}

/** The tail every `source.uncited` fix ends with. */
const KEEPS_IT = "It stays in raw/ either way; sources are never deleted to tidy a report.";

/**
 * The correction path for an uncited source, offering the verb as something to
 * run only when the id is one this application could have derived.
 */
function markFix(id: string): string {
  const record = isDerivedId(id)
    ? `run \`ow source mark ${id}\` to record that judgement`
    : `mark the source named in this finding as processed to record that judgement ` +
      `(its directory name is not a plain id, so it is named here rather than as a command to run)`;
  return (
    `Distil it into a page, or — if it was read and there was nothing in it worth writing — ` +
    `${record}, and it stops being reported. ${KEEPS_IT}`
  );
}

/**
 * Whether somebody declared they had finished reading this source.
 *
 * A manifest that will not parse answers `false` rather than taking the report
 * down: `listSources` only checks that the file exists, and one bad directory
 * must not cost the other nineteen their findings. `false` is also the safe
 * answer — it reports a source that may already have been read, which costs a
 * glance, where `true` would hide one nobody has opened.
 */
function declaredProcessed(projectRoot: string, id: string): boolean {
  try {
    return readManifest(projectRoot, id).processed !== undefined;
  } catch {
    return false;
  }
}

/** 7.3 — provenance links that resolve to no source, or to no instant in one. */
export function checkProvenance(projectRoot: string, pages: LoadedPage[]): Finding[] {
  const findings: Finding[] = [];
  for (const page of pages) {
    for (const issue of resolveProvenance(projectRoot, linksOf(page))) {
      findings.push({
        code: "provenance.unresolved",
        severity: "error",
        page: page.path,
        message: `${page.path}: ${safe(issue.reason)}`,
        fix: "Upload the source it names, or correct the citation. A citation that opens nothing is worse than none — if the source cannot be produced, the claim comes out with it.",
      });
    }
  }
  return findings;
}

/** The provenance links a page rests on: its frontmatter plus its prose. */
function linksOf(page: LoadedPage): string[] {
  const declared = Array.isArray(page.frontmatter?.["sources"])
    ? (page.frontmatter["sources"] as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  return [...new Set([...declared, ...extractProvenanceLinks(page.body)])];
}

/**
 * Source id → the pages citing it. One read of the wiki answers both "which
 * sources does nothing cite" (7.2) and "which pages cite this source" (6.4),
 * and feeds every source's state (6.1).
 */
export function citedSourcePages(pages: LoadedPage[]): Map<string, string[]> {
  const citations = new Map<string, string[]>();
  for (const page of pages) {
    for (const link of linksOf(page)) {
      const id = /^(?:src|rec):\/\/([^#]+)#/.exec(link)?.[1];
      if (id === undefined) continue;
      const pagesForId = citations.get(id);
      if (pagesForId) {
        if (!pagesForId.includes(page.path)) pagesForId.push(page.path);
      } else {
        citations.set(id, [page.path]);
      }
    }
  }
  return citations;
}

/** Every source id any page cites, for the uncited check of 7.2. */
export function citedSourceIds(pages: LoadedPage[]): Set<string> {
  return new Set(citedSourcePages(pages).keys());
}

/**
 * 7.4 — a synonym used where the project has a canonical term.
 *
 * The canonical terms are not a separate file: every page already declares its
 * own in frontmatter — `title` is the term, `aliases` are the synonyms. Adding
 * a `glossary.md` beside that would be a second record of one fact, and the
 * copy is the one that goes stale.
 *
 * The page that *declares* an alias is exempt. That is where "Fenix, also known
 * as the fenix platform" legitimately belongs, and flagging it would train a
 * reader to ignore this check.
 */
export function checkVocabulary(pages: LoadedPage[]): Finding[] {
  const findings: Finding[] = [];

  const titleOf = (page: LoadedPage): string | undefined =>
    typeof page.frontmatter?.["title"] === "string" ? page.frontmatter["title"] : undefined;

  // Every title, so an alias claiming a name another page already answers to is
  // reported as the conflict it is rather than as noise on the victim.
  const titles = new Map<string, LoadedPage>();
  for (const page of pages) {
    const title = titleOf(page);
    if (title) titles.set(title.toLowerCase(), page);
  }

  // alias (lowercased) → the page that declares it
  const canonical = new Map<string, { slug: string; title: string; path: string }>();
  for (const page of pages) {
    const aliases = page.frontmatter?.["aliases"];
    const title = titleOf(page);
    if (!Array.isArray(aliases) || title === undefined) continue;
    for (const alias of aliases) {
      if (typeof alias !== "string" || alias.trim() === "") continue;
      const key = alias.toLowerCase();

      // Two pages claiming one alias is the same ambiguity `page.duplicate-slug`
      // exists for. Last-writer-wins silently picked one and then flagged the
      // *declaring* page of the loser for writing its own alias.
      const claimed = canonical.get(key);
      if (claimed && claimed.path !== page.path) {
        findings.push({
          code: "glossary.conflict",
          severity: "error",
          page: page.path,
          message: `"${safe(alias)}" is an alias of both ${claimed.path} ("${safe(claimed.title)}") and ${page.path} ("${safe(title)}")`,
          fix: "One name means one concept. Drop the alias from whichever page it does not belong to, or the term is genuinely two things and needs two names.",
        });
        continue;
      }

      // An alias that is some other page's title is the same conflict wearing a
      // different hat, and left unreported it flagged that page every time it
      // wrote its own name.
      const owner = titles.get(key);
      if (owner && owner.path !== page.path) {
        findings.push({
          code: "glossary.conflict",
          severity: "error",
          page: page.path,
          message: `${page.path} lists "${safe(alias)}" as an alias, but that is the title of ${owner.path}`,
          fix: "Remove the alias, or rename the other page. A word cannot be both this page's synonym and that page's name.",
        });
        continue;
      }

      canonical.set(key, { slug: page.slug, title, path: page.path });
    }
  }
  if (canonical.size === 0) return findings;

  for (const page of pages) {
    // Code is literal, and a wikilink to an alias is a legitimate way to reach
    // the page — neither is prose using the wrong word.
    const prose = page.body
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`\n]*`/g, "")
      .replace(/\[\[[^\]]*\]\]/g, "");

    for (const [alias, owner] of canonical) {
      if (owner.path === page.path) continue; // its own definition
      const pattern = new RegExp(`(?<![\\w-])${escapeForRegExp(alias)}(?![\\w-])`, "i");
      if (!pattern.test(prose)) continue;
      findings.push({
        code: "glossary.synonym",
        severity: "warning",
        page: page.path,
        message: `${page.path} says "${safe(alias)}", where this project's term is "${safe(owner.title)}"`,
        fix: `Use "${safe(owner.title)}", or link it as [[${owner.slug}]]. One name per concept is what keeps three names from appearing within a week.`,
        line: lineInPage(page, alias),
      });
    }
  }
  return findings;
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// `[path/to/file.ts:12-40]()` — the codewiki citation form the skill scaffolds.
//
// `/` is excluded from the segment class deliberately. With it in, `[^\]\s:]+`
// and the loop body `\/[^\]\s:]+` overlap, so the pattern is effectively
// `(.+(\/.+)*)`: every way of partitioning a slash-separated run is a distinct
// backtracking path, and when the required `:` never arrives the engine walks
// all 2^(n-1) of them. Measured on this build, `[` + `/a`.repeat(26) + `]`
// took 1.6 seconds; thirty-odd segments took minutes. That is roughly eighty
// bytes of page body — which an agent writes, possibly steered by a poisoned
// source in `raw/` — wedging `ow check`, CI and the UI in a synchronous CPU
// spin no try/catch can interrupt. Excluding `/` removes the ambiguity and
// makes the match linear, while still matching every citation the skill emits.
const CODEWIKI_CITATION = /\[([^\]\s:/]+(?:\/[^\]\s:/]+)*):(\d+)(?:-(\d+))?\]\(\)/g;

/** No real path is longer than this; a "target" that is has to be something else. */
const MAX_CITATION_TARGET = 512;

/**
 * The largest cited file this will read to count its lines. Reading a file
 * whole to learn how many lines it has costs about seven times its size in
 * heap; a few hundred megabytes of it takes the process out. Over this, the
 * citation is left unchecked rather than checked at that price.
 */
const MAX_CITED_FILE_BYTES = 16 * 1024 * 1024;

/**
 * 7.5 — codewiki citations that no longer resolve, or that run past the end of
 * the file they point into, and sections that cite nothing at all.
 *
 * This is the part of the wiki that goes stale **loudly**: a line range is
 * checkable in a way prose is not, which is the whole reason the convention
 * asks for one.
 */
export function checkCodewiki(projectRoot: string, pages: LoadedPage[]): Finding[] {
  const findings: Finding[] = [];
  const lineCounts = new Map<string, number | null>();

  const linesIn = (target: string): number | null => {
    const cached = lineCounts.get(target);
    if (cached !== undefined) return cached;
    let count: number | null = null;
    try {
      const file = assertWithin(projectRoot, join(projectRoot, target));
      const stat = existsSync(file) ? statSync(file) : null;
      if (stat?.isFile() && stat.size <= MAX_CITED_FILE_BYTES) {
        const lines = readFileSync(file, "utf8").split(/\r?\n/);
        // A file ending in a newline splits into a trailing empty element that
        // is not a line. Counting it accepts a citation one line past the end —
        // exactly what this check exists to catch, on a file shaped the way
        // almost every text file is.
        if (lines[lines.length - 1] === "") lines.pop();
        count = lines.length;
      }
    } catch {
      count = null; // outside the project: it cites nothing this can see
    }
    lineCounts.set(target, count);
    return count;
  };

  for (const page of pages.filter((p) => p.codewiki)) {
    // Fences are examples, not citations. A codewiki page documenting the
    // citation form — which the skill's own prose does — would otherwise fail
    // `ow check` for the sample inside its fence. The section scan below
    // already ignores fences, and so does `checkVocabulary`.
    for (const match of withoutFences(page.body).matchAll(CODEWIKI_CITATION)) {
      const [whole, target, startText, endText] = match;
      const start = Number(startText);
      const end = endText === undefined ? start : Number(endText);
      // A "path" this long is not one. The regex is linear now, but a bound on
      // what reaches the filesystem costs nothing and keeps a pathological
      // target from becoming a pathological stat.
      const total = target!.length > MAX_CITATION_TARGET ? null : linesIn(target!);

      if (total === null) {
        findings.push({
          code: "codewiki.citation-unresolved",
          severity: "error",
          page: page.path,
          message: `${page.path}: ${safe(whole!)} points at ${safe(target!)}, which is not a file in this project`,
          fix: "The file moved or was deleted. Point the citation at where the code lives now, or remove the section — prose that cites nothing has drifted free of the code it describes.",
          line: lineInPage(page, whole!),
        });
        continue;
      }
      if (end > total) {
        findings.push({
          code: "codewiki.citation-past-end",
          severity: "error",
          page: page.path,
          message: `${page.path}: ${safe(whole!)} runs past the end of ${safe(target!)}, which has ${total} lines`,
          fix: "The file shrank under the citation. Re-read it and cite the lines the section is actually about.",
          line: lineInPage(page, whole!),
        });
      }
    }

    // Every section cites something. A section that cites nothing is prose that
    // has drifted free of the code it describes.
    // Lines of the body, reported as lines of the file: every other finding is
    // file-relative, and a reader following a body-relative one lands in the
    // frontmatter.
    const frontmatterLines =
      page.text.slice(0, page.text.length - page.body.length).split("\n").length - 1;
    const lines = page.body.split("\n");
    let heading: { title: string; line: number } | null = null;
    let cited = false;
    let inFence = false;

    const hasCitation = (line: string): boolean => {
      CODEWIKI_CITATION.lastIndex = 0;
      return CODEWIKI_CITATION.test(line);
    };

    const closeSection = (): void => {
      if (heading && !cited) {
        findings.push({
          code: "codewiki.section-uncited",
          severity: "warning",
          page: page.path,
          message: `${page.path}: the section "${safe(heading.title)}" cites no lines`,
          fix: "Add the citation the section is about, as [path/to/file.ts:12-40](). Do not narrate what a reader can see — if there is nothing to point at, the section does not belong here.",
          line: heading.line,
        });
      }
    };

    lines.forEach((line, i) => {
      if (/^\s*```/.test(line)) inFence = !inFence;
      if (inFence) return;
      const level = /^(#{1,6})\s+\S/.exec(line);
      if (level) {
        closeSection();
        // A single `#` is the page's title, not a section of it — the skill's
        // example shows `##` sections under one. Treating the title as a
        // section fired on every conventionally written page.
        if (level[1]!.length === 1) {
          heading = null;
          return;
        }
        heading = {
          title: line.replace(/^#+\s+/, "").trim(),
          line: frontmatterLines + i + 1,
        };
        // A citation written on the heading line itself counts. Returning
        // before looking produced "the section [code.ts:1-2]() cites no lines",
        // quoting the citation it had just refused to see.
        cited = hasCitation(line);
        return;
      }
      if (hasCitation(line)) cited = true;
    });
    closeSection();
  }

  // A `codewiki/` at the project root looks right and is not: codewiki lives
  // under `wiki/`, and nothing outside `wiki/` is part of the wiki at all.
  const stray = join(projectRoot, CODEWIKI_DIR);
  if (existsSync(stray) && statSync(stray).isDirectory()) {
    // Recursive, like the model three functions above: a stray
    // `codewiki/area/x.md` is exactly as misplaced as `codewiki/x.md`.
    // `recursive: true` follows symlinked directories, which would walk out of
    // the project. Same rule as `listPages`: links are skipped, not followed.
    const strayPages: string[] = [];
    const walkStray = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) walkStray(join(dir, entry.name));
        else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
          strayPages.push(entry.name);
        }
      }
    };
    walkStray(stray);
    if (strayPages.length > 0) {
      findings.push({
        code: "codewiki.misplaced",
        severity: "error",
        message: `${CODEWIKI_DIR}/ at the project root holds ${strayPages.length} page(s), but codewiki lives at wiki/${CODEWIKI_DIR}/`,
        fix: `Move them to wiki/${CODEWIKI_DIR}/. Outside wiki/ they are not part of the wiki: nothing indexes them, nothing links them, and no write to them is validated.`,
      });
    }
  }

  return findings;
}

/** The page schema, re-checked outside the gate — group 5's rules, after the fact. */
export function checkSchema(pages: LoadedPage[]): Finding[] {
  const findings: Finding[] = [];
  for (const page of pages) {
    const result = validatePage(page.text, page.slug);
    if (result.ok) continue;
    for (const issue of result.errors) {
      findings.push({
        code: "page.invalid",
        severity: "error",
        page: page.path,
        message: `${page.path}: ${safe(issue.field ? `${issue.field}: ${issue.reason}` : issue.reason)}`,
        fix: "Correct the frontmatter. `ow write` applies the same rules, and the gate would have refused this write — it arrived some other way.",
      });
    }
  }
  return findings;
}

export interface CheckReport {
  findings: Finding[];
  /** How many pages and sources were looked at, so an empty report means something. */
  pages: number;
  sources: number;
}

/** Read every page once. Exported so a caller running several things over the
 * wiki — the checks, the source states, a UI refresh — pays for one walk. */
export function readWiki(projectRoot: string): LoadedPage[] {
  return loadPages(projectRoot);
}

/**
 * Run every check over a project. One read of the wiki feeds all of them, so
 * this is a single pass over the pages rather than one per check.
 */
export function checkProject(projectRoot: string): CheckReport {
  const pages = loadPages(projectRoot);
  const cited = citedSourceIds(pages);

  const findings = [
    ...checkSchema(pages),
    ...checkLinks(projectRoot, pages),
    ...checkRecords(projectRoot, pages, cited),
    ...checkProvenance(projectRoot, pages),
    ...checkVocabulary(pages),
    ...checkCodewiki(projectRoot, pages),
  ];

  return {
    findings: sortFindings(findings),
    pages: pages.length,
    sources: listSources(projectRoot).length,
  };
}
