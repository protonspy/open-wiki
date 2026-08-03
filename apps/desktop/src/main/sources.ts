import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  checkProject,
  citedSourcePages,
  extractProvenanceLinks,
  listSourceStates,
  readWiki,
  resolvedSourceDir,
  sourceExists,
  CONTENTS,
  UNPACKING,
  sourceState,
  type Finding,
  type SourceState,
} from "@open-wiki/access/read";
import { isWithin, resolveReal } from "@open-wiki/access/read";
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
   * Present when this source has been replaced (plan 7.6), with what replaced
   * it and when.
   *
   * **A citation into replaced evidence resolving silently is the outcome
   * supersession exists to prevent**, so it has to be said *here* — on the
   * page's own list of what it rests on — and not only on the sources screen
   * somebody may never open. It is the same thing 8.5 records and 5.2 already
   * does for a page.
   */
  superseded?: { by: string; date?: string };
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
      ...(state.superseded ? { superseded: state.superseded } : {}),
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
 * A directory to walk, or `null` when it is not really inside `within`.
 *
 * Resolves the real path before comparing, so a symlink or a Windows junction
 * standing where a directory should be is refused rather than followed. `at`
 * may equal `within`, which `isWithin` deliberately does not allow — a source's
 * own directory is a legitimate root, and only what it *resolves to* matters.
 */
function safeRoot(within: string, at: string): string | null {
  if (!existsSync(at)) return null;
  const real = resolveReal(at);
  if (real !== resolveReal(within) && !isWithin(within, at)) return null;
  return real;
}

/**
 * The file of a source, confined, for the one caller that hands a path to the
 * operating system (plan 7.4).
 *
 * **Reveal, not open.** `shell.showItemInFolder` selects the file in the
 * system file manager; `shell.openPath` would invoke whatever handler is
 * registered for its extension, on bytes that arrived in an untrusted
 * `git clone`. This repository already treats that distinction as load-bearing
 * — `isOpenableExternally` exists because `shell.openExternal` is
 * `ShellExecute` on Windows, and `ms-msdt:` is a documented path from "a link
 * in a document" to code execution. A `.lnk`, a `.scr` or a double extension
 * under `raw/` is the same shape of problem.
 *
 * The plan asks for the file to be "named and offered to the system handler".
 * Revealing it is that offer: the file manager is the system handler for
 * *choosing what to do with a file*, and opening it is one further click, taken
 * by the person, where their own operating system's warnings apply.
 */
export function revealPath(projectRoot: string, id: string): string {
  const dir = resolvedSourceDir(projectRoot, id);
  const original = originalIn(dir, id);
  if (!original) throw new Error(`"${id}" has no file to show`);
  return original;
}

/** One entry in a source's own directory, as the browser shows it (plan 7.5). */
export interface SourceEntry {
  /** Path relative to what is being browsed, with `/` separators. */
  path: string;
  /** A directory, or a file with its size. */
  kind: "file" | "dir";
  bytes?: number;
}

/** What browsing into a source answers (plan 7.5). */
export interface SourceBrowse {
  id: string;
  entries: SourceEntry[];
  /** True when this source holds an unpacked archive, so `entries` is its tree. */
  tree: boolean;
  /**
   * True when an unpack started and never finished (6.6). The tree below is
   * then part of an archive rather than all of one, and saying so is the whole
   * reason the marker exists.
   */
  incomplete: boolean;
  /** Entries past the cap, when the tree is larger than one screen can be. */
  truncated: number;
}

/**
 * How many entries a browse returns.
 *
 * An unpacked repository is thousands of files and this crosses an IPC channel
 * into a renderer that will lay every one of them out. The cap is a rendering
 * decision, like `boundedText`: it destroys nothing, and `truncated` says how
 * much was not shown rather than letting the list quietly end.
 */
export const MAX_BROWSE_ENTRIES = 2000;

/**
 * Browse into a source — the files it holds, and an unpacked archive as a tree
 * (plan 7.5).
 *
 * **Reading a source is the agent's job; *seeing what arrived* is not.** This
 * is how somebody knows the upload was what they meant — that the zip they
 * dropped really was the repository and not last month's one, that the PDF is
 * there beside its `text.md`. It returns names and sizes and opens nothing.
 *
 * Where the source holds an unpacked tree, that tree is what is browsed rather
 * than the two files beside it: `source.zip` and `contents/` is a listing
 * nobody came to see.
 */
