import { useEffect, useRef, useState } from "react";
import type { Language } from "@open-wiki/access";
import { BookText, Check, CircleCheck, Globe, Layers, MessagesSquare, Settings2 } from "lucide-react";
import clsx from "clsx";
import { railMove } from "./keyboard.js";
import type { Pane } from "./navigation.js";
import { LANGUAGES } from "./languages.js";
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
 * Chat leads the rail. The rest follow the order a page is written in — what
 * you read, what it rests on, what is wrong with it — and that order is still
 * the one the draft draws them in; Chat is simply pulled ahead of it.
 *
 * The settings are the last, at the foot. They were a sheet over the window and
 * are a pane because that is what they behave like — the argument is in
 * `navigation.ts`.
 */
export const PANES: readonly RailPane[] = [
  { pane: "chat", label: "Chat", icon: MessagesSquare },
  { pane: "wiki", label: "Wiki", icon: BookText },
  { pane: "sources", label: "Sources", icon: Layers },
  { pane: "checks", label: "Checks", icon: CircleCheck },
  { pane: "settings", label: "Settings", icon: Settings2, foot: true },
];

export interface RailProps {
  current: Pane;
  onGoTo: (pane: Pane) => void;
  /** The project's content language, as its code — `en`, `pt-BR`, `es` (8.12). */
  language: string;
  /** Write a new content language to the project (`ow.json`) and refresh. */
  onLanguageChange: (next: Language) => void;
}

export function Rail({ current, onGoTo, language, onLanguageChange }: RailProps): React.JSX.Element {
  const at = Math.max(
    0,
    PANES.findIndex((entry) => entry.pane === current),
  );
  /** The language menu is open. Owned here because it is the chip's own state. */
  const [langOpen, setLangOpen] = useState(false);
  // The chip gets focus back when the menu closes, and the menu is reached by
  // arrow keys rather than only Tab — the `role="menu"` claims that contract, so
  // it is implemented rather than only asserted.
  const chipRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /** Close the menu and return focus to the chip it opened from. */
  const closeLang = (): void => {
    setLangOpen(false);
    chipRef.current?.focus();
  };

  // On open, land in the menu — on the current language if it is listed, else the
  // first item — so the keyboard is in the menu the moment it appears, not left on
  // the chip the mouse already left.
  useEffect(() => {
    if (!langOpen) return;
    const menu = menuRef.current;
    if (!menu) return;
    const items = menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    const focus =
      Array.from(items).find((item) => item.getAttribute("aria-checked") === "true") ??
      items[0];
    focus?.focus();
  }, [langOpen]);

  /** The menu keyboard contract: arrows move between items, Escape closes. */
  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
    );
    const i = items.findIndex((item) => item === document.activeElement);
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        closeLang();
        return;
      case "ArrowDown":
        event.preventDefault();
        items[(i + 1) % items.length]?.focus();
        return;
      case "ArrowUp":
        event.preventDefault();
        items[(i - 1 + items.length) % items.length]?.focus();
        return;
      case "Home":
        event.preventDefault();
        items[0]?.focus();
        return;
      case "End":
        event.preventDefault();
        items[items.length - 1]?.focus();
        return;
    }
  };

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
      {/* The language the agent writes in is a project setting (`ow.json`), and
          it is offered here — not only in the settings pane — because the rail
          is always in view and the settings pane is not. It is still not a tab:
          a non-tab child of a `tablist` is a child assistive technology has no
          name for, so it stays outside the list exactly as it did when it was
          display-only. */}
      <div className="rail-lang">
        <button
          ref={chipRef}
          type="button"
          className="rail-btn rail-lang__btn"
          aria-haspopup="menu"
          aria-expanded={langOpen}
          aria-controls={langOpen ? "rail-lang-menu" : undefined}
          title={`Content language: ${language}`}
          onClick={() => setLangOpen((open) => !open)}
        >
          <Globe size={ICON_MD} aria-hidden />
          {language.toUpperCase()}
        </button>
        {langOpen ? (
          <>
            {/* A click anywhere else closes the menu. Fixed and behind the menu,
                so it covers the whole window without shifting layout. */}
            <div className="rail-lang__backdrop" onClick={closeLang} />
            <div
              id="rail-lang-menu"
              ref={menuRef}
              className="rail-lang__menu"
              role="menu"
              aria-label="Content language"
              onKeyDown={onMenuKeyDown}
            >
              {LANGUAGES.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={value === language}
                  className="rail-lang__item"
                  onClick={() => {
                    closeLang();
                    // `void`: the callback writes and refreshes; it catches its own
                    // errors, and dropping the promise here is explicit rather than
                    // an oversight a later caller could break.
                    void onLanguageChange(value);
                  }}
                >
                  <span>{label}</span>
                  {value === language ? <Check size={ICON_MD} aria-hidden /> : null}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
