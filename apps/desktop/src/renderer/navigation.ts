import { FRAGMENT_ATTR, PAGE_ATTR, SOURCE_ATTR } from "./markdown.js";

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
  view: "wiki" | "sources" | "checks" | "history" | "settings";
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
 * What an element clicked in a rendered page means.
 *
 * **Routed by attribute, never by an `href` scheme.** A scheme looks like it
 * proves the renderer minted the link and does not: markdown-it renders
 * `[x](page:evil)` into `<a href="page:evil">` quite happily, so a page author
 * can mint any scheme they like. `data-ow-page` is an attribute only
 * `markdown.ts`'s rules emit, and `html: false` means a page cannot write an
 * attribute at all — so the distinction actually holds.
 *
 * Everything else is a link the wiki's author wrote, which the application
 * must not follow in-window.
 */
export type LinkTarget =
  | { kind: "page"; slug: string }
  | { kind: "source"; id: string; fragment: string }
  | { kind: "external"; href: string };

/** The bit of an element this needs, so a test does not need a DOM. */
export interface LinkLike {
  getAttribute(name: string): string | null;
}

export function linkTarget(element: LinkLike): LinkTarget {
  const page = element.getAttribute(PAGE_ATTR);
  if (page !== null) return { kind: "page", slug: page };
  const source = element.getAttribute(SOURCE_ATTR);
  if (source !== null) {
    return {
      kind: "source",
      id: source,
      fragment: element.getAttribute(FRAGMENT_ATTR) ?? "",
    };
  }
  return { kind: "external", href: element.getAttribute("href") ?? "" };
}

/**
 * Whether the application may hand a URL to the system browser.
 *
 * `shell.openExternal` is `ShellExecute` on Windows, which invokes whichever
 * protocol handler is registered — `ms-msdt:`, `ms-officecmd:`, `search-ms:`
 * against a WebDAV share. Those are documented paths from "a link in a
 * document" to code execution, and markdown-it's own link filter blocks only
 * `javascript:`, `vbscript:`, `file:` and most `data:`. So the answer is an
 * allowlist rather than a blocklist.
 */
const OPENABLE = new Set(["http:", "https:", "mailto:"]);

export function isOpenableExternally(href: string): boolean {
  try {
    return OPENABLE.has(new URL(href).protocol);
  } catch {
    return false;
  }
}
