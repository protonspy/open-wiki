import { useCallback, useEffect, useState } from "react";
import type { Finding, Operation } from "@open-wiki/access";
import type { PageSource, SourceLocation } from "../main/sources.js";
import { bridge } from "./bridge.js";

/**
 * The panels that hang off the main view: the checks (7.6), the operation
 * history (8.11), what a provenance link opens (8.6), and where the open page
 * came from (6.5).
 */

/**
 * Which sources the open page came from (plan 6.5) — the inverse of the sources
 * screen's "cited by" (6.4).
 *
 * It sits on the page itself rather than behind a button, because the question
 * it answers is the one a reader has while they are reading. Clicking one opens
 * the same panel a provenance link in the prose opens, at the source's start.
 *
 * A citation whose source is not there is **shown as broken, not hidden** — the
 * same choice 8.5 makes for a wikilink that does not resolve. Dropping it would
 * leave the reader believing the page is sourced, which is the one wrong answer
 * available here.
 */
export function PageSources({
  slug,
  reloadKey,
  onOpen,
}: {
  slug: string;
  reloadKey: number;
  onOpen: (id: string, fragment: string) => void;
}): React.JSX.Element | null {
  const [sources, setSources] = useState<PageSource[] | null>(null);

  useEffect(() => {
    // Guarded, because following a link is faster than a walk over the wiki:
    // without it the previous page's answer lands on the page now open.
    let live = true;
    void bridge()
      .sourcesOfPage(slug)
      .then((found) => {
        if (live) setSources(found);
      })
      .catch(() => {
        if (live) setSources([]);
      });
    return () => {
      live = false;
    };
  }, [slug, reloadKey]);

  if (!sources || sources.length === 0) return null;

  return (
    <p className="source__cited">
      From{" "}
      {sources.map((source, i) => (
        <span key={source.id}>
          {i > 0 ? ", " : ""}
          {source.kind === null ? (
            <span className="wikilink--broken" title={`there is no source named "${source.id}"`}>
              {source.id}
            </span>
          ) : (
            <a title={source.id} onClick={() => onOpen(source.id, source.fragment)}>
              {source.title}
            </a>
          )}
        </span>
      ))}
    </p>
  );
}

/**
 * The integrity findings (plan 7.6).
 *
 * Rendering, not new checking. Every finding already carries its correction
 * path — the plan's own note says so — so the panel's job is to put the `fix`
 * where the person reading the problem is, and never to invent advice of its
 * own.
 */
export function Findings({ reloadKey }: { reloadKey: number }): React.JSX.Element {
  const [findings, setFindings] = useState<Finding[] | null>(null);

  useEffect(() => {
    void bridge()
      .findings()
      .then(setFindings)
      .catch(() => setFindings([]));
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
