/**
 * The status bar (spec `desktop-shell`, R5).
 *
 * Three facts, and each is a fact somebody needs without asking for it: which
 * directory this window is actually looking at, whether the checks found
 * anything, and a way back from the last write.
 *
 * **The findings count is handed in, never computed here.** `ow check` walks
 * the whole project, and running it to fill a number in the frame is how a
 * status bar becomes the slowest thing in the window. Until the checks pane has
 * loaded once there is no count, and the bar says that rather than showing a
 * confident zero (R5.2) — "no findings" and "not looked yet" are not the same
 * sentence, and the second one dressed as the first is the more dangerous of
 * the two.
 */
export interface StatusBarProps {
  /** The project directory, to be read off the screen and typed into a shell. */
  root: string;
  /** How many findings the checks last reported; null until they have run. */
  findings: number | null;
  onGoToChecks: () => void;
  /** Undoing the last recorded write, or null when there is none to undo. */
  onUndo: (() => void) | null;
}

export function StatusBar({
  root,
  findings,
  onGoToChecks,
  onUndo,
}: StatusBarProps): React.JSX.Element {
  return (
    <footer className="statusbar">
      <span className="statusbar__path">{root}</span>
      <span className="chrome__spacer" />

      {findings === null ? (
        <span>not checked yet</span>
      ) : (
        <button type="button" className="statusbar__button" onClick={onGoToChecks}>
          {findings === 0
            ? "no findings"
            : `${findings} ${findings === 1 ? "finding" : "findings"}`}
        </button>
      )}

      {onUndo ? (
        <button type="button" className="statusbar__button" onClick={onUndo}>
          Undo last write
        </button>
      ) : (
        // Said rather than offered (R5.5). A disabled button invites a click
        // and then explains nothing; this explains and invites nothing.
        <span>nothing to undo</span>
      )}
    </footer>
  );
}
