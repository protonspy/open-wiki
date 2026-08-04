import { BookText, CircleCheck, Globe, Layers, MessagesSquare, Settings2 } from "lucide-react";
import clsx from "clsx";
import { railMove } from "./keyboard.js";
import type { Pane } from "./navigation.js";
import { ICON_MD, type Icon } from "./ui/icons.js";

/**
 * The icon rail (spec `desktop-shell`, R4).
 *
 * **Every pane the window has, all of them visible at once.** A rail is not a
 * menu: the point is that moving between the wiki and its sources costs one
 * click and no memory of where the thing was, which is what makes it bearable
 * to keep checking one against the other.
 *
 * MCP is absent, and that is the honest state rather than an omission — its
 * pane is waiting on a server nobody has built (`specs/mcp-pane/`), and a rail
 * entry leading to a pane that can say nothing is worse than no entry.
 */
export interface RailPane {
  pane: Pane;
  label: string;
  icon: Icon;
  /**
   * Drawn at the foot of the rail rather than in the run at the top.
   *
   * **Still a tab, and still inside the tablist.** It is one of the window's
   * panes, so it takes its `Ctrl`+digit like the rest and the arrow keys reach
   * it; what changes is only where the eye finds it. Separating the entry that
   * is about the application from the ones that are about the work is what every
   * rail does, and doing it by leaving the tablist would cost the keyboard
   * pattern uxpass 4.5 built.
   */
  foot?: true;
}

/**
 * In the order the draft draws them: what you read, what it rests on, what is
 * wrong with it. That is also the order a page is written in.
 *
 * The settings are the fifth and last, at the foot. They were a sheet over the
 * window and are a pane because that is what they behave like — the argument is
 * in `navigation.ts`.
 */
export const PANES: readonly RailPane[] = [
  { pane: "wiki", label: "Wiki", icon: BookText },
  { pane: "sources", label: "Sources", icon: Layers },
  { pane: "checks", label: "Checks", icon: CircleCheck },
  { pane: "chat", label: "Chat", icon: MessagesSquare },
  { pane: "settings", label: "Settings", icon: Settings2, foot: true },
];

export interface RailProps {
  current: Pane;
  onGoTo: (pane: Pane) => void;
  /** The project's content language, as its code — `en`, `pt`, `es` (8.12). */
  language: string;
}

export function Rail({ current, onGoTo, language }: RailProps): React.JSX.Element {
  const at = Math.max(
    0,
    PANES.findIndex((entry) => entry.pane === current),
  );

  /**
   * One tab stop for the whole rail, and the arrows move within it (uxpass 4.5).
   *
   * Moving selects, as the tablist pattern's automatic activation does and as
   * the tree already does: the panes are all mounted, so arriving somewhere and
   * showing it are one act. Focus is moved rather than only marked, or the ring
   * would be left behind on the tab you arrowed away from.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    const to = railMove(event, at, PANES.length);
    if (to === null) return;
    const next = PANES[to];
    if (!next) return;
    event.preventDefault();
    onGoTo(next.pane);
    event.currentTarget.querySelector<HTMLElement>(`[data-ow-rail-index="${String(to)}"]`)?.focus();
  };

  return (
    <div className="rail">
      {/* The tablist holds tabs and nothing else. The language chip below is
          not one, and a non-tab child of a `tablist` is a child assistive
          technology has no name for. */}
      <div
        className="rail__tabs"
        role="tablist"
        aria-orientation="vertical"
        aria-label="Panes"
        onKeyDown={onKeyDown}
      >
        {PANES.map(({ pane, label, icon: IconGlyph, foot }, i) => (
          <button
            key={pane}
            type="button"
            role="tab"
            className={clsx("rail-btn", foot && "rail-btn--foot")}
            data-ow-rail-index={i}
            // The roving stop: the open pane is the one Tab reaches. Never
            // none, or Tab would skip the rail entirely.
            tabIndex={i === at ? 0 : -1}
            // The selected pane is marked twice over: the accent, and a bar down
            // its left edge. Colour alone is not a state anyone can rely on.
            aria-selected={current === pane}
            onClick={() => onGoTo(pane)}
          >
            <IconGlyph size={ICON_MD} aria-hidden />
            {label}
          </button>
        ))}
      </div>
      {/* Shown, not offered. The language is a project setting (`ow.json`), and
          the settings pane one row above is where it is changed — this is the
          reminder that the agent was told to write in it. */}
      <span className="rail-btn rail-btn--static" title={`Content language: ${language}`}>
        <Globe size={ICON_MD} aria-hidden />
        {language.toUpperCase()}
      </span>
    </div>
  );
}
