---
autonomy: auto
ci: wait
---

# The launcher, in the design system it already has

## Why

`globals.css` ports `design/desktop-draft.html` token for token, and states the
visual idea out loud: a **cold instrument** — blue-biased slate — holding a
**warm reading surface**, with amber reserved for provenance. Every pane was
built to it. The launcher was not.

It renders raw `<button>` elements while `ui/Button.tsx` ships four variants and
a rule about which one means what. It borrows `.list` and `.operation` from the
sources table, so a project reads as a row of a data grid rather than as the
thing this window exists to open. It has no container of its own, so on a
1180px window the whole screen is one long full-bleed line of text. And its
closing sentence tells the reader to go and use the terminal instead.

The draft never designed this screen — it draws dialogs, and §2.2 is the *new
project* dialog rather than the home. So this is the one surface with no
acceptance criterion, which is exactly why it drifted.

Done means: the home is built from the primitives the system already ships, it
says where new projects go, its empty state invites rather than reports, and a
project reads as a project.

## Tasks

- [x] 1.1 (Unit) Give the launcher a column, a heading block and one mono line saying where new projects go
- [x] 1.2 (Unit) Render a project as a row that carries its own state — the paper edge, warm when it is there and dim when it is not
- [x] 1.3 (Unit) Use the `Button` primitive with the variants it defines, one primary on the screen
- [x] 1.4 (Unit) Rewrite the empty state as an invitation and the footer as one sentence

## Notes

**No new palette, no new faces, no new radius.** The identity is settled and
written down; what was missing is a screen using it. A distinct look here would
be the one screen that does not match the four beside it.

The one deliberate move is the **paper edge** on a project row: this window's
whole idea is an instrument holding paper, and the home is the list of papers it
holds. It earns its place by carrying state rather than decorating — warm for a
project that is there, dim red for one whose directory moved — so it is the
same fact the badge states, said in the row's own shape.

`Card` is deliberately not used. Its own note says a card around a list that is
the whole pane is a border drawn inside a border.
