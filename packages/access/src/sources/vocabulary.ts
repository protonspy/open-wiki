import { readWiki } from "../check/checks.js";

/**
 * The transcription vocabulary, seeded from the project's own pages (plan 4.10).
 *
 * **It is what stops the project's own name from coming out wrong.** A speech
 * model has never heard "Fenix" and will write "Phoenix", every time, on every
 * chunk — and the wiki that gets built from that transcript cites a project
 * that does not exist. The names are already in the wiki: they are its page
 * titles and the aliases each page lists.
 *
 * This reads pages and nothing else, so it lives here rather than in
 * `@open-wiki/audio` — which would otherwise have to depend on this package to
 * get at them, and this package already depends on that one for the time map.
 */

/**
 * Whisper's prompt window holds only its last 224 tokens, so an unbounded list
 * from a large wiki cannot all fit. This bounds how many names are *offered*;
 * `vocabularyPrompt` in `@open-wiki/audio` bounds what is actually sent, in
 * characters, and emits them so the best are the ones nearest the end — which
 * is the end the window keeps.
 */
export const DEFAULT_VOCABULARY_LIMIT = 120;

/**
 * No name is this long, and one that is came from a page in a project that
 * arrived by clone. `vocabularyPrompt` clips to the same figure on its side;
 * the number is repeated rather than imported because reaching into
 * `@open-wiki/audio` for it would put a package that spawns subprocesses on
 * this module's import graph.
 */
export const MAX_NAME_CHARS = 64;

/** Words a model already knows, and which crowd out the ones it does not. */
const COMMON = new Set([
  "index",
  "changelog",
  "log",
  "readme",
  "notes",
  "meeting",
  "project",
  "overview",
]);

/**
 * The names in a project's wiki, best first.
 *
 * "Best" is rarity: a title that is one unusual word is exactly what a model
 * gets wrong, and a title that is a sentence is not a name at all. So single
 * tokens that are not ordinary words come first, then the rest, and anything
 * that reads as prose is dropped.
 */
export function projectVocabulary(projectRoot: string, limit = DEFAULT_VOCABULARY_LIMIT): string[] {
  const names: string[] = [];
  for (const page of readWiki(projectRoot)) {
    const front = page.frontmatter;
    if (!front) continue;
    if (typeof front["title"] === "string") names.push(front["title"]);
    const aliases = front["aliases"];
    if (Array.isArray(aliases)) {
      for (const alias of aliases) if (typeof alias === "string") names.push(alias);
    }
  }
  return rankNames(names, limit);
}

/** Deduplicate, drop what is not a name, and put the rare words first. */
export function rankNames(names: readonly string[], limit = DEFAULT_VOCABULARY_LIMIT): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, " ");
    if (!name) continue;
    // Four words or more is a page title describing something, not a name a
    // model needs help spelling — and it costs as much prompt as four names.
    if (name.split(" ").length > 3) continue;
    // A name longer than this is not a name. It came from a page in a project
    // that arrived by clone, and it would otherwise become a megabyte of form
    // field on the upload and a megabyte of argv on the local provider.
    if (name.length > MAX_NAME_CHARS) continue;
    if (COMMON.has(name.toLowerCase())) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(name);
  }
  kept.sort((a, b) => wordCount(a) - wordCount(b) || a.localeCompare(b));
  return kept.slice(0, limit);
}

function wordCount(name: string): number {
  return name.split(" ").length;
}
