/**
 * Where the reader is, and how they get back (plan 8.5).
 *
 * A wiki is read by following links and returning, so "go back" is not a
 * convenience — it is half of how the content is used. Kept as a stack of
 * visited slugs with a cursor rather than a list of "previous": following a
 * link after going back has to discard the forward history, exactly as a
 * browser does, or Back stops meaning "where I came from".
 */

export interface Location {
  /** `wiki` browses a page; the other screens have no page. */
  view: "wiki" | "sources" | "settings";
  slug?: string;
}

export class History {
  private readonly entries: Location[] = [];
  private cursor = -1;

  get current(): Location | null {
    return this.entries[this.cursor] ?? null;
  }

  get canGoBack(): boolean {
    return this.cursor > 0;
  }

  get canGoForward(): boolean {
    return this.cursor < this.entries.length - 1;
  }

  /** The trail behind the cursor, oldest first — what a breadcrumb renders. */
  get trail(): Location[] {
    return this.entries.slice(0, this.cursor + 1);
  }

  /**
   * Go somewhere new. Visiting the place you are already at is not a new
   * entry: a reader clicking the link they are on twice should not have to
   * press Back twice.
   */
  visit(location: Location): Location {
    const current = this.current;
    if (current && same(current, location)) return current;
    // Everything ahead of the cursor is a future that no longer happened.
    this.entries.length = this.cursor + 1;
    this.entries.push(location);
    this.cursor = this.entries.length - 1;
    return location;
  }

  back(): Location | null {
    if (!this.canGoBack) return this.current;
    this.cursor -= 1;
    return this.current;
  }

  forward(): Location | null {
    if (!this.canGoForward) return this.current;
    this.cursor += 1;
    return this.current;
  }
}

function same(a: Location, b: Location): boolean {
  return a.view === b.view && a.slug === b.slug;
}

/**
 * What an anchor in a rendered page means.
 *
 * `page:` and `source:` are minted by `markdown.ts` and nothing else, so
 * anything that is not one of them is a link the wiki's author wrote — an
 * external URL — and the application must not follow it in-window.
 */
export type LinkTarget =
  | { kind: "page"; slug: string }
  | { kind: "source"; id: string; fragment: string }
  | { kind: "external"; href: string };

export function parseLink(href: string): LinkTarget {
  if (href.startsWith("page:")) {
    return { kind: "page", slug: decodeURIComponent(href.slice("page:".length)) };
  }
  if (href.startsWith("source:")) {
    const rest = href.slice("source:".length);
    const hash = rest.indexOf("#");
    return {
      kind: "source",
      id: decodeURIComponent(hash < 0 ? rest : rest.slice(0, hash)),
      fragment: hash < 0 ? "" : decodeURIComponent(rest.slice(hash + 1)),
    };
  }
  return { kind: "external", href };
}
