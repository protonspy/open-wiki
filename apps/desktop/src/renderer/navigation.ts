import { FRAGMENT_ATTR, PAGE_ATTR, SOURCE_ATTR } from "./markdown.js";

/**
 * Where the reader is, and how they get back (plan 8.5, spec `desktop-shell`).
 *
 * A wiki is read by following links and returning, so "go back" is not a
 * convenience — it is half of how the content is used. Kept as a stack of
 * visited locations with a cursor rather than a list of "previous": following a
 * link after going back has to discard the forward history, exactly as a
 * browser does, or Back stops meaning "where I came from".
 *
 * **A location is a pane and a selection within it; an overlay is neither.**
 *
 * This used to be one flat `view` that also carried `settings` and `history`,
 * which made opening either a place you had gone — so Back after closing one
 * landed on the pane *before* the one you opened it from, the overlay having
 * eaten the press that should have taken you there. `Shell` below is where that
 * separation is enforced.
 *
 * **The settings crossed back over, deliberately.** They were an overlay for the
 * reason above and are a pane now, because they are not a thing you glance at:
 * four sections, one of which prints a configuration file, and the work done
 * there — paste a key, wait for it to be checked, read where the file is, come
 * back to it — is going somewhere rather than consulting something. So the
 * settings are a location, they are in the back history, and Back after leaving
 * them returns to them exactly as it does for any other pane. The rule R2.2
 * states is unchanged; the settings simply stopped being one of the things it is
 * about.
 */

/**
 * The panes the rail offers. MCP joins them with `specs/mcp-pane/`.
 *
 * `chat` carries the embedded agent (specs/embedded-agent): a window where the
 * agent reads this project and writes the wiki through the gate, pausing for
 * approval on every write.
 *
 * `settings` is the last of them, and the rail draws it apart from the rest: the
 * four above are what the project holds, and that one is how the application is
 * set up.
 */
export type Pane = "wiki" | "sources" | "checks" | "chat" | "settings";

export interface Location {
  pane: Pane;
  /** What is selected inside it — a page's slug, a source's id. */
  selection?: string;
}

/**
 * What sits *over* a location: consulted or adjusted, never travelled to.
 *
 * `Shell` holds one of these rather than a set, because two at once is a state
 * nothing can arrive at and a set would make it representable.
 *
 * **One is a modal `<dialog>`; the provenance viewer is deliberately not.** You
 * open a citation to check a claim you are in the middle of reading, and a
 * panel that makes the paragraph behind it unreadable has answered a question
 * by taking away the thing that raised it. So the rule that nothing navigates
 * while an overlay is open is asserted below rather than inherited from the
 * modal — it would hold for the drawer by accident, which is the kind of rule
 * something later is built on and discovers to be false.
 *
 * The settings sheet was the third of these and is a pane now — see `Pane`.
 */
export type Overlay =
  { kind: "history" } | { kind: "provenance"; source: string; fragment: string };

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
  return a.pane === b.pane && a.selection === b.selection;
}

/**
 * The window's position, and the one thing that is not part of it.
 *
 * Three facts live here rather than in `App`: where you are, what each pane was
 * left showing, and which overlay is open. They are together because every rule
 * worth having is about the relationship between them —
 *
 * - **an overlay is never recorded** (R2.2), so closing one returns to the
 *   location it was opened over rather than to the one before that;
 * - **nothing navigates while an overlay is open** (R2.4). The modal already
 *   makes the pane behind it unclickable, but the keyboard shortcuts of 8.1 are
 *   not behind that inert layer, so the rule is asserted rather than assumed;
 * - **a pane remembers what it was showing** (R1.7). Kept beside the history
 *   rather than dug out of it: walking backwards for the most recent entry with
 *   a given pane is the same fact stored twice and read the long way round.
 */
export class Shell {
  private readonly history = new History();
  private readonly lastSeen: Partial<Record<Pane, string>> = {};
  private open: Overlay | null = null;

  // Chat is the primary pane — it leads the rail, and the window opens on it
  // rather than on the wiki. The wiki is one keystroke (Ctrl/Cmd+2) away.
  constructor(start: Location = { pane: "chat" }) {
    this.history.visit(start);
  }

  get location(): Location {
    return this.history.current ?? { pane: "chat" };
  }

  get overlay(): Overlay | null {
    return this.open;
  }

  get canGoBack(): boolean {
    return this.history.canGoBack;
  }

  get canGoForward(): boolean {
    return this.history.canGoForward;
  }

  /**
   * Enter a pane, at whatever it was last showing (R1.7).
   *
   * Coming back to the wiki after a detour through Sources lands on the page
   * that was being read, which is the whole point of remembering: the rail is
   * how you leave a page for a moment, not how you close it.
   */
  goTo(pane: Pane): Location {
    return this.navigate({ pane, selection: this.lastSeen[pane] });
  }

  /** Somewhere new outright — a wikilink to a page, say (R1.3). */
  visit(location: Location): Location {
    return this.navigate(location);
  }

  back(): Location {
    return this.step(() => this.history.back());
  }

  forward(): Location {
    return this.step(() => this.history.forward());
  }

  /** Open an overlay over where you are. At most one (R2.5). */
  show(overlay: Overlay): void {
    this.open = overlay;
  }

  /** Close it, onto the location it was opened over (R2.3). */
  dismiss(): void {
    this.open = null;
  }

  private navigate(to: Location): Location {
    if (this.open) return this.location;
    const at = this.history.visit(to);
    this.remember(at);
    return at;
  }

  private step(move: () => Location | null): Location {
    if (this.open) return this.location;
    move();
    this.remember(this.location);
    return this.location;
  }

  private remember(at: Location): void {
    // Only a real selection. A pane entered with nothing selected must not
    // erase what it was showing, or Back and the rail would disagree about
    // what "the wiki" means the moment you visited its index.
    if (at.selection) this.lastSeen[at.pane] = at.selection;
  }
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
