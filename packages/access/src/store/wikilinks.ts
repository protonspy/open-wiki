import { listEntityPages } from "./index.js";
import { NON_ENTITY_PAGES } from "./page.js";
import type { PageIssue } from "./page.js";

/**
 * Refuse a write whose wikilink does not resolve to an existing page, saying
 * which link broke (plan 5.3). A wikilink is the Obsidian form `[[slug]]`, with
 * optional `|display` and `#heading`; it resolves to the page `wiki/<slug>.md`.
 *
 * The page being written counts as resolved even before it lands on disk — a
 * new page may link to itself, and the gate validates the content before the
 * write. Embeds (`![[...]]`) and code are not wikilinks: an embed is a
 * transclusion (a separate concern) and a bracketed string inside code is
 * literal.
 */

// `[[target]]` or `[[target|display]]` or `[[target#heading]]`, not preceded by
// `!` (which would make it an embed).
const WIKILINK = /(?<!!)\[\[([^\]]+)\]\]/g;

/** Strip fenced and inline code so link-shaped strings in code stay literal. */
function withoutCode(body: string): string {
  return body.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

/** The page target of a wikilink body: before `|` (display) and `#` (heading). */
function targetOf(inner: string): string {
  return inner.split("|")[0]!.split("#")[0]!.trim();
}

/**
 * Scan `body` for wikilinks and return one issue per link that does not resolve
 * to a page under `wiki/` (or to the page being written, `currentSlug`). Empty
 * means every link resolves.
 *
 * A link names a **slug**, and the page carrying that slug may sit anywhere
 * under `wiki/` — `wiki/checkout.md` or `wiki/topics/checkout.md` are the same
 * page as far as `[[checkout]]` is concerned. Checking for `wiki/<target>.md`
 * directly, as this did, made every link to a page filed under a type
 * subdirectory read as broken. See `store/index.ts` for why the model is this.
 */
export function resolveWikilinks(
  projectRoot: string,
  body: string,
  currentSlug: string,
  known?: ReadonlySet<string>,
): PageIssue[] {
  const targets = collectTargets(body, currentSlug);
  if (targets.length === 0) return [];

  // One directory walk for the whole page rather than one `existsSync` per
  // link. This runs on the gate's hot path, once per write — and a caller with
  // many pages to check (`ow check`) passes the set in, so the walk happens
  // once for the run rather than once per page.
  const resolvable = known ?? linkableSlugs(projectRoot);
  return targets
    .filter((target) => !resolvable.has(target))
    .map((target) => ({
      field: "wikilink",
      target,
      reason: `[[${target}]] does not resolve to a page (no page with the slug "${target}" under wiki/)`,
    }));
}

/**
 * Every slug a `[[link]]` may name: the entity pages, plus `index`,
 * `changelog` and `log`.
 *
 * Those three are not entity pages — they carry no frontmatter and are not
 * validated against the schema — but they are files that exist in every
 * scaffolded project, and the skill tells the agent to record things in the
 * changelog and to link from the index. Leaving them out of the link set denied
 * any page mentioning `[[changelog]]`, with a reason that reads as a bug: "no
 * page with the slug changelog under wiki/", when there is a file called
 * exactly that.
 */
export function linkableSlugs(projectRoot: string): Set<string> {
  const slugs = new Set(listEntityPages(projectRoot));
  for (const name of NON_ENTITY_PAGES) slugs.add(name.replace(/\.md$/, ""));
  return slugs;
}

/** The distinct link targets in a body, minus the page's own slug. */
function collectTargets(body: string, currentSlug: string): string[] {
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const match of withoutCode(body).matchAll(WIKILINK)) {
    const target = targetOf(match[1] ?? "");
    if (target === "") continue;
    if (target === currentSlug) continue;
    if (seen.has(target)) continue; // report each broken link once
    seen.add(target);
    targets.push(target);
  }
  return targets;
}
