import type { Finding } from "@open-wiki/access";
import { CircleAlert, RotateCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { bridge } from "./bridge.js";
import { failed, LOADING, ready, valueOf, type Loaded } from "./loaded.js";
import { groupFindings, whereOf } from "./families.js";
import { PaneBar } from "./PaneBar.js";
import { Button } from "./ui/Button.js";
import { Empty } from "./ui/Empty.js";
import { ICON_SM } from "./ui/icons.js";
import type { PillTone } from "./ui/Pill.js";

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

/**
 * The tone of the count in the bar (uxpass 9.1).
 *
 * **By the worst severity present, never by the count.** It was
 * `findings.length > 0 ? "error" : "ok"`, so a wiki with five warnings and no
 * errors showed a red **5** — the pane one row below drew every one of those
 * five in amber, with a warning icon, on the argument that an error and a
 * warning have to be told apart. The bar said the opposite of the body.
 */
export function toneOfFindings(findings: readonly Finding[]): PillTone {
  if (findings.some((finding) => finding.severity === "error")) return "error";
  return findings.length > 0 ? "warning" : "ok";
}

export function ChecksPane({
  reloadKey,
  onCount,
  actionFor,
  notice,
}: ChecksPaneProps): React.JSX.Element {
  const [loaded, setLoaded] = useState<Loaded<Finding[]>>(LOADING);
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
    setLoaded(LOADING);
    void bridge()
      .findings()
      .then((found) => {
        if (!live) return;
        setLoaded(ready(found));
        report.current?.(found.length);
      })
      .catch((e: unknown) => {
        if (!live) return;
        // **Not an empty list** (8.3). A `findings()` that threw used to become
        // `[]`, which rendered *Nothing to fix.* — a wiki nobody checked,
        // reported as a wiki with nothing wrong. The status bar is left alone
        // for the same reason: a count of zero is a claim.
        setLoaded(failed(e));
      });
    return () => {
      live = false;
    };
  }, [reloadKey, again]);

  const rerun = useCallback(() => setAgain((n) => n + 1), []);
  const findings = valueOf(loaded);
  const groups = findings ? groupFindings(findings) : [];

  return (
    <section className="checks-pane" aria-label="Checks">
      <PaneBar
        title="Checks"
        count={findings?.length ?? null}
        noun="finding"
        countTone={findings ? toneOfFindings(findings) : undefined}
        detail={<span className="pane-bar__note">re-runs on every write</span>}
      >
        <Button icon={RotateCw} onClick={rerun} disabled={loaded.state === "loading"}>
          Run again
        </Button>
      </PaneBar>

      <div className="checks-body">
        {notice}
        {loaded.state === "loading" ? <p className="empty">Checking&hellip;</p> : null}
        {loaded.state === "failed" ? (
          <p className="error">
            The checks could not run: {loaded.why}. Nothing here is a verdict on the wiki.
          </p>
        ) : null}
        {/* uxpass 8.1 — *"Nothing to fix."* was true and said nothing about
            what had been looked at, which is the whole value of a clean run. */}
        {findings && findings.length === 0 ? (
          <Empty title="Nothing to fix">
            <p>
              Every check <code>ow check</code> runs passed on this project: the links resolve, the
              citations point at sources that exist, the vocabulary is the one the glossary names,
              and every page is reachable from the index.
            </p>
            <p>These run again after every write, so this is the state to come back to.</p>
          </Empty>
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

        {findings && findings.length > 0 ? (
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
