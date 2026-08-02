import { useCallback, useEffect, useState } from "react";
import type { Operation } from "@open-wiki/access";
import { bridge } from "./bridge.js";

/**
 * The operation history (plan 8.11), which is what is left here.
 *
 * Three things that used to share this file have gone to their own, for one
 * reason: a pane is now a pane, with a bar and a body that scrolls. Where the
 * open page came from (6.5) went to `Side.tsx`, the checks (7.6) to
 * `ChecksPane.tsx`, and what a citation opens (8.6) to `SourceAt.tsx` when it
 * gained a transport. None was copied — two renderings of one question drift.
 */

/**
 * The operation history, with undo (plan 8.11).
 *
 * **Honest about covering only what was observed.** The log records what this
 * application saw — its own writes, and what the hooks reported — and a page
 * an agent wrote through a harness with no hooks configured is not in it. A
 * history that presented itself as complete would be worse than none, because
 * "undo" would silently mean "undo some of it".
 */
export function History({ reloadKey }: { reloadKey: number }): React.JSX.Element {
  const [operations, setOperations] = useState<Operation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void bridge()
      .history()
      .then(setOperations)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(load, [load, reloadKey]);

  const undo = useCallback(
    async (id: string) => {
      try {
        await bridge().undo(id);
        load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [load],
  );

  return (
    <div className="history">
      <p className="empty">
        Everything this application saw — its own writes, and what the hooks reported. A page
        written through a harness with no hooks is not here.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {operations && operations.length > 0 ? (
        <ul className="list">
          {operations.map((operation) => (
            <li key={operation.id} className="operation">
              <span className="operation__time">{operation.time}</span>
              <span className={`badge badge--${operation.origin}`}>{operation.origin}</span>
              <span className="operation__pages">
                {operation.pages.map((page) => page.path).join(", ")}
              </span>
              <span className="chrome__spacer" />
              <button onClick={() => void undo(operation.id)}>Undo</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">Nothing recorded yet.</p>
      )}
    </div>
  );
}
