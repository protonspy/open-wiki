---
autonomy: auto
ci: wait
---

# Rail: Chat active by default + language button

Two desktop-shell tweaks: open on the Chat pane, and let the rail's language chip
change the language instead of only showing it.

## Why

The rail already leads with Chat, but the window still opens on `wiki` because
`Shell`'s default start is `{ pane: "wiki" }` — the thing the rail puts first is not
the thing the reader lands on. The language chip at the rail's foot is display-only
(`rail-btn--static`); changing the language means leaving the pane for Settings, even
though `bridge().setLanguage()` and `App.refreshProject()` already exist and are wired
into `Settings.changeLanguage`. The chip is always in view and Settings is not, so the
chip should offer what it already shows.

## Tasks

- [x] 1.1 (Unit) Make Chat the default pane — `navigation.ts` `Shell` constructor
      default and `location` fallback `{ pane: "chat" }`. Update `renderer.spec.ts`
      "starts in the wiki…" to assert `chat`.
- [x] 2.1 (Unit) Turn the rail language chip into a button that opens a popover
      menu listing `LANGUAGES` (en / pt-BR / es), marking the current one. Chip
      stays outside the `tablist`. `Rail.tsx` gains `onLanguageChange: (Language) => void`.
- [x] 2.2 (Unit) Wire `App` → `<Rail onLanguageChange={changeLanguage} />`, where
      `changeLanguage` calls `bridge().setLanguage(next)` then `refreshProject()`
      (try/catch → `say(failure("shell", e))`). No settings-only status string.
- [x] 2.3 (Unit) CSS for the popover (`.rail-lang`, `.rail-lang__menu`,
      `.rail-lang__item`); remove `.rail-btn--static`. Outside-click backdrop +
      Escape to close.
- [x] 2.4 (Unit) Update `announcements.spec.ts` "keeps the language chip out of the
      tablist" for the new chip class; add a source-level test asserting the popover
      wiring (`onLanguageChange`, `role="menu"`) and App wiring
      (`<Rail … onLanguageChange={`).
- [ ] 3.1 (Unit) Scoped tests + `pnpm lint` + `scc validate`; branch, PR, watch CI.

## Done when

- The window opens on Chat; `renderer.spec.ts` asserts `new Shell().location` is
  `{ pane: "chat" }`.
- Clicking the rail's language chip opens a menu of the three content languages with
  the current one marked; choosing one writes it and the chip plus `document.lang`
  update without reopening the window.
- The chip is still outside the tablist; `announcements.spec.ts` and
  `settings-pane.spec.ts` assert the wiring; `pnpm lint` and `scc validate` are clean.