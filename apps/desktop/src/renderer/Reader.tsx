import { useCallback, useMemo } from "react";
import type { PageView } from "../main/api.js";
import { titleOfPage } from "../shared/pages.js";
import { activatesLink } from "./keyboard.js";
import { opensWithHeading, PAGE_ATTR, renderPageBody, SOURCE_ATTR } from "./markdown.js";
import { linkTarget, type LinkTarget } from "./navigation.js";

/**
 * The page, on paper (spec `wiki-pane`, R2).
 *
 * **The reader is the one warm surface in the window.** Everything around it is
 * a cold instrument; what it holds is the content. That is the draft's whole
 * argument for the palette and the reason this component owns no chrome — the
 * buttons that act on a page live in the pane-bar, not on the page.
 *
 * Rendering is `renderPageBody` unchanged: `html: false` plus two token rules,
 * so what reaches `dangerouslySetInnerHTML` is a closed set of tags this
 * renderer produced. A broken wikilink arrives from there already marked
 * (R2.5) — the reader does not decide what is broken, it shows what the
 * renderer knew.
 */

/**
 * What the reader column is showing, when it is not showing a page (R4).
 *
 * **Every one of these used to render nothing**, which reads as "there is
 * nothing here" — the same sentence an empty wiki, a page still loading and a
 * page that failed to load would all have said, differently meant each time.
 * The state is decided here rather than in the JSX so the four cases can be
 * told apart by a test rather than by looking at a screenshot.
 */
export type ReaderState =
  "loading-wiki" | "empty-wiki" | "no-selection" | "loading" | "failed" | "page";

export function readerState(where: {
  /**
   * How many pages the wiki has, or **null while nobody knows yet**.
   *
   * The distinction is the whole of R4.2 at the wiki's own scale: the window
   * opens with an empty index and fills it a moment later, so treating "no
   * pages" and "not asked yet" as one state greets every launch of a real
   * project with *this wiki is empty, and this window is not what fills it*.
   */
  pageCount: number | null;
  /** What the location selects, whether or not it has loaded. */
  selection?: string;
  /** Whether the selected page is in hand. */
  loaded: boolean;
  /** Whether reading it failed — the message is the notice's to carry. */
  failed: boolean;
}): ReaderState {
  if (where.pageCount === null) return "loading-wiki";
  // An empty wiki next: with no pages there is nothing a selection could mean,
  // and the sentence about whose job it is to write them outranks "opening…"
  // for a page that cannot be there.
  if (where.pageCount === 0) return "empty-wiki";
  if (!where.selection) return "no-selection";
  if (where.loaded) return "page";
  return where.failed ? "failed" : "loading";
}

export interface Chip {
  key: string;
  value: string;
}

/**
 * The frontmatter as the chips over the page (R2.2).
 *
 * **An array shows its count**, the way the draft's `sources 3` chip does: the
 * question a reader has at a glance is *how many* — the citations themselves
 * are in the prose and in the side column, spelled out and clickable, where a
 * chip listing four `src://` strings would be neither.
 *
 * An entry with nothing to show is dropped. Every page carries
 * `superseded-by: ""` because the schema asks for the field, and a chip reading
 * `superseded-by` with a blank after it says a page was replaced by nothing —
 * which is not what an empty field means. A nested mapping is dropped too: the
 * schema (5.1) has no such field, `ow check` reports it, and `[object Object]`
 * on the page would be this window inventing a rendering for something invalid.
 */
export function chipsOf(frontmatter: Record<string, unknown> | null): Chip[] {
  if (!frontmatter) return [];
  const chips: Chip[] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      if (value.length > 0) chips.push({ key, value: String(value.length) });
      continue;
    }
    if (value === null || value === undefined || typeof value === "object") continue;
    const text = String(value).trim();
    if (text !== "") chips.push({ key, value: text });
  }
  return chips;
}

export interface ReaderProps {
  page: PageView;
  /** Every slug in the wiki, so a dead wikilink can look dead. */
  slugs: readonly string[];
  /** What was clicked in the prose: a page, a source, or somebody's URL. */
  onLink: (target: LinkTarget) => void;
}

export function Reader({ page, slugs, onLink }: ReaderProps): React.JSX.Element {
  const html = useMemo(() => renderPageBody(page.body, { slugs }), [page.body, slugs]);
  const chips = useMemo(() => chipsOf(page.frontmatter), [page.frontmatter]);
  const ownHeading = useMemo(() => opensWithHeading(page.body), [page.body]);

  // One handler for the whole rendered page. `onAuxClick` as well, because
  // Chromium dispatches the middle button as `auxclick` — and a middle click
  // on a link is what asks Electron to open a new window.
  const onClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (event.target as HTMLElement).closest("a, span[title]");
      if (!anchor) return;
      const target = linkTarget(anchor);
      // Only what the application handles is cancelled. An external link is
      // left to the main process, which allowlists the scheme and hands it to
      // the system browser.
      if (target.kind !== "external") event.preventDefault();
      onLink(target);
    },
    [onLink],
  );

  /**
   * The same links, from the keyboard (uxpass 3.1).
   *
   * Delegated on the same element for the same reason: the prose is
   * `dangerouslySetInnerHTML`, so there is no React node per link to bind to.
   * Only what the renderer's own rules marked is followed — a broken wikilink
   * carries neither attribute and is deliberately not a tab stop, and an
   * external link is the platform's Enter to handle.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!activatesLink(event)) return;
      const anchor = (event.target as HTMLElement).closest(`[${PAGE_ATTR}], [${SOURCE_ATTR}]`);
      if (!anchor) return;
      event.preventDefault();
      onLink(linkTarget(anchor));
    },
    [onLink],
  );

  return (
    <article className="page">
      {page.frontmatterBroken ? (
        <p className="error">This page&rsquo;s frontmatter will not parse.</p>
      ) : null}

      {chips.length > 0 ? (
        <div className="reader-frontmatter">
          {chips.map((chip) => (
            <span key={chip.key} className="fm-chip">
              {chip.key} <b>{chip.value}</b>
            </span>
          ))}
        </div>
      ) : null}

      {/* The title the page declares, or its slug — the same answer the tree
          gives, from the same function, so a page is not called two things in
          one window.

          Drawn only when the body has no heading of its own (uxpass 5.1). Every
          page used to render its title twice: this `<h1>`, and then the body's
          own `# Heading` immediately after it — two `<h1>` in one `<article>`,
          confirmed on every page. The body wins where it has an opinion,
          because the alternative is discarding a line somebody wrote. */}
      {ownHeading ? null : <h1>{titleOfPage(page.frontmatter, page.slug)}</h1>}

      <div
        onClick={onClick}
        onAuxClick={onClick}
        onKeyDown={onKeyDown}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  );
}
