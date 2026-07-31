---
status: accepted
---

# 0011 · A source is named by what it is, and that name is frozen

## Context

Every source becomes a directory under `raw/`, and the name of that directory is what every
provenance citation points at — `src://arquitetura-fenix.pdf#p12`,
`rec://fenix-weekly-2026-07-31#14:32`. So the naming scheme is embedded in the text of
every page that cites anything.

The first design gave a recording the timestamp of its first frame:
`raw/2026-07-31T14-02-11Z/`. That is unique for free and sorts correctly, and it is useless
to a person. `adr:0002-workspace-as-a-local-markdown-folder` says the folder is the product
and that the user owns their data in a format Obsidian, VS Code and `grep` already read —
an argument that collapses if half the folder is timestamps. Somebody opening `raw/` in
Explorer should see what they have.

And an hour of audio is never just an hour of audio. It is a weekly review, a vendor call, a
handover, a recorded presentation. The name is the difference between a citation a reader
trusts and a citation they have to open to understand.

## Decision

**A source's directory name is derived from what the source is, and is fixed when the
source is written.**

**A file keeps its filename.** `raw/arquitetura-fenix.pdf/` holds `source.pdf` and
`text.md`. **A name already taken in this project is refused**, with the conflict named, so
that the user renames the file rather than the application inventing
`arquitetura-fenix (2).pdf` on their behalf.

**A recording is named for the occasion, plus the date it happened:**
`raw/fenix-weekly-2026-07-31/`. The user is asked what they are recording before capture
starts. Two on one day take a `-2` suffix.

The date is part of the shape, not a disambiguator that appears only on a clash. Recurring
meetings are the normal case, and a scheme where the first `fenix-weekly` has no date and
the second gets a suffix produces ids whose meaning depends on the order they were created
in.

**The name is frozen; the title is not.** The directory name and the id in citations never
change after the source is written. The readable title lives in the source's
`manifest.json` and can be corrected at any time — fixing a typo in a title must never
break a citation or move an immutable directory. Both kinds of source carry a manifest, so
that a file and a recording answer the same questions.

Slugging is the boring part and is stated so nobody has to guess: lowercase, accents
folded to ASCII, anything outside `[a-z0-9]` collapsed to a single `-`, no leading or
trailing `-`.

**If the user gives no name, the timestamp is still the fallback.** A recording that
started is worth more than a naming rule, and capture must never be blocked on a text
field.

## Consequences

`raw/` becomes legible from a file manager, from `grep`, and from a citation read out of
context. `rec://fenix-weekly-2026-07-31#14:32` says what it is; `rec://2026-07-31T14-02-11Z#14:32`
never did.

The costs are real and worth naming:

**Refusing a duplicate filename pushes work onto the user**, at the moment they are dragging
files in and least want a dialog. It is deliberate: the alternative is an application that
silently renames things, and then the name in `raw/` is not the name they know the document
by — which defeats the point of using the filename at all.

**A badly named recording is badly named forever.** The title can be corrected, the
directory cannot, so somebody who accepts the default on a rushed day has a `raw/` entry
that reads worse than the title above it. The freeze is what makes citations survivable, so
this is the trade, and the naming prompt is placed before capture rather than after
precisely to catch it while the person still knows what the meeting was.

**The two names can drift.** The title says "Fenix weekly — cutover decision" and the
directory says `fenix-weekly-2026-07-31`. That is intended and is the same relationship a
page's `id` has to its `title`; anything else means renaming is impossible or citations are
fragile, and both are worse.

**Timestamps do not disappear.** The absolute time of the first frame stays in
`manifest.json`, because the time map and every reconstructed timestamp depend on it —
`adr:0006-opus-as-the-provenance-format`. What changed is that it is no longer the name.
