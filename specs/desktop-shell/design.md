# Desktop shell — design

## What changes

Serves R1.1, R1.2, R1.3, R1.7, R2.1, R2.2, R2.3, R2.4, R2.5.

`navigation.ts` keeps its `History` — the stack with a cursor, and the rule that
going somewhere new after going back discards the future. What changes is what a
`Location` is, and what is deliberately not one.

```ts
export type Pane = "wiki" | "sources" | "checks";

export interface Location {
  pane: Pane;
  /** What is selected inside it: a page slug, a source id, a finding's code. */
  selection?: string;
}

export type Overlay =
  | { kind: "settings" }
  | { kind: "history" }
  | { kind: "provenance"; source: string; fragment: string };
```

Two fields where there was a view and a slug, and one type that is not a
location at all.

**An overlay is state beside the history, never inside it** (R2.2). The reason
is R2.3 read backwards: an overlay has exactly one thing to return to — the
location it was opened over — and that is already the current location, so
recording it would put a second entry on the stack whose only purpose is to be
skipped. It also makes the failure mode concrete: with the settings sheet in the
history, Back after closing it lands on the pane _before_ the one you opened it
from, because the sheet consumed the press that should have taken you there.

The overlay is a single value rather than a set (R2.5). Two at once is not a
layout question but a state nothing can arrive at, and a set would make it
representable.

**Two of the three are modal, and the third deliberately is not.** The settings
sheet and the history drawer are `<dialog>`s opened with `showModal`, so the
document behind them is inert. The provenance viewer is not: the draft puts it
_beside_ the page rather than over it, and the reason is what it is for — you
open a citation to check a claim you are in the middle of reading, and a panel
that makes the paragraph behind it unreadable has answered a question by taking
away the thing that raised it (R2.6).

That is why R2.4 is **asserted in `Shell` rather than inherited from the
modal**. For two of the three it would indeed fall out for free; for the third
it would not, and a rule that holds for two cases out of three by accident is
the kind that is discovered to be false by whatever is built on it next. The
keyboard shortcuts of 8.1 are not behind the inert layer either.

### Selection is remembered per pane, not per visit

R1.7 needs somewhere to put "the page I was reading" while the user is in
Sources. Keeping it in the history would mean reconstructing it by walking
backwards for the most recent entry with that pane, which is the same fact
stored twice and read the long way round. Instead the shell holds one
`Record<Pane, string | undefined>` beside the history, written whenever a
location is visited and read when a pane is entered without a selection.

## Boundaries and contracts

Serves R5.2, R5.3.

The status bar's findings count is the number the checks pane already computes.
The shell does not run the checks a second time to fill in a number — `ow.check`
walks the whole project, and running it on every render of the frame is how a
status bar becomes the slowest thing in the window. The count is handed up from
the checks pane's own load, and is absent until something has loaded it once,
which the bar says rather than showing a confident `0`.

## Alternatives

**Keeping one flat `view` and adding `settings` and `history` to it**, as today.
Rejected: that is precisely the model that makes an overlay a location, and it
is why the settings screen currently replaces the pane you were reading instead
of sitting over it. The draft draws both as overlays, and the reason it draws
them that way is that neither is a place you go — one is a thing you adjust and
one is a thing you consult.

**A router keyed on a URL string.** Rejected as ceremony: there is no address
bar, no deep link and no reload to survive, so a string would exist only to be
parsed back into the two fields above. The record that has to survive is the
project on disk, not the window's position in it.
