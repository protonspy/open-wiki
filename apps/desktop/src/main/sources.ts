import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertWithin,
  checkProject,
  citedSourcePages,
  extractProvenanceLinks,
  listSourceStates,
  readWiki,
  sourceExists,
  sourceState,
  type Finding,
  type SourceState,
} from "@open-wiki/access/read";
import { parseInstant, toWallMs, type TimeMap } from "@open-wiki/audio/timemap";
// From `shared/`: the sources pane opens a source at its start too, and the two
// must not disagree about what "the start" is spelled as.
import { startFragment } from "../shared/sources.js";

/**
 * The sources screen and what it links to (plan 6.2, 6.4, 6.5, 6.6, 7.6, 8.6).
 *
 * All read, so it imports the read surface. The one write on this screen — a
 * source's title (6.7) — lives in `edit.ts` with the other writes.
 */

export interface SourceRow extends SourceState {
  /** Pages citing this source, as slugs (plan 6.4). */
  citedBy: string[];
  /**
   * True when nothing cites it (plan 6.6). It is the case that disappears from
   * view on its own: a source nobody used looks exactly like a source somebody
   * used, unless the screen says otherwise.
   */
  uncited: boolean;
}

/** Every source with its state and its citations, in one pass over the wiki. */
export function sourceRows(projectRoot: string): SourceRow[] {
  // One read of the wiki feeds every row. Twenty sources must not mean twenty
  // walks over the pages — the same reason `listSourceStates` takes the map.
  const citations = citedSourcePages(readWiki(projectRoot));
  return listSourceStates(projectRoot, citations).map(asRow);
}

function asRow(state: SourceState): SourceRow {
  return {
    ...state,
    citedBy: state.citedBy.map(slugOf),
    uncited: state.citedBy.length === 0,
  };
}

function slugOf(pagePath: string): string {
  return (pagePath.split("/").pop() ?? pagePath).replace(/\.md$/, "");
}

/** One source, for the panel that opens beside the list. */
export function sourceDetail(projectRoot: string, id: string): SourceRow {
  const citations = citedSourcePages(readWiki(projectRoot));
  return asRow(sourceState(projectRoot, id, citations.get(id) ?? []));
}

/**
 * One source a page cites, as the page needs it on screen (plan 6.5).
 *
 * It carries what 6.4's rows carry in the other direction — a readable title
 * and somewhere to click — rather than the bare id the citation spells. A page
 * listing `arquitetura-fenix.pdf` and a page listing "Fenix architecture, v3"
 * are the same page; only one of them is worth reading.
 */
export interface PageSource {
  /** The id as cited. */
  id: string;
  /** The source's title, or the id itself when there is nothing to read it from. */
  title: string;
  /**
   * Null when the source cannot be described. The citation is shown anyway: a
   * page pointing at a source nobody can open is exactly what 7.3 reports, and
   * hiding it here would leave the reader believing the page is sourced.
   */
  kind: SourceState["kind"] | null;
  /**
   * Why it could not be described, when `kind` is null.
   *
   * Absent and unreadable are **not the same finding and do not have the same
   * fix** — one is a citation pointing at nothing, the other a source that is
   * there with a manifest nobody can read. Saying "there is no source named x"
   * about a directory the reader can see would send them looking for the wrong
   * problem, and 7.3 would be reporting something else about the same id.
   */
  reason?: string;
  /**
   * Where clicking opens it — the start of a recording, the first page of a
   * document. The fragment goes back through `locateCitation` (8.6), so the
   * panel that opens is the same one a provenance link in the prose opens.
   */
  fragment: string;
}

/**
 * Which sources a page came from (plan 6.5) — the inverse of 6.4.
 *
 * Read from the page's prose as well as its `sources` field, because 5.5
 * mirrors the body's citations into the field and a page written before that
 * ran has them only in the body.
 */
