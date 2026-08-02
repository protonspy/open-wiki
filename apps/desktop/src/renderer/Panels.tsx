import { useCallback, useEffect, useRef, useState } from "react";
import type { Finding, Operation } from "@open-wiki/access";
import type { SourceLocation } from "../main/sources.js";
import { bridge } from "./bridge.js";

/**
 * The panels that hang off the main view: the checks (7.6), the operation
 * history (8.11) and what a provenance link opens (8.6).
 *
 * Where the open page came from (6.5) used to be here too. It moved into
 * `Side.tsx` when the wiki pane gained a side column, because that is now the
 * only place it is shown and two renderings of one question drift.
 */

/**
 * The integrity findings (plan 7.6).
 *
 * Rendering, not new checking. Every finding already carries its correction
 * path — the plan's own note says so — so the panel's job is to put the `fix`
 * where the person reading the problem is, and never to invent advice of its
 * own.
 */
export function Findings({
  reloadKey,
  onCount,
}: {
  reloadKey: number;
  /**
   * How many there were, for the status bar (spec `desktop-shell`, R5.2).
   *
   * Handed up from this one load rather than counted again: `ow check` walks
   * the whole project, and running it a second time to fill in a number in the
   * frame is how a status bar becomes the slowest thing in the window.
   */
  onCount?: (count: number) => void;
}): React.JSX.Element {
  const [findings, setFindings] = useState<Finding[] | null>(null);
  // Read through a ref so the effect below depends on `reloadKey` alone. A
  // caller passing a fresh closure each render would otherwise re-run the
  // whole check on every render.
  const report = useRef(onCount);
  report.current = onCount;

  useEffect(() => {
    // Guarded, like `PageSources` above and for a sharper reason: two
    // `reloadKey` bumps can overlap, and a slow answer for the older one
    // arriving last would put a stale count in the status bar as well as stale
    // findings on screen.
    let live = true;
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
  }, [reloadKey]);

  if (!findings) return <p className="empty">Checking…</p>;
  if (findings.length === 0) return <p className="empty">Nothing to fix.</p>;

  return (
    <ul className="list findings">
      {findings.map((finding, i) => (
        <li key={`${finding.code}-${i}`} className={`finding finding--${finding.severity}`}>
          <div className="finding__head">
            <code>{finding.code}</code>
            <span className="finding__where">
              {finding.page ?? finding.source ?? ""}
              {finding.line ? `:${finding.line}` : ""}
            </span>
          </div>
          <p>{finding.message}</p>
          <p className="finding__fix">{finding.fix}</p>
        </li>
      ))}
    </ul>
  );
}

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
