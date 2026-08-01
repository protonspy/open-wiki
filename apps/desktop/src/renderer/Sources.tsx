import { useCallback, useEffect, useState } from "react";
import type { SourceRow } from "../main/sources.js";
import { bridge } from "./bridge.js";

/**
 * The sources screen (plan 6.2, 6.3, 6.4, 6.6, 6.7).
 *
 * One row per source with its state, what is missing, and the error when it
 * stopped. Every decision it renders — the stage, the progress, whether
 * anything cites it — is computed in `sources.ts` from the directory itself,
 * so this file arranges and does not derive.
 */
export function Sources({
  onOpenPage,
  reloadKey,
}: {
  onOpenPage: (slug: string) => void;
  reloadKey: number;
}): React.JSX.Element {
  const [rows, setRows] = useState<SourceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await bridge().sources());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (error) return <p className="error">{error}</p>;
  if (!rows) return <p className="empty">Reading the sources…</p>;
  if (rows.length === 0) {
    return (
      <p className="empty">No sources yet. Drop a file on this window, or record something.</p>
    );
  }

  return (
    <ul className="list">
      {rows.map((row) => (
        <SourceItem key={row.id} row={row} onOpenPage={onOpenPage} onChanged={() => void load()} />
      ))}
    </ul>
  );
}

function SourceItem({
  row,
  onOpenPage,
  onChanged,
}: {
  row: SourceRow;
  onOpenPage: (slug: string) => void;
  onChanged: () => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  /**
   * 6.3 — transcribe, or finish what stopped.
   *
   * "Redo only what failed" needs no flag: a resume sends exactly what did not
   * succeed, which is the default and the whole point of the journal
   * (`adr:0012`). The label says which of the two it is about to do, because
   * "Transcribe" on a recording that is nine chunks in reads as starting over.
   */
  const transcribe = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await bridge().transcribe(row.id);
      setNote(
        result.ok
          ? result.sealed
            ? "Transcribed."
            : `${result.done} of ${result.total} chunks done.`
          : result.reason,
      );
      onChanged();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [row.id, onChanged]);

  // 6.7 — the title is correctable, which is what makes the frozen id bearable
  // (`adr:0011`). It never moves the directory or touches a citation.
  const retitle = useCallback(async () => {
    const next = globalThis.prompt?.("Title for this source", row.title);
    if (!next || next === row.title) return;
    setBusy(true);
    try {
      await bridge().retitle(row.id, next);
      onChanged();
    } finally {
      setBusy(false);
    }
  }, [row.id, row.title, onChanged]);

  return (
    <li className="source">
      <div className="source__head">
        <span className="source__title">{row.title}</span>
        <code className="source__id">{row.id}</code>
        <Stage row={row} />
        {/* 6.6 — the case that disappears from view on its own. */}
        {row.uncited ? <span className="badge badge--warn">nothing cites this</span> : null}
        <span className="chrome__spacer" />
        {row.kind === "recording" && !row.textReady ? (
          <button onClick={() => void transcribe()} disabled={busy}>
            {busy ? "Transcribing…" : row.progress ? "Finish transcribing" : "Transcribe"}
          </button>
        ) : null}
        <button onClick={() => void retitle()} disabled={busy}>
          Rename
        </button>
      </div>
      {row.error ? <p className="error">{row.error}</p> : null}
      {note ? <p className="empty">{note}</p> : null}
      {/* 6.4 — from a source to the pages that cite it. */}
      {row.citedBy.length > 0 ? (
        <p className="source__cited">
          Cited by{" "}
          {row.citedBy.map((slug, i) => (
            <span key={slug}>
              {i > 0 ? ", " : ""}
              <a onClick={() => onOpenPage(slug)}>{slug}</a>
            </span>
          ))}
        </p>
      ) : null}
    </li>
  );
}

/** The stage, and the per-chunk progress 6.3 asks for while one is in flight. */
function Stage({ row }: { row: SourceRow }): React.JSX.Element {
  if (row.progress) {
    return (
      <span className={`badge badge--${row.stage}`}>
        {row.stage} {row.progress.done}/{row.progress.total}
      </span>
    );
  }
  return <span className={`badge badge--${row.stage}`}>{row.stage}</span>;
}
