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
/**
 * What the bar says about the checks (uxpass 9.2).
 *
 * **The decision this closes:** the bar read *not checked yet* until somebody
 * opened the checks pane, which is honest and means the default state of the
 * window says nothing at all about the wiki's health — on an application whose
 * whole argument is that a wiki is only worth trusting if something is checking
 * it. So the window now asks once, in the background, and the bar reports three
 * states instead of two.
 *
 * A run that *failed* is still not a verdict, and it does not become one here:
 * it says so, and it is still a way into the pane, where the reason is.
 */
export interface ChecksSummary {
  text: string;
  /** Whether it is a way into the checks pane, or only a sentence. */
  actionable: boolean;
}

export function checksSummary(findings: number | null, failed: boolean): ChecksSummary {
  // Ahead of the count on purpose: a stale number from before a failed re-run
  // would be reported as though it were current.
  if (failed) return { text: "the checks could not run", actionable: true };
  if (findings === null) return { text: "checking…", actionable: false };
  if (findings === 0) return { text: "no findings", actionable: true };
  return {
    text: `${String(findings)} ${findings === 1 ? "finding" : "findings"}`,
    actionable: true,
  };
}

export interface StatusBarProps {
  /** The project directory, to be read off the screen and typed into a shell. */
  root: string;
  /** How many findings the checks last reported; null while none has come back. */
  findings: number | null;
  /** Whether the last attempt to check failed — not the same as none yet. */
  checksFailed?: boolean;
  onGoToChecks: () => void;
  /** Undoing the last recorded write, or null when there is none to undo. */
  onUndo: (() => void) | null;
}

export function StatusBar({
  root,
  findings,
  checksFailed = false,
  onGoToChecks,
  onUndo,
}: StatusBarProps): React.JSX.Element {
  const checks = checksSummary(findings, checksFailed);
  return (
    <footer className="statusbar">
      <span className="statusbar__path">{root}</span>
      <span className="chrome__spacer" />

      {checks.actionable ? (
        <button type="button" className="statusbar__button" onClick={onGoToChecks}>
          {checks.text}
        </button>
      ) : (
        <span>{checks.text}</span>
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
