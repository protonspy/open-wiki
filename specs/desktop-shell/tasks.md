# Desktop shell — tasks

## 1 · Where the window is

- [x] 1.1 (Unit) Widen `Location` to a pane and a selection, and keep `History`'s stack, cursor and discard-the-future rule working over it — R1.1, R1.2, R1.3, R1.4, R1.5, R1.6
- [x] 1.2 (Unit) Remember the selection each pane was left at, and restore it when that pane is entered without one — R1.7
- [x] 1.3 (Unit) Overlays as state beside the history: one at a time, never recorded as a location, dismissed back onto the location they were opened over, and refusing a navigation while open — R2.1, R2.2, R2.3, R2.4, R2.5
- [x] 1.4 (Unit) The provenance viewer stays beside the page rather than over it, so the paragraph that raised the question is still readable while it is answered — R2.6

## 2 · The frame

- [x] 2.1 (Unit) The titlebar: the project's name, the recording indicator with its elapsed time and its pause, resume and stop controls, the record button, the way into settings, and Back and Forward — R3.1, R3.2, R3.3, R3.4, R3.5, R3.6
- [x] 2.2 (Unit) The icon rail: one entry per pane with its Lucide icon and name, the open one marked, and the project's content language at the foot — R4.1, R4.2, R4.3
- [x] 2.3 (Unit) The status bar: the project's directory, the findings count as the way into the checks pane, and Undo last write — including what it says when there is nothing to undo — R5.1, R5.2, R5.3, R5.4, R5.5
- [x] 2.4 (Unit) Assemble the three into the shell `App` renders, replacing the flat row of text buttons over a single column — R1.2, R4.2

## 9 · The UX pass (`plans/desktop-ui-uxpass.md`)

- [x] 9.1 (Unit) Make the rail one tab stop with arrow movement, per the `tablist` its markup already claimed — R4.4
- [x] 9.2 (Unit) Run the checks when the project opens and after every write, so the bar says something about the wiki's health before anybody goes looking — R5.2
- [x] 9.3 (Unit) Tell a run in flight and a run that failed from a count, in the bar — R5.6

## 10 · The settings become a pane (`plans/settings-pane-and-export.md`)

- [x] 10.1 (Unit) Make `settings` a pane and take it out of the overlays, so it is recorded as a location and Back returns to it — R1.1, R1.2, R2.1
- [x] 10.2 (Unit) Point the titlebar's gear at the pane, and give the rail a Settings tab at its foot that the arrows and `Ctrl`+digit still reach — R3.5, R4.1, R4.5
