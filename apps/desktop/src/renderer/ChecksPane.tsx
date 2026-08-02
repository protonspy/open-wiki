import type { Finding } from "@open-wiki/access";
import { CircleAlert, RotateCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { bridge } from "./bridge.js";
import { groupFindings, whereOf } from "./families.js";
import { PaneBar } from "./PaneBar.js";
import { Button } from "./ui/Button.js";
import { ICON_SM } from "./ui/icons.js";

/**
 * The checks pane (plan 7.6, then desktop-ui 5.2).
 *
 * **Rendering, not new checking.** Every finding already carries its correction
 * path — `fix`, required on every one — so this puts that where the person
 * reading the problem is and never invents advice of its own.
 *
 * Grouped by family with the task that owns it (`families.ts`), which is the
 * draft's shape and not decoration: a flat list is a list of unrelated
 * complaints, and grouped it says *the links are fine and the vocabulary is
 * not*, which is what somebody decides what to fix from.
 */
export interface ChecksPaneProps {
  reloadKey: number;
  /**
   * How many there were, for the status bar (spec `desktop-shell`, R5.2).
   *
   * Handed up from this one load rather than counted again: `ow check` walks
   * the whole project, and running it a second time to fill in a number in the
   * frame is how a status bar becomes the slowest thing in the window.
   */
  onCount?: (count: number) => void;
  /** What a finding's fix button does, when it has one (5.3). */
  actionFor?: (finding: Finding) => React.ReactNode;
  /** What this pane has to say — a fix that failed, most of the time (1.5). */
  notice?: React.ReactNode;
}

export function ChecksPane({
  reloadKey,
  onCount,
  actionFor,
  notice,
}: ChecksPaneProps): React.JSX.Element {
  const [findings, setFindings] = useState<Finding[] | null>(null);
  // Read through a ref so the effect below depends on its inputs alone. A
  // caller passing a fresh closure each render would otherwise re-run the whole
  // check on every render.
  const report = useRef(onCount);
  report.current = onCount;
  /** Bumped by "Run again", so the same folder can be checked twice. */
  const [again, setAgain] = useState(0);

  useEffect(() => {
    // Guarded: two `reloadKey` bumps can overlap, and a slow answer for the
    // older one arriving last would put a stale count in the status bar as well
    // as stale findings on screen.
    let live = true;
    setFindings(null);
    void bridge()
      .findings()
      .then((found) => {
        if (!live) return;
        setFindings(found);
        report.current?.(found.length);
      })
      .catch(() => {
        if (!live) return;
        setFindings([]);
        report.current?.(0);
      });
    return () => {
      live = false;
    };
  }, [reloadKey, again]);

  const rerun = useCallback(() => setAgain((n) => n + 1), []);
  const groups = findings ? groupFindings(findings) : [];

  return (
    <section className="checks-pane" aria-label="Checks">
      <PaneBar
        title="Checks"
        count={findings?.length ?? null}
        countTone={findings && findings.length > 0 ? "error" : "ok"}
        detail={<span className="pane-bar__note">re-runs on every write</span>}
      >
        <Button icon={RotateCw} onClick={rerun} disabled={findings === null}>
          Run again
        </Button>
      </PaneBar>

      <div className="checks-body">
        {notice}
        {findings === null ? <p className="empty">Checking&hellip;</p> : null}
        {findings !== null && findings.length === 0 ? (
          <p className="empty">Nothing to fix.</p>
        ) : null}

        {groups.map(({ family, findings: inFamily }) => (
          <div key={family.key} className="check-group">
            <h4>
              {family.title} <span className="task-tag">{family.task}</span>
            </h4>
            {inFamily.map((finding, i) => (
              <Check
                key={`${finding.code}-${whereOf(finding)}-${i}`}
                finding={finding}
                action={actionFor?.(finding)}
              />
            ))}
          </div>
        ))}

        {findings !== null && findings.length > 0 ? (
          <p className="checks-body__note">
            Every check here is also what <code>ow check</code> runs, so an agent can run it on its
            own work before it says it is finished — the same groups, the same wording.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Check({
  finding,
  action,
}: {
  finding: Finding;
  action?: React.ReactNode;
}): React.JSX.Element {
  const where = whereOf(finding);
  return (
    <div className={`check check--${finding.severity}`}>
      {/* Two icons, not one in two colours: an error and a warning have to be
          told apart by somebody who cannot tell the two colours apart. */}
      {finding.severity === "error" ? (
        <CircleAlert size={ICON_SM} aria-hidden />
      ) : (
        <TriangleAlert size={ICON_SM} aria-hidden />
      )}
      <span className="check__what">
        {finding.message}
        <span className="check__fix">{finding.fix}</span>
        {where ? <span className="check__where">{where}</span> : null}
      </span>
      {action ?? null}
    </div>
  );
}
