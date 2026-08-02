import { FileText } from "lucide-react";
import { Fragment } from "react";
import type { IndexedPage } from "../main/api.js";
import { ICON_SM } from "./ui/icons.js";

/**
 * The wiki's pages, arranged (spec `wiki-pane`, R1).
 *
 * **A band is a heading, never an address.** The tree groups by the folder a
 * page sits in because that is how the draft draws it and how a wiki with
 * thirty pages stays readable — but `adr:0016-a-page-is-its-slug-wherever-it-sits`
 * says a folder is organisation and a link is a name, so opening a page hands
 * on its slug and nothing else. The path appears only as the entry's tooltip
 * and as React's key.
 *
 * The arranging is exported beside the component, the way the primitives export
 * their class helpers: which band a page lands in and what order they are read
 * in are decisions, and a decision inside a component is one no test can reach.
 */

export interface TreeBand {
  /**
   * The folder these pages sit in, or null for the ones directly under `wiki/`,
   * which are listed with no header at all (R1.2).
   */
  group: string | null;
  pages: IndexedPage[];
}

/**
 * The index as bands, in the order they are read.
 *
 * **The ungrouped pages come first.** They sit at the top of `wiki/`, which is
 * where the scaffolded skill tells the agent to write, so on most projects this
 * is the whole tree — and a band with no header pushed below three named ones
 * would read as a footnote to them rather than as the wiki itself.
 *
 * Bands and the pages inside them are ordered by name, case-insensitively.
 * Filesystem order is `readdir` order, which is neither stable across platforms
 * nor meaningful to a reader.
 */
export function groupPages(pages: readonly IndexedPage[]): TreeBand[] {
  const bands = new Map<string | null, IndexedPage[]>();
  for (const page of pages) {
    const band = bands.get(page.group);
    if (band) band.push(page);
    else bands.set(page.group, [page]);
  }

  return [...bands.entries()]
    .sort(([a], [b]) => {
      // The unnamed band first; the named ones alphabetically after it.
      if (a === null) return b === null ? 0 : -1;
      if (b === null) return 1;
      return compareNames(a, b);
    })
    .map(([group, inBand]) => ({
      group,
      pages: [...inBand].sort((a, b) => compareNames(a.title, b.title)),
    }));
}

/**
 * The React key for a tree entry.
 *
 * **The path, not the slug.** Two pages may share a slug — that is a finding
 * (`page.duplicate-slug`) and the tree shows both rather than hiding one
 * (R1.6) — and keying by slug would make React treat the second as a re-render
 * of the first, which is exactly the disappearance the requirement exists to
 * prevent.
 */
export function keyOfPage(page: IndexedPage): string {
  return page.path;
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}
export interface TreeProps {
  pages: readonly IndexedPage[];
  /** The slug the reader is showing, if any. */
  current?: string;
  onOpen: (slug: string) => void;
}

export function Tree({ pages, current, onOpen }: TreeProps): React.JSX.Element {
  return (
    <nav className="tree" aria-label="Pages">
      {groupPages(pages).map((band) => (
        // The unnamed band still needs a key, and `""` cannot collide with a
        // folder name because a path segment is never empty.
        <Fragment key={band.group ?? ""}>
          {band.group ? <div className="tree-group">{band.group}</div> : null}
          {band.pages.map((page) => (
            <button
              key={keyOfPage(page)}
              type="button"
              className="tree-item"
              aria-current={page.slug === current}
              // Where it actually sits, for the reader who wonders — which is
              // also how two pages sharing a slug (R1.6) tell themselves apart.
              title={page.path}
              onClick={() => onOpen(page.slug)}
            >
              <FileText size={ICON_SM} aria-hidden />
              <span className="tree-item__name">{page.title}</span>
            </button>
          ))}
        </Fragment>
      ))}
    </nav>
  );
}
