import type { Pane } from "./navigation.js";

/**
 * How the shell arranges itself at the width it is given
 * (`plans/desktop-ui-uxpass.md`, group 1).
 *
 * **The window permits 720×480 and had no answer for it.** The wiki pane was
 * `220px minmax(0, 1fr) 250px` over a 52px rail with no `@media` rule anywhere
 * in `globals.css` except the reduced-motion one, so the fixed furniture was
 * 522px whatever the window measured: at the application's own minimum the
 * reader column came to 115px, three words to a line, with the *Needs
 * attention* rail nearly twice as wide as the article it annotates.
 *
 * The numbers live here rather than only in the stylesheet for the same reason
 * every other decision in this renderer does: a media query is not something a
 * test can reach, and a breakpoint nobody can assert is a breakpoint that drifts
 * off the layout it was chosen for. `layout.spec.ts` reads both — this module
 * for the arithmetic, `globals.css` for the rules — and fails when they stop
 * agreeing.
 */

/** The icon rail, present at every width (`globals.css`, `.app-body`). */
export const RAIL_WIDTH = 52;

/** The page tree (`.tree`). */
export const TREE_WIDTH = 220;

/** The side column — provenance and findings (`.side`). */
export const SIDE_WIDTH = 250;

/**
 * The narrowest window this application allows — `minWidth`/`minHeight` on the
 * `BrowserWindow` in `src/main/index.ts`. Everything below is measured against
 * it, because a size the application permits is a size it has to answer for.
 */
export const MIN_WIDTH = 720;
export const MIN_HEIGHT = 480;

/**
 * The narrowest a column of prose is worth reading in.
 *
 * Not a round number picked for the look of it: below roughly this the reader
 * runs under five words to a line, which is the point at which the eye spends
 * more time returning than reading. It is the threshold both breakpoints are
 * chosen to keep, and the one the tests assert.
 */
export const MIN_READER = 380;

/**
 * Below this the side column stops being a column.
 *
 * Chosen so the reader still clears {@link MIN_READER} at the width just above
 * it: 1000 − 52 − 220 − 250 = 478.
 */
export const SIDE_BREAKPOINT = 1000;

/**
 * Below this the page tree stops being a column too.
 *
 * 820 − 52 − 220 = 548 for the reader at the width just above it, with the side
 * column already an overlay by then.
 */
export const TREE_BREAKPOINT = 820;

/** Whether a panel is a column of the grid, or a sheet drawn over it. */
export type PanelPlacement = "docked" | "overlay";

export interface ShellLayout {
  tree: PanelPlacement;
  side: PanelPlacement;
  /** What the reader column measures at this width, in px. */
  reader: number;
}

/**
 * Where the two side panels sit at a given window width, and what the reader
 * gets as a result.
 *
 * The worst case is assumed throughout — a page open, so the side column exists.
 * With no page open the reader is only wider, and a layout asserted at its
 * narrowest is a layout asserted.
 */
export function shellLayout(width: number): ShellLayout {
  const tree: PanelPlacement = width >= TREE_BREAKPOINT ? "docked" : "overlay";
  const side: PanelPlacement = width >= SIDE_BREAKPOINT ? "docked" : "overlay";
  return {
    tree,
    side,
    reader: Math.max(0, width - furnitureFor("wiki", width)),
  };
}

/**
 * How much of the window a pane spends on fixed furniture before any content.
 *
 * Only the wiki pane has columns beside its content; sources, checks and chat
 * are the rail and then the pane. This is what group 1's third task is about —
 * at 720 the furniture has to leave something behind on *every* pane, not only
 * on the one that was measured.
 */
export function furnitureFor(pane: Pane, width: number): number {
  if (pane !== "wiki") return RAIL_WIDTH;
  const tree = width >= TREE_BREAKPOINT ? TREE_WIDTH : 0;
  const side = width >= SIDE_BREAKPOINT ? SIDE_WIDTH : 0;
  return RAIL_WIDTH + tree + side;
}

/** The gap between the editor's two panes — `--space-4` in `globals.css`. */
export const EDITOR_GAP = 16;

/**
 * What the editor's two tracks measure (uxpass 2.1).
 *
 * The whole finding is the difference between two spellings of one column:
 *
 * - `1fr` is `minmax(auto, 1fr)`. `auto` is the track's *minimum content* size,
 *   so a preview holding a wide code fence or a table cannot be made narrower
 *   than that fence — it takes what it needs and the source box gets the
 *   remainder. Measured at 207px against a 468px preview, wrapping the markdown
 *   at roughly 22 characters.
 * - `minmax(0, 1fr)` lets the track go to zero, so neither half can push the
 *   other: the content scrolls inside its own column instead.
 *
 * Modelled here rather than only asserted as a string, because "the two columns
 * measure within 10% of each other" is arithmetic and the arithmetic is the
 * reason the rule changed.
 */
export function editorColumns(
  paneWidth: number,
  /** The narrowest the preview's own content can be — a fenced line, a table. */
  previewMinContent: number,
  /** `auto` is what `1fr` means; `zero` is what `minmax(0, 1fr)` means. */
  track: "auto" | "zero",
  gap: number = EDITOR_GAP,
): { source: number; preview: number } {
  const usable = Math.max(0, paneWidth - gap);
  const half = usable / 2;
  if (track === "zero") return { source: half, preview: half };
  const preview = Math.min(usable, Math.max(half, previewMinContent));
  return { source: usable - preview, preview };
}

/**
 * The narrowest content column a pane is left with at this width.
 *
 * Zero or less is an overflow: the fixed furniture alone would be wider than the
 * window, and something on screen has nowhere to go.
 */
export function contentWidth(pane: Pane, width: number): number {
  return width - furnitureFor(pane, width);
}
