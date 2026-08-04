---
autonomy: auto
ci: wait
---

# Desktop shell — requirements

## Purpose

The frame every pane sits inside: a titlebar carrying what is true regardless of
which pane is open, an icon rail to move between panes, and a status bar.

Its real subject is **where the window is**. Today that is one `Location` with a
view and an optional slug, and the draft needs three things it cannot express: a
pane, a selection within that pane, and overlays that are not panes at all.

Getting that wrong is not cosmetic. A wiki is read by following links and coming
back, so Back is half of how the content is used — and if opening the settings
sheet enters the back history, Back stops meaning "where I came from" and starts
meaning "undo the last thing I clicked". 8.5 paid attention to this once and it
has to survive the repaint.

## R1 · Where the window is

- **R1.1** The shell shall hold the window's location as a pane and, where that
  pane has one, a selection within it.
- **R1.2** When the user chooses a pane, the shell shall show that pane and
  record the change as a location.
- **R1.3** When the user chooses an item within a pane, the shell shall record
  the change as a location.
- **R1.4** When the user goes back, the shell shall show the location visited
  before the current one.
- **R1.5** When the user goes somewhere new after going back, the shell shall discard
  the locations that were ahead of the cursor.
- **R1.6** If the user chooses the location they are already at, then the shell shall not record it a second time.
- **R1.7** When a pane is shown again after being left, the shell shall restore
  the selection it had.

## R2 · Overlays are not locations

- **R2.1** The shell shall open the settings sheet, the history drawer and the
  provenance viewer as overlays over the current location.
- **R2.6** While the provenance viewer is open, the shell shall leave the page
  behind it readable and its links followable.
- **R2.2** The shell shall not record an overlay as a location.
- **R2.3** When an overlay is dismissed, the shell shall show the location it
  was opened over.
- **R2.4** While an overlay is open, the shell shall not act on a request to
  change the location.
- **R2.5** The shell shall show at most one overlay at a time.

## R3 · The titlebar

- **R3.1** The titlebar shall show the open project's name.
- **R3.2** While a recording is running or paused, the titlebar shall show that
  it is, and how long it has been running.
- **R3.3** While a recording is running or paused, the titlebar shall offer
  pausing or resuming it, and stopping it.
- **R3.4** While no recording is running, the titlebar shall offer starting one.
- **R3.5** The titlebar shall offer opening the settings.
- **R3.6** The titlebar shall offer going back and going forward, and shall show when there is nowhere to go.

## R4 · The rail

- **R4.1** The rail shall offer every pane the window has, as an icon with the
  pane's name.
- **R4.2** The rail shall mark which pane is open.
- **R4.3** The rail shall show the project's content language.
- **R4.4** (ADDED) The rail shall be one stop in the window's tab order, with the
  arrow keys moving between its panes.

## R5 · The status bar

- **R5.1** The status bar shall show the open project's directory.
- **R5.2** (MODIFIED) The shell shall run the checks when the project opens and
  after every write, and the status bar shall show how many findings they
  reported.
- **R5.3** When the user chooses the findings count, the shell shall show the
  checks pane.
- **R5.4** The status bar shall offer undoing the most recent recorded write.
- **R5.5** If there is no recorded write to undo, then the status bar shall say
  so rather than offer it.
- **R5.6** (ADDED) While the checks have not answered, the status bar shall say they are
  running; if a run failed, then the status bar shall say so rather than report a count.

R5.2 was _"shall show how many findings the checks last reported"_, and nothing
ran them: the bar read _not checked yet_ until somebody opened the checks pane,
so the default state of the window said nothing about the wiki's health. The
shell asks once when the project opens, and again on each change it already
coalesces — the same walk the pane makes, moved off the pane's own arrival.
R5.6 is what keeps that honest, because a run in flight and a run that failed are
not a count and must not be shown as one.

## Out of scope

- **The MCP pane.** The rail offers the panes that exist. MCP arrives with its
  own pane in `specs/mcp-pane/`, which is waiting on a server nobody has built.
- **What is inside a pane.** The wiki pane is `specs/wiki-pane/`; sources,
  checks and provenance are groups 5 and 6 of `plans/desktop-ui.md`. This spec
  decides the frame and the routing and nothing that happens within a pane.
- **Switching projects.** The titlebar names the open project; opening a
  different one is `ow` in that directory, and the launcher's job (8.4).
  `adr:0013` makes a project the directory this window was opened on, so there
  is nothing here to rebind.
