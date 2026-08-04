import { PANES } from "./Rail.js";
import type { Pane } from "./navigation.js";

/**
 * The keyboard (desktop-ui 8.1).
 *
 * A dense window read beside a harness is a window somebody keeps their hands
 * off the mouse for. What that needs is small and specific: reach any pane
 * without pointing, close what is open, and move through the tree without
 * pressing Tab two hundred times.
 *
 * **The decisions are functions, not handlers.** What a chord means and where
 * an arrow key goes are testable; attaching a listener is not.
 *
 * The plan also asks for *focus the search*. There is no search: the wiki pane
 * ships without one deliberately (`specs/wiki-pane`, Out of scope — it waits on
 * the embedded agent or on a harness over MCP). A shortcut for a control that
 * does not exist is the dead-button class group 1 was about.
 */

/** The part of a keyboard event this reads, so a test needs no DOM. */
export interface Chord {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Which pane a chord asks for, if any.
 *
 * `Ctrl`/`Cmd` and the pane's position in the rail — the order the rail draws,
 * so the number is what the eye already counted. Not `Alt`, which Windows gives
 * to the menu bar, and not a bare digit, which is a character somebody is
 * typing into a page.
 */
export function paneShortcut(chord: Chord): Pane | null {
  if (!(chord.ctrlKey || chord.metaKey) || chord.altKey || chord.shiftKey) return null;
  const position = Number(chord.key);
  if (!Number.isInteger(position) || position < 1 || position > PANES.length) return null;
  return PANES[position - 1]?.pane ?? null;
}

/**
 * Where an arrow key moves inside a list of `count` items.
 *
 * A **roving tabindex**: one tab stop for the whole tree, and the arrows move
 * within it. Two hundred pages would otherwise be two hundred stops between the
 * rail and the reader, which is the shape that makes people reach for the mouse
 * again.
 *
 * It does not wrap. A list that jumps from the last page to the first when you
 * hold Down is a list you cannot feel the end of.
 */
export function listMove(chord: Chord, index: number, count: number): number | null {
  if (count <= 0) return null;
  const clamp = (n: number): number => Math.min(count - 1, Math.max(0, n));
  switch (chord.key) {
    case "ArrowDown":
      return clamp(index + 1);
    case "ArrowUp":
      return clamp(index - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * Where an arrow key moves inside the rail (uxpass 4.5).
 *
 * The markup has claimed `role="tablist"` since the shell was built, and the
 * pattern that role names was never implemented: four tabs were four separate
 * tab stops, so reaching the reader from the titlebar cost four presses of Tab
 * through controls the arrows were supposed to move between.
 *
 * **It wraps, where {@link listMove} does not**, and the difference is the
 * length of the thing. Four tabs are a ring you can feel the shape of in one
 * pass; two hundred pages are a list you cannot feel the end of if holding Down
 * silently returns you to the top. The ARIA tablist pattern wraps for the same
 * reason.
 *
 * Both axes are accepted. The role's default orientation is horizontal and the
 * plan asks for Left/Right, but this rail is drawn as a column and Up/Down is
 * what a hand reaches for when looking at one — so the markup declares
 * `aria-orientation="vertical"` and this answers to either.
 */
export function railMove(chord: Chord, index: number, count: number): number | null {
  if (count <= 0) return null;
  const wrap = (n: number): number => ((n % count) + count) % count;
  switch (chord.key) {
    case "ArrowRight":
    case "ArrowDown":
      return wrap(index + 1);
    case "ArrowLeft":
    case "ArrowUp":
      return wrap(index - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * Whether Escape here should close the overlay the shell is holding.
 *
 * **Only for the one overlay that is not a modal.** The history drawer is a
 * `<dialog>`: the platform closes it on Escape and its own `onClose` dismisses
 * the shell. The provenance panel is deliberately *not* modal (spec
 * `desktop-shell`, R2.6) — you read the paragraph while you check its citation —
 * so nothing was listening for Escape over it.
 *
 * The settings were the third of these and are a pane now, so Escape has nothing
 * to do with them: leaving a pane is Back, or another pane.
 *
 * A keystroke inside a text box is never this: Escape in a field is the
 * field's, and taking it would close the panel somebody was typing a citation
 * into.
 */
export function closesOverlay(chord: Chord, overlayKind: string | null, inField: boolean): boolean {
  return chord.key === "Escape" && !inField && overlayKind === "provenance";
}

/**
 * Whether this keystroke means *follow the link that has the focus* (uxpass 3.1).
 *
 * Enter and Space, which is what the platform does for a real `<a href>` and a
 * `<button>` respectively. `markdown.ts` mints no `href` on purpose — a scheme
 * is something a page author can forge and `data-ow-*` is not — and the price of
 * that decision is that the activation the browser would have given for free has
 * to be given here instead. It was not, so every wikilink and every citation in
 * the reader was mouse-only.
 *
 * A modifier is not this: `Ctrl+Enter` and friends belong to whatever else is
 * listening for them.
 */
export function activatesLink(chord: Chord): boolean {
  if (chord.ctrlKey === true || chord.metaKey === true || chord.altKey === true) return false;
  return chord.key === "Enter" || chord.key === " ";
}

/** Whether the focus is somewhere a keystroke belongs to the control. */
export function isFieldTag(tagName: string | undefined): boolean {
  const tag = (tagName ?? "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}