export function sourcesOfPage(projectRoot: string, slug: string): PageSource[] {
  const page = readWiki(projectRoot).find((p) => p.slug === slug);
  if (!page) return [];
  const front = page.frontmatter?.["sources"];
  const declared = Array.isArray(front)
    ? front.filter((s): s is string => typeof s === "string")
    : [];
  const ids = new Set<string>();
  for (const link of [...declared, ...extractProvenanceLinks(page.body)]) {
    const id = link.replace(/^(src|rec):\/\//, "").split("#")[0];
    if (id) ids.add(id);
  }
  return [...ids].sort().map((id) => describeSource(projectRoot, id));
}

/**
 * A cited id, described well enough to render and to open.
 *
 * A source that is not there is described as itself rather than thrown over:
 * one broken citation on a page must not take the whole list with it, which is
 * the same reason the drop reports per file (3.5).
 */
function describeSource(projectRoot: string, id: string): PageSource {
  try {
    const state = sourceState(projectRoot, id);
    return {
      id,
      title: state.title,
      kind: state.kind,
      fragment: startFragment(state.kind),
    };
  } catch (e) {
    return {
      id,
      title: id,
      kind: null,
      fragment: "p1",
      reason: sourceExists(projectRoot, id)
        ? // It is there and could not be read — a malformed `manifest.json`,
          // a permission error. The message names which.
          `"${id}" is there but could not be read: ${e instanceof Error ? e.message : String(e)}`
        : `there is no source named "${id}"`,
    };
  }
}

/** The integrity findings, for the panel 7.6 asks for. */
export function findings(projectRoot: string): Finding[] {
  return checkProject(projectRoot).findings;
}

/**
 * Where clicking a provenance citation should take the reader (plan 8.6).
 *
 * A document opens at its page; a recording opens at its instant, in seconds
 * into the Opus, because that is what an `<audio>` element's `currentTime`
 * takes. The instant is resolved through the recording's own time map, so a
 * citation past the end of it opens nothing rather than opening at zero — the
 * same rule 5.4 applies when it refuses the citation in the first place.
 */
export type SourceLocation =
  | { kind: "document"; file: string; page: number }
  | { kind: "audio"; file: string; seconds: number; wallStartMs: number | null }
  | { kind: "missing"; reason: string };

export function locateCitation(projectRoot: string, id: string, fragment: string): SourceLocation {
  const rawDir = join(projectRoot, "raw");
  let dir: string;
  try {
    dir = assertWithin(rawDir, join(rawDir, id));
  } catch {
    return { kind: "missing", reason: `"${id}" does not name a source` };
  }
  if (!existsSync(join(dir, "manifest.json"))) {
    return { kind: "missing", reason: `there is no source named "${id}"` };
  }

  const instantNs = parseInstant(fragment);
  if (instantNs !== null) {
    const opus = join(dir, "mic.opus");
    if (!existsSync(opus)) {
      return { kind: "missing", reason: `"${id}" has no audio to open` };
    }
    const map = readTimeMap(dir);
    if (map && !inRange(map, instantNs)) {
      return { kind: "missing", reason: `${fragment} is past the end of this recording` };
    }
    return {
      kind: "audio",
      file: opus,
      seconds: instantNs / 1_000_000_000,
      wallStartMs: map ? toWallMs(map, instantNs) : null,
    };
  }

  const page = /^p(\d+)$/.exec(fragment);
  const original = originalIn(dir, id);
  if (!original) return { kind: "missing", reason: `"${id}" has no file to open` };
  return { kind: "document", file: original, page: page ? Number(page[1]) : 1 };
}

function inRange(map: TimeMap, ns: number): boolean {
  return ns >= 0 && ns <= map.compressedDurationNs;
}

function readTimeMap(dir: string): TimeMap | null {
  try {
    const file = join(dir, "timemap.json");
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8")) as TimeMap;
  } catch {
    return null;
  }
}

/**
 * The preserved original of an uploaded source.
 *
 * `register.ts` writes it as `source.<ext>`, where the extension comes from
 * the id — a file source keeps its extension in the id (`adr:0011`), so the
 * name is derived rather than read out of the manifest. That matters: the
 * manifest is a file in a project directory that arrives with a clone, and a
 * filename read out of it would be a path this function was asked to open.
 */
function originalIn(dir: string, id: string): string | null {
  const dot = id.lastIndexOf(".");
  const name = dot > 0 ? `source${id.slice(dot)}` : "source";
  const candidate = join(dir, name);
  return existsSync(candidate) ? candidate : null;
}
