import type { Operation } from "@open-wiki/access";
import { Undo2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { bridge } from "./bridge.js";

import { Button } from "./ui/Button.js";

/**
 * The operation history, with undo (plan 8.11, then desktop-ui 6.2).
 *
 * **Honest about covering only what was observed**, and the note stays at the
 * top of the drawer rather than in a comment: the log records what this
 * application saw — its own writes, and what the hooks reported — so a page an
 * agent wrote through a harness with no hooks configured is not in it. A
 * history presenting itself as complete would be worse than none, because
 * *undo* would silently mean *undo some of it*.
 *
 * Reached from the status bar rather than the rail (6.2), because it is not a
 * place you go: it is something you consult about where you already are.
 */
export function History({ reloadKey }: { reloadKey: number }): React.JSX.Element {
  const [operations, setOperations] = useState<Operation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    void bridge()
      .history()
      .then(setOperations)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(load, [load, reloadKey]);

  const undo = useCallback(
    async (id: string) => {
      setBusy(id);
      setError(null);
      try {
        await bridge().undo(id);
        load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  // One clock for the whole render, so two lines a millisecond apart cannot
  // disagree about whether "today" has ended between them.
  const now = new Date();

  return (
    <div className="history">
      <p className="history__honest">
        Everything this application saw — its own writes, and what the hooks reported. A page
        written through a harness with no hooks is not here.
      </p>
      {error ? <p className="error">{error}</p> : null}

      {operations && operations.length > 0
        ? operations.map((operation) => {
            const line = describeOperation(operation, now);
            return (
              <div key={operation.id} className="hist">
                <span className="hist__what">
                  <span className={`origin origin--${operation.origin}`}>{operation.origin}</span>
                  {line.verb} <code>{line.what}</code>
                </span>
                <Button
                  size="sm"
                  icon={Undo2}
                  disabled={busy !== null}
                  onClick={() => void undo(operation.id)}
                >
                  {busy === operation.id ? "Undoing…" : "Undo"}
                </Button>
                <span className="hist__when">
                  {line.when}
                  {line.also ? ` · ${line.also}` : ""}
                </span>
              </div>
            );
          })
        : null}

      {operations && operations.length === 0 ? (
        <p className="empty">Nothing recorded yet.</p>
      ) : null}
      {!operations && !error ? <p className="empty">Reading the log&hellip;</p> : null}
    </div>
  );
}

/**
 * What one line of the history drawer says (desktop-ui 6.2).
 *
 * **Derived from the operation log and from nothing else.** The log records an
 * id, a time, an origin, and the pages an operation snapshotted — so that is
 * what a line can say. The draft draws more (who the agent was, how many claims
 * changed, an *undone* state with Redo) and none of it is in the record: undo
 * restores files without appending anything, so a line claiming to know an
 * operation was undone would be this screen inventing history in the one panel
 * whose whole promise is that it shows what was observed.
 */

/** The wiki's own records, which are touched *by* operations, never their subject. */
const RECORDS = ["wiki/index.md", "wiki/changelog.md", "wiki/log.md"];

export interface OperationLine {
  /**
   * What happened.
   *
   * `created` when the page did not exist before, `changed` otherwise —
   * **including a delete**, because the log does not tell the two apart: both
   * snapshot a page that existed. Saying "deleted" on a guess would be worse
   * than saying less, and the fix is for the log to carry the verb rather than
   * for this to infer one.
   */
  verb: "created" | "changed";
  /** The page it happened to, by the name a wikilink would use. */
  what: string;
  /** What else the operation touched, or null when it touched nothing else. */
  also: string | null;
  /** Time of day, with the date in front when it was not today. */
  when: string;
}

export function describeOperation(operation: Operation, now: Date): OperationLine {
  const subjects = operation.pages.filter((page) => !RECORDS.includes(page.path.toLowerCase()));
  const records = operation.pages.filter((page) => RECORDS.includes(page.path.toLowerCase()));
  const first = subjects[0];

  return {
    verb: first && !first.existed ? "created" : "changed",
    what: first ? slugOf(first.path) : records[0] ? nameOf(records[0].path) : "nothing",
    also: alsoOf(subjects.length, records.length),
    when: formatWhen(operation.time, now),
  };
}

function alsoOf(subjects: number, records: number): string | null {
  const parts: string[] = [];
  // "and 2 other pages" rather than naming them: the drawer is a list of
  // operations, and a line that grows with the size of a rename stops being one.
  if (subjects > 1) parts.push(`${subjects - 1} other page${subjects === 2 ? "" : "s"}`);
  if (records > 0) parts.push(`the wiki's records`);
  return parts.length === 0 ? null : `also ${parts.join(" and ")}`;
}

function slugOf(path: string): string {
  const base = nameOf(path);
  return base.toLowerCase().endsWith(".md") ? base.slice(0, -3) : base;
}

function nameOf(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * When it happened, read the way somebody scanning a list reads it.
 *
 * Time of day alone for today, because that is the whole of what distinguishes
 * two operations a minute apart — and the date in front once it is not today,
 * because *14:38* on an undated line is a lie by omission the moment the
 * project is a week old.
 *
 * Formatted from the local parts rather than through `toLocaleString`: the
 * drawer's line is compared against a test, and a format that changes with the
 * machine's locale is a format nothing can assert.
 */
export function formatWhen(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, "0");
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  if (sameDay) return clock;
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${clock}`;
}
