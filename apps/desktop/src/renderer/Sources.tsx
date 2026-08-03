import { AudioLines, FileText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { SourceStage } from "@open-wiki/access";
import { humanBytes } from "@open-wiki/access/format";
import type { SourceBrowse, SourceRow } from "../main/sources.js";
import { startFragment } from "../shared/sources.js";
import { useDialogs, type Dialogs } from "./Ask.js";
import { bridge } from "./bridge.js";
import { retitleQuestion } from "./dialogs.js";
import { PaneBar } from "./PaneBar.js";
import { Button } from "./ui/Button.js";
import { ICON_SM } from "./ui/icons.js";
import { Pill, type PillTone } from "./ui/Pill.js";
import { Table, type Column } from "./ui/Table.js";

/**
 * The sources pane (plan 6.2 to 6.7, then desktop-ui 5.1).
 *
 * One row per source with its state, what is missing, and the error when it
 * stopped. Every decision it renders — the stage, the progress, whether
 * anything cites it — is computed in `sources.ts` from the directory itself,
 * so this file arranges and does not derive.
 *
 * It is a table now rather than a list of headings, which is what the draft
 * draws and what the content is: five facts per source, the same five each
 * time, compared down a column rather than read one row at a time.
 */

const COLUMNS: readonly Column[] = [
  { header: "Source", width: "34%" },
  { header: "State", width: "20%" },
  { header: "Progress", width: "20%" },
  { header: "Size", width: "8%", align: "right" },
  { header: "Cited", width: "8%", align: "right" },
  { header: "", align: "right" },
];

/**
 * The pill a stage wears.
 *
 * `received` is neutral because it is not a problem — a source that arrived a
 * minute ago has not failed at anything. `cited` gets its own tone, which is
 * the draft's: being cited is the state this whole product is for.
 */
export function toneOfStage(stage: SourceStage): PillTone {
  switch (stage) {
    case "cited":
      return "cited";
    case "text-ready":
      return "ok";
    case "transcribing":
      return "working";
    case "failed":
      return "error";
    default:
      return "neutral";
  }
}

/** One cell of the progress bar. */
export type ChunkCell = "done" | "doing" | "pending";

/**
 * The progress bar's cells (6.3).
 *
 * **A quantity, not a map of which chunk is which.** `SourceRow.progress`
 * carries `done` and `total` and nothing per chunk, so the cells say *four of
 * six are done* and no cell claims to be the one that failed — the row's error
 * line says what stopped, and painting a particular cell red would be this
 * screen inventing a fact the journal has and the row does not.
 *
 * The cell after the done ones pulses only while a run is actually in flight.
 * A stopped transcription four chunks in is not a transcription doing anything,
 * and an animation saying otherwise is the difference between "come back later"
 * and "press the button".
 */
export function chunkCells(
  progress: { done: number; total: number } | undefined,
  running: boolean,
): ChunkCell[] {
  if (!progress || progress.total <= 0) return [];
  const done = Math.max(0, Math.min(progress.done, progress.total));
  return Array.from({ length: progress.total }, (_, i) => {
    if (i < done) return "done";
    return running && i === done ? "doing" : "pending";
  });
}

export function Sources({
  onOpenPage,
  onOpenSource,
  reloadKey,
}: {
  onOpenPage: (slug: string) => void;
  /** 8.6's panel, at the source's own start — the row's way in. */
  onOpenSource: (id: string, fragment: string) => void;
  reloadKey: number;
}): React.JSX.Element {
  const [rows, setRows] = useState<SourceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One for the screen rather than one per row: only one row can be asked
  // about at a time, because the box is modal.
  const { ask, element: dialog } = useDialogs();

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

  return (
    <section className="sources-pane" aria-label="Sources">
      <PaneBar title="Sources" count={rows?.length ?? null} noun="source" />

      <div className="sources-body">
        {error ? <p className="error">{error}</p> : null}
        {!error && !rows ? <p className="empty">Reading the sources&hellip;</p> : null}
        {rows && rows.length === 0 ? (
          <p className="empty">No sources yet. Drop a file on this window, or record something.</p>
        ) : null}

        {rows && rows.length > 0 ? (
          <Table columns={COLUMNS}>
            {rows.map((row) => (
              <SourceItem
                key={row.id}
                row={row}
                ask={ask}
                onOpenPage={onOpenPage}
                onOpenSource={onOpenSource}
                onChanged={() => void load()}
              />
            ))}
          </Table>
        ) : null}
      </div>
      {dialog}
    </section>
  );
}

function SourceItem({
  row,
  ask,
  onOpenPage,
  onOpenSource,
  onChanged,
}: {
  row: SourceRow;
  ask: Dialogs["ask"];
  onOpenPage: (slug: string) => void;
  onOpenSource: (id: string, fragment: string) => void;
  onChanged: () => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** 6.4 — which pages cite this, opened from the count rather than always on. */
  const [showCiting, setShowCiting] = useState(false);
  /** 7.5 — the files this source holds, fetched when somebody asks to see them. */
  const [browse, setBrowse] = useState<SourceBrowse | null>(null);
  const [showFiles, setShowFiles] = useState(false);

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
    const next = await ask(retitleQuestion(row.title));
    if (!next || next === row.title) return;
    setBusy(true);
    setNote(null);
    try {
      await bridge().retitle(row.id, next);
      onChanged();
    } catch (e) {
      // 1.5 — on this row. A refused retitle used to reject into nothing at
      // all: the `finally` cleared the busy flag and the button simply came
      // back, with the old title still on screen and no reason given.
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [ask, row.id, row.title, onChanged]);

  /**
   * 7.1 — declaring a source read by hand, or withdrawing it.
   *
   * Through the same single manifest mutator the CLI's `ow source mark` uses
   * (`specs/source-status` R2.1), so the two doors cannot disagree about what
   * a declaration is.
   */
  const mark = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      await bridge().markSource(row.id, row.processed === undefined);
      onChanged();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [row.id, row.processed, onChanged]);

  /**
   * 7.5 — seeing what arrived.
   *
   * Reading a source is the agent's job; this is how a person knows the upload
   * was what they meant — that the zip really was the repository and not last
   * month's one. Fetched on the first open rather than with the row, because a
   * tree is thousands of entries and twenty rows must not carry twenty of them.
   */
  const toggleFiles = useCallback(async () => {
    if (showFiles) {
      setShowFiles(false);
      return;
    }
    setShowFiles(true);
    if (browse) return;
    try {
      setBrowse(await bridge().browseSource(row.id));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
      setShowFiles(false);
    }
  }, [showFiles, browse, row.id]);

  const cells = chunkCells(row.progress, busy);

  return (
    <>
      <tr className={row.error ? "row--error" : undefined}>
        <td>
          <span className="src-name">
            {row.kind === "recording" ? (
              <AudioLines size={ICON_SM} aria-hidden />
            ) : (
              <FileText size={ICON_SM} aria-hidden />
            )}
            {row.title}
            {/* The frozen id, when it is not simply the title again — a file
                keeps its filename, so repeating it would be noise. */}
            {row.id !== row.title ? <code className="src-name__id">{row.id}</code> : null}
          </span>
          {/* 8.1 — what the agent learned about this source. The row this
              whole group exists for is the one whose only readable field is
              `fnd348r34nr483r.txt`; a description is what makes it a row
              somebody can act on. */}
          {row.description ? <span className="src-name__note">{row.description}</span> : null}
          {row.error ? <span className="src-name__error">{row.error}</span> : null}
          {note ? <span className="src-name__note">{note}</span> : null}
        </td>

        <td>
          <Pill tone={toneOfStage(row.stage)}>{row.stage}</Pill>{" "}
          {/* 6.6 — the case that disappears from view on its own. Hollow and
              dashed, because its failure mode is going unnoticed among the
              filled pills beside it. */}
          {row.uncited ? <Pill tone="uncited">nothing cites this</Pill> : null}{" "}
          {/* specs/source-status — the one declared fact. It is beside the
              stage rather than inside it because every other member of that
              field is observed on disk and this one is a judgement. */}
          {row.processed ? <Pill tone="ok">read {row.processed}</Pill> : null}{" "}
          {/* 7.6 — a citation into replaced evidence resolving silently is the
              outcome supersession exists to prevent, so it is said wherever the
              source is shown and not only where somebody goes looking. */}
          {row.superseded ? (
            <Pill tone="uncited">
              replaced{row.superseded.by ? ` by ${row.superseded.by}` : ""}
            </Pill>
          ) : null}{" "}
          {/* 6.6 — an unpack that never finished. The tree beside this source
              is part of an archive rather than all of one. */}
          {row.incomplete ? <Pill tone="error">unpack unfinished</Pill> : null}
        </td>

        <td>
          {cells.length > 0 ? (
            <span className="chunks">
              {cells.map((cell, i) => (
                <i key={i} className={cell === "pending" ? "chunk" : `chunk chunk--${cell}`} />
              ))}
              <span className="chunks__label">
                {row.progress?.done} / {row.progress?.total}
              </span>
            </span>
          ) : null}
        </td>

        <td className="table__num">{row.bytes > 0 ? humanBytes(row.bytes) : "—"}</td>

        <td className="table__num">
          {row.citedBy.length === 0 ? (
            "—"
          ) : (
            <button
              type="button"
              className="table__count"
              aria-expanded={showCiting}
              onClick={() => setShowCiting((open) => !open)}
            >
              {row.citedBy.length}
            </button>
          )}
        </td>

        <td className="table__actions">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onOpenSource(row.id, startFragment(row.kind))}
          >
            Open
          </Button>
          {row.kind === "recording" && !row.textReady ? (
            <Button size="sm" variant="ghost" onClick={() => void transcribe()} disabled={busy}>
              {busy ? "Transcribing…" : row.progress ? "Finish transcribing" : "Transcribe"}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => void retitle()} disabled={busy}>
            Rename
          </Button>
          {/* 7.1 — the second of the two actions that are not the agent's. A
              person read this outside the loop, or disagrees with a mark the
              agent made; `ow source mark` is the same act through the other
              door. */}
          <Button size="sm" variant="ghost" onClick={() => void mark()} disabled={busy}>
            {row.processed ? "Mark unread" : "Mark read"}
          </Button>
          {/* 7.5 — what this source actually holds. */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void toggleFiles()}
            aria-expanded={showFiles}
          >
            Files
          </Button>
        </td>
      </tr>

      {/* 7.5 — the files it holds, an unpacked archive as a tree. */}
      {showFiles && browse ? (
        <tr>
          <td colSpan={COLUMNS.length} className="table__detail">
            {browse.incomplete ? (
              <span className="src-name__error">
                This archive was never fully unpacked, so what is below is part of it.
              </span>
            ) : null}
            <ul className="source-tree__list">
              {browse.entries.map((entry) => (
                <li key={entry.path} className={entry.kind === "dir" ? "is-dir" : undefined}>
                  <span className="source-tree__path">{entry.path}</span>
                  {entry.kind === "file" ? (
                    <span className="source-tree__size">{humanBytes(entry.bytes ?? 0)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
            {browse.truncated > 0 ? <span>{browse.truncated} more not shown.</span> : null}
          </td>
        </tr>
      ) : null}

      {/* 6.4 — from a source to the pages that cite it. A row of its own rather
          than a fifth thing in the first cell: it is a list, and it is only
          there when it was asked for. */}
      {showCiting && row.citedBy.length > 0 ? (
        <tr>
          <td colSpan={COLUMNS.length} className="table__detail">
            Cited by{" "}
            {row.citedBy.map((slug, i) => (
              <span key={slug}>
                {i > 0 ? ", " : ""}
                <a onClick={() => onOpenPage(slug)}>{slug}</a>
              </span>
            ))}
          </td>
        </tr>
      ) : null}
    </>
  );
}
