---
autonomy: auto
ci: wait
---

# Settings as a pane, export beside New page

Two adjustments to where things live in the desktop window. Neither changes what
anything does — the export writes the same archive and the settings write the
same two files — so this is a plan and not a spec.

## Why each of them moves

**The export is not a setting.** It sat at the bottom of the settings sheet,
below the WAV switch and above the paths, because that is where the first
version of 6.1 had room for it. But a setting is something you change once and
live inside; an export is an *act on the wiki* — the same shelf as creating a
page, renaming one, deleting one. Every other act on the wiki is in the wiki
pane's bar, and this one was three clicks away behind a modal about API keys.

**The settings are not an overlay.** A sheet is right for something you glance
at and dismiss. The settings page is six sections, one of which prints a
configuration file, and it is where somebody goes to *work on the setup* — they
type a key, wait for it to be checked, read where the file is, come back to it.
A modal makes all of that a thing balanced on top of the window rather than a
place you went, and it cannot be reached by Back, cannot be linked to from the
Chat pane's empty state as a destination, and steals the window's focus for as
long as it is open.

**Tabs, because six sections in one column is a scroll.** Once it is a page with
the whole window to fill, stacking every section vertically wastes it: the four
groups — the project's own settings, the credential, the agent, the files —
are independent, and a person who came here to paste a key should not scroll
past the language picker to find it.

## What this costs

Making `settings` a pane puts it in the back history, which is the point, and
retires the shell's rule that an overlay is never a location for one of the
three things that rule was written for. The other two — the history drawer and
the provenance viewer — keep it, and `specs/desktop-shell` R2.1 is amended to
name only them.

## Tasks

- [x] 1.1 (Unit) Make `settings` a pane and drop the settings overlay from the shell — desktop-shell R1.1, R2.1
- [x] 1.2 (Unit) Give the rail a Settings tab at its foot and point the titlebar's gear at the pane — desktop-shell R3.5, R4.1, R4.5
- [x] 1.3 (Unit) Frame the settings page with a pane bar and split it into tabbed sections — desktop-shell R4.1
- [x] 2.1 (Unit) Ask the export question with the survey already in it — wiki-pane R6.2
- [x] 2.2 (Unit) Put Export beside New page in the wiki pane's bar and take it out of the settings page — wiki-pane R6.1, R6.3
- [x] 2.3 (Unit) Write the spec deltas for `desktop-shell` and `wiki-pane`