export function browseSource(projectRoot: string, id: string): SourceBrowse {
  // Confined and found, never joined — a source filed into a folder is not at
  // the path its id spells (task 8.3), and an id reaches here out of a page's
  // prose.
  const dir = resolvedSourceDir(projectRoot, id);
  if (!existsSync(join(dir, "manifest.json"))) {
    throw new Error(`there is no source named "${id}"`);
  }
  // **The root is confined too, not only what the walk finds inside it.**
  // `walk` skips a symlinked *entry*, which a review showed is the easier half:
  // `contents` can itself be a junction, and a junction needs no privilege on
  // Windows and is not a symlink — so walking it listed an arbitrary directory
  // and handed the names and sizes to the renderer. `export/zip.ts` had to add
  // the identical "the tree root is checked too" fix after the same finding.
  const contents = safeRoot(dir, join(dir, CONTENTS));
  const tree = contents !== null;
  const root = contents ?? safeRoot(dir, dir);
  if (root === null) throw new Error(`"${id}" does not resolve to a directory inside raw/`);

  const entries: SourceEntry[] = [];
  let seen = 0;
  const walk = (at: string, prefix: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      // Links are not followed, for the reason `listSourceRefs` does not follow
      // them: one pointing out of `raw/` would list somebody else's disk as
      // this source's contents.
      if (entry.isSymbolicLink()) continue;
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      seen += 1;
      // **Counting does not stop at the cap; only pushing does.** Skipping an
      // over-cap directory outright meant none of its descendants were ever
      // counted, so `truncated` said 1 where the answer was 501 — a number
      // whose only job is to be right about what was not shown.
      if (seen <= MAX_BROWSE_ENTRIES) {
        if (entry.isDirectory()) entries.push({ path: rel, kind: "dir" });
        else {
          const stat = statSync(join(at, entry.name), { throwIfNoEntry: false });
          entries.push({ path: rel, kind: "file", bytes: stat?.size ?? 0 });
        }
      }
      if (entry.isDirectory()) walk(join(at, entry.name), rel);
    }
  };
  walk(root, "");

  return {
    id,
    entries,
    tree,
    incomplete: existsSync(join(dir, UNPACKING)),
    truncated: Math.max(0, seen - MAX_BROWSE_ENTRIES),
  };
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
  /**
   * An image, opened as an image (plan 7.4).
   *
   * Its own kind because the renderer's CSP is `default-src 'none'` with
   * `img-src 'self' data:` — a viewer can show these bytes and cannot show a
   * PDF's. Collapsing the two would put that constraint in the renderer's way
   * at the moment it is least able to answer it.
   *
   * **The bytes travel as a `data:` URL, because `img-src` has no `file:` in
   * it.** `media-src` does, which is how the audio player loads an Opus off
   * disk; `img-src` deliberately does not, and widening it to show a picture
   * would be answering a constraint the plan calls "a real constraint and not a
   * formality" by removing it. An image past `MAX_INLINE_IMAGE_BYTES` degrades
   * to `external` instead — offered to the system handler, which is the same
   * answer any other unshowable file gets.
   */
  | { kind: "image"; file: string; mime: string; dataUrl: string }
  /**
   * An unpacked archive, opened as the listing it is (plan 7.4, 7.5). There is
   * no single file to show, so the answer is where the tree starts — and
   * whether it is all of one, which 6.6's marker is the only thing that knows.
   */
  | { kind: "tree"; dir: string; incomplete: boolean }
  /**
   * Anything else: named, and offered to whatever the system opens it with.
   * `adr:0021` means a source can be any file at all, so this branch is what
   * keeps "any file" true rather than a list somebody maintains.
   */
  | { kind: "external"; file: string }
  | { kind: "missing"; reason: string };

/**
 * The image types the renderer may actually render, with their MIME types.
 *
 * A list, and it has to be one: the CSP allows `img-src 'self' data:`, so these
 * bytes can reach an `<img>` — anything absent goes to the system handler
 * instead, which is honest rather than a broken image element.
 *
 * **`.svg` is deliberately not here.** It is a document that can carry script,
 * and it arrives from a source nobody parsed; it goes to the system handler
 * like any other file rather than into a renderer that trusts `img-src`.
 */
const IMAGE_TYPES: ReadonlyMap<string, string> = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".bmp", "image/bmp"],
  [".avif", "image/avif"],
]);

/** Documents the viewer opens at a page rather than handing to the system. */
const DOCUMENT_TYPES: ReadonlySet<string> = new Set([".pdf"]);

/**
 * The largest image the viewer inlines as a `data:` URL.
 *
 * A rendering bound, like `boundedText`: the bytes cross an IPC channel and sit
 * in the renderer's memory base64-encoded, a third larger than on disk. Past
 * this the image is offered to the system handler instead — which shows it
 * better than a panel would anyway.
 */
export const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * An image small enough to show, as the CSP's `data:` allows — or `null`,
 * which sends it to the system handler like any other file the panel cannot
 * render.
 */
function inlineImage(file: string, mime: string): SourceLocation | null {
  const stat = statSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size > MAX_INLINE_IMAGE_BYTES) return null;
  const dataUrl = `data:${mime};base64,${readFileSync(file).toString("base64")}`;
  return { kind: "image", file, mime, dataUrl };
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

export function locateCitation(projectRoot: string, id: string, fragment: string): SourceLocation {
  let dir: string;
  try {
    // Found, not joined (task 8.3). Joining meant a citation into a *filed*
    // source passed `ow check` — which resolves through the walk — and then
    // opened as "there is no source named …" the moment somebody clicked it.
    // A source that is there, reported absent, is the confidently-wrong answer
    // `adr:0016` already had to fix once for pages.
    dir = resolvedSourceDir(projectRoot, id);
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

  // An unpacked archive answers with its tree, before the "no file" branch:
  // there *is* a file — the archive — and opening a zip in a viewer shows
  // nobody anything. The tree is what somebody came to look at (plan 7.4).
  // Confined the same way the browser confines it: `contents` can itself be a
  // junction, and opening one would point the viewer at an arbitrary directory.
  const contents = safeRoot(dir, join(dir, CONTENTS));
  if (contents !== null) {
    return { kind: "tree", dir: contents, incomplete: existsSync(join(dir, UNPACKING)) };
  }

  if (!original) return { kind: "missing", reason: `"${id}" has no file to open` };

  // **What it is decides how it opens** (plan 7.4). An image goes to an `<img>`
  // the CSP will actually load; a PDF opens at the page the citation named;
  // anything else is named and handed to the system, which is what keeps
  // `adr:0021`'s "any file" from quietly meaning "any file we listed".
  const ext = extensionOf(original);
  const mime = IMAGE_TYPES.get(ext);
  if (mime !== undefined) {
    const inline = inlineImage(original, mime);
    if (inline !== null) return inline;
  }
  if (!DOCUMENT_TYPES.has(ext)) return { kind: "external", file: original };
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
