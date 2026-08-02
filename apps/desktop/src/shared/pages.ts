/**
 * What the tree needs to know about a page that its path and its frontmatter
 * already say (spec `wiki-pane`, R1.1 to R1.3).
 *
 * Both are pure and both are here rather than inside `wikiIndex`, because the
 * two decisions they encode are the ones worth asserting on their own: what a
 * folder means, and what a page is called when nobody said.
 *
 * **The group is presentation and nothing else.**
 * `adr:0016-a-page-is-its-slug-wherever-it-sits` settled that a folder under
 * `wiki/` is organisation and a link is a name, so the tree may *arrange* by
 * folder and must never *address* by it. That is why this returns a label and
 * the selection in the tree still carries the slug alone — a group that reached
 * the selection would be a second addressing scheme, and the day somebody
 * refiles a page every link into it would break.
 */

/**
 * The folder a page sits in under `wiki/`, or `null` for one at the top.
 *
 * The first segment only. `wiki/topics/retention.md` groups as `topics`, and so
 * does `wiki/topics/legal/retention.md` — the draft draws one flat band of
 * groups, and a nested tree would be a second organisation scheme on top of the
 * one `adr:0016` already declined to make meaningful.
 *
 * `null` rather than an empty string or a bucket named "Pages": a page directly
 * under `wiki/` is listed without a header (R1.2), and inventing a name for the
 * absence of one puts a heading on screen that the wiki does not contain.
 */
export function groupOfPage(path: string): string | null {
  // `PageRef.path` is project-relative and already posix — `listPages` joins it
  // that way — so this splits on `/` and never on the platform separator.
  const parts = path.split("/");
  // `wiki` · … · `<file>.md`. Two parts is a page at the top of the wiki.
  if (parts.length < 3) return null;
  return parts[1] ?? null;
}

/**
 * What the page is called: its `title`, or its slug (R1.3).
 *
 * The fallback is the slug rather than a placeholder because a slug is a real
 * name — it is what `[[wikilink]]` writes and what the tree selects by — so a
 * page whose frontmatter never arrived still reads as itself. A title that is
 * present but blank falls back too: `title: ""` in the frontmatter would
 * otherwise render a tree entry with nothing to click on.
 */
export function titleOfPage(frontmatter: Record<string, unknown> | null, slug: string): string {
  const title = frontmatter?.["title"];
  if (typeof title !== "string") return slug;
  const trimmed = title.trim();
  return trimmed === "" ? slug : trimmed;
}
