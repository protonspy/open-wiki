import { BookText, CircleCheck, Globe, Layers, MessagesSquare } from "lucide-react";
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
}

/**
 * In the order the draft draws them: what you read, what it rests on, what is
 * wrong with it. That is also the order a page is written in.
 */
export const PANES: readonly RailPane[] = [
  { pane: "wiki", label: "Wiki", icon: BookText },
  { pane: "sources", label: "Sources", icon: Layers },
  { pane: "checks", label: "Checks", icon: CircleCheck },
  { pane: "chat", label: "Chat", icon: MessagesSquare },
];

export interface RailProps {
  current: Pane;
  onGoTo: (pane: Pane) => void;
  /** The project's content language, as its code — `en`, `pt`, `es` (8.12). */
  language: string;
}

export function Rail({ current, onGoTo, language }: RailProps): React.JSX.Element {
  return (
    <nav className="rail" role="tablist" aria-label="Panes">
      {PANES.map(({ pane, label, icon: IconGlyph }) => (
        <button
          key={pane}
          type="button"
          role="tab"
          className="rail-btn"
          // The selected pane is marked twice over: the accent, and a bar down
          // its left edge. Colour alone is not a state anyone can rely on.
          aria-selected={current === pane}
          onClick={() => onGoTo(pane)}
        >
          <IconGlyph size={ICON_MD} aria-hidden />
          {label}
        </button>
      ))}
      <span className="rail-spacer" />
      {/* Shown, not offered. The language is a project setting (`ow.json`), and
          the sheet is where it is changed — this is the reminder that the agent
          was told to write in it. */}
      <span className="rail-btn rail-btn--static" title={`Content language: ${language}`}>
        <Globe size={ICON_MD} aria-hidden />
        {language.toUpperCase()}
      </span>
    </nav>
  );
}
