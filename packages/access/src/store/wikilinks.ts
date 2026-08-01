import { existsSync } from "node:fs";
import { join } from "node:path";
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
 * to a page in `wiki/` (or to the page being written, `currentSlug`). Empty
 * means every link resolves.
 */
export function resolveWikilinks(
  projectRoot: string,
  body: string,
  currentSlug: string,
): PageIssue[] {
  const issues: PageIssue[] = [];
  const seen = new Set<string>();
  for (const match of withoutCode(body).matchAll(WIKILINK)) {
    const target = targetOf(match[1] ?? "");
    if (target === "") continue;
    if (target === currentSlug) continue;
    if (seen.has(target)) continue; // report each broken link once
    seen.add(target);
    if (!existsSync(join(projectRoot, "wiki", `${target}.md`))) {
      issues.push({
        field: "wikilink",
        reason: `[[${target}]] does not resolve to a page (no wiki/${target}.md)`,
      });
    }
  }
  return issues;
}
