import { useCallback, useEffect, useState } from "react";
import type { Operation } from "@open-wiki/access";
import type { SourceLocation } from "../main/sources.js";
import { bridge } from "./bridge.js";

/**
 * The panels that hang off the main view: the operation history (8.11) and what
 * a provenance link opens (8.6).
 *
 * Two things that used to be here have left, and for one reason: a pane is now
 * a pane. Where the open page came from (6.5) moved into `Side.tsx` with the
 * wiki pane's side column, and the checks (7.6) moved into `ChecksPane.tsx`
 * when they gained a bar and their groups. Two renderings of one question
 * drift, so neither was copied.
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

/**
 * What a provenance link opens (plan 8.6): audio at the timestamp, a document
 * at the page.
 *
 * The audio element is seeked to the instant rather than started at zero —
 * that difference is the whole task. A citation the recording does not contain
 * says so instead, which is the same answer 5.4 gives when it refuses the
 * citation in the first place.
 */
export function SourceAt({
  id,
  fragment,
  onClose,
}: {
  id: string;
  fragment: string;
  onClose: () => void;
}): React.JSX.Element {
  const [at, setAt] = useState<SourceLocation | null>(null);

  useEffect(() => {
    void bridge()
      .locate(id, fragment)
      .then(setAt)
      .catch((e: unknown) =>
        setAt({ kind: "missing", reason: e instanceof Error ? e.message : String(e) }),
      );
  }, [id, fragment]);

  return (
    <aside className="source-at">
      <div className="editor__bar">
        <strong>
          {id}#{fragment}
        </strong>
        <span className="chrome__spacer" />
        <button onClick={onClose}>Close</button>
      </div>
      {!at ? <p className="empty">Looking…</p> : null}
      {at?.kind === "missing" ? <p className="error">{at.reason}</p> : null}
      {at?.kind === "audio" ? (
        <audio
          controls
          src={fileUrl(at.file)}
          // The instant is the point. `preload` has to be metadata or better,
          // or the seek lands before the browser knows how long the file is.
          preload="metadata"
          onLoadedMetadata={(event) => {
            event.currentTarget.currentTime = at.seconds;
          }}
        />
      ) : null}
      {at?.kind === "document" ? (
        <p className="empty">
          {at.file} — page {at.page}
        </p>
      ) : null}
    </aside>
  );
}

/** A local path as a URL the renderer may load, per the CSP's `media-src`. */
function fileUrl(path: string): string {
  return `file:///${path.replace(/\\/g, "/").replace(/^\/+/, "")}`;
}
