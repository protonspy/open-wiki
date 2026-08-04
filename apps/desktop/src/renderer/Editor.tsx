import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageView } from "../main/api.js";
import { bridge, hasBridge } from "./bridge.js";
import { applyCompletion, completionAt, completionsFor, type Completion } from "./completion.js";
import { renderPageBody } from "./markdown.js";
import { Button } from "./ui/Button.js";
import { Pill } from "./ui/Pill.js";

/**
 * Editing a page (plan 8.7 and 8.8, then uxpass group 2).
 *
 * Markdown with a preview, saved through the group 5 validations — which it
 * reaches by calling the store, not by knowing anything about the schema. When
 * the store refuses, the reasons are shown verbatim: 9.13 says the message has
 * three mouths and they have to say the same thing, and paraphrasing here
 * would make this the mouth that says something else.
 *
 * The buffer's *base* is tracked separately from its content. That is 8.8: a
 * save is refused when the file moved under the editor, and what makes the
 * refusal possible is remembering what was loaded rather than assuming it is
 * still there. It is also what makes a dirty state free (uxpass 2.3) — *changed
 * since I opened it* is the same comparison, asked of the buffer instead of the
 * disk.
 *
 * **The buffer is a hook and the actions are their own component.** The pass
 * found two competing action rows on one screen: Save and Cancel floating above
 * the source box while the pane bar four rows up carried its own cluster. One
 * screen gets one action row, so Save and Cancel moved into the bar (2.4) — and
 * a bar rendered by `WikiPane` cannot reach state held inside `Editor`, which is
 * why the buffer lives one level up.
 */

export interface EditorBuffer {
  /** Whether an edit session is open at all. */
  editing: boolean;
  markdown: string;
  setMarkdown: (next: string) => void;
  /** Changed since it was opened — 2.3, and what arms the navigation guard. */
  dirty: boolean;
  busy: boolean;
  problems: string[];
  /** The version on disk, when a save was refused as stale (8.8). */
  conflict: string | null;
  /** Every source id in the project, for completing a citation (2.5). */
  sourceIds: readonly string[];
  save: () => void;
  saveAsCopy: () => void;
  takeTheirs: () => void;
  keepMine: () => void;
}

export function useEditorBuffer({
  page,
  editing,
  onSaved,
}: {
  page: PageView | null;
  editing: boolean;
  onSaved: (markdown: string) => void;
}): EditorBuffer {
  const [markdown, setMarkdown] = useState("");
  const [base, setBase] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sourceIds, setSourceIds] = useState<readonly string[]>([]);

  const slug = page?.slug;
  const opened = page?.markdown ?? "";

  /**
   * The buffer is filled when a session **opens**, and never again.
   *
   * Not on every change to `page`: the watcher reloads the open page whenever
   * anything writes to the project, and re-seeding from that would replace what
   * somebody is in the middle of typing with what the agent just wrote. The
   * disagreement is 8.8's to report at save time, with both versions in hand —
   * silently taking one of them is the loss that whole mechanism exists to
   * prevent.
   */
  const session = editing ? slug : undefined;
  const seed = useRef(opened);
  seed.current = opened;
  useEffect(() => {
    if (session === undefined) return;
    setMarkdown(seed.current);
    setBase(seed.current);
    setProblems([]);
    setConflict(null);
  }, [session]);

  /** The ids a citation may name (2.5), asked for once per session. */
  useEffect(() => {
    if (session === undefined || !hasBridge()) return;
    let live = true;
    void bridge()
      .sources()
      .then((rows) => {
        if (live) setSourceIds(rows.map((row) => row.id));
      })
      // A completion nobody can offer is not a failure worth a red box: the
      // box is still typeable, which is how every citation was written before.
      .catch(() => setSourceIds([]));
    return () => {
      live = false;
    };
  }, [session]);

  /**
   * The third answer to a conflict (6.4): keep both, and name the copy.
   *
   * 8.8's rule is that nothing is picked *silently*, not that there are only
   * two ways out. The copy is a page of its own with a slug of its own, so
   * neither version is lost and the reconciliation is somebody's to do with
   * both in front of them.
   */
  const saveAsCopy = useCallback(async () => {
    if (!slug) return;
    setBusy(true);
    setProblems([]);
    try {
      const result = await bridge().saveAsCopy(slug, markdown);
      if (result.saved) {
        setConflict(null);
        // The editor closes onto the copy, because that is the page the buffer
        // now belongs to — staying on the original with the copy's content in
        // the box is how the next save overwrites the thing this just avoided.
        setBase(result.markdown);
        onSaved(result.markdown);
        return;
      }
      setProblems(result.reason === "stale" ? ["that page moved again"] : result.problems);
    } catch (e) {
      setProblems([e instanceof Error ? e.message : String(e)]);
    } finally {
      setBusy(false);
    }
  }, [markdown, onSaved, slug]);

  const save = useCallback(async () => {
    if (!slug) return;
    setBusy(true);
    setProblems([]);
    setConflict(null);
    try {
      const result = await bridge().save({ slug, markdown, baseMarkdown: base });
      if (result.saved) {
        // What landed, not what was sent — the store completes frontmatter on
        // the way through, and the next save's base has to be the file as it
        // now is or 8.8 would refuse it (5.8).
        setMarkdown(result.markdown);
        setBase(result.markdown);
        onSaved(result.markdown);
        return;
      }
      if (result.reason === "stale") setConflict(result.onDisk);
      else setProblems(result.problems);
    } catch (e) {
      setProblems([e instanceof Error ? e.message : String(e)]);
    } finally {
      setBusy(false);
    }
  }, [base, markdown, onSaved, slug]);

  const takeTheirs = useCallback(() => {
    if (conflict === null) return;
    setMarkdown(conflict);
    setBase(conflict);
    setConflict(null);
  }, [conflict]);

  const keepMine = useCallback(() => {
    if (conflict === null) return;
    // Only re-based, so this buffer wins the next save. The content is left
    // alone, which is the difference between this button and the one above it.
    setBase(conflict);
    setConflict(null);
  }, [conflict]);

  return {
    editing,
    markdown,
    setMarkdown,
    dirty: editing && markdown !== base,
    busy,
    problems,
    conflict,
    sourceIds,
    save: () => void save(),
    saveAsCopy: () => void saveAsCopy(),
    takeTheirs,
    keepMine,
  };
}

/**
 * Save and Cancel, in the pane bar (2.4).
 *
 * **Save is disabled while nothing has changed** (2.3): a button that is always
 * live says nothing about whether there is anything to write, and the dirty mark
 * beside it is the same fact stated so it can be seen rather than inferred.
 */
export function EditorActions({
  buffer,
  onCancel,
}: {
  buffer: EditorBuffer;
  onCancel: () => void;
}): React.JSX.Element {
  return (
    <>
      {buffer.dirty ? <Pill tone="working">unsaved</Pill> : null}
      <Button variant="primary" onClick={buffer.save} disabled={buffer.busy || !buffer.dirty}>
        {buffer.busy ? "Saving…" : "Save"}
      </Button>
      <Button onClick={onCancel} disabled={buffer.busy}>
        Cancel
      </Button>
    </>
  );
}

export function Editor({
  buffer,
  slugs,
}: {
  buffer: EditorBuffer;
  /** Every slug in the wiki, for the preview and for completing a link (2.5). */
  slugs: readonly string[];
}): React.JSX.Element {
  const preview = useMemo(
    () => renderPageBody(stripFrontmatter(buffer.markdown), { slugs }),
    [buffer.markdown, slugs],
  );

  return (
    <div className="editor">
      {buffer.problems.length > 0 ? (
        <div className="error">
          <strong>This page cannot be saved yet:</strong>
          <ul>
            {buffer.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {buffer.conflict !== null ? (
        <Conflict
          onDisk={buffer.conflict}
          busy={buffer.busy}
          onTakeTheirs={buffer.takeTheirs}
          onKeepMine={buffer.keepMine}
          onSaveAsCopy={buffer.saveAsCopy}
        />
      ) : null}

      <div className="editor__panes">
        <Source buffer={buffer} slugs={slugs} />
        <article className="page" dangerouslySetInnerHTML={{ __html: preview }} />
      </div>
    </div>
  );
}

/**
 * The source box, and what it can finish for you (2.5).
 *
 * The popup is a `listbox` the textarea owns through `aria-activedescendant`,
 * rather than a widget focus moves into: taking the focus out of the box
 * somebody is typing in is how a completion menu becomes something to escape
 * from. Every decision it makes — what is being completed, what matches, what
 * the buffer says afterwards — is in `completion.ts`.
 */
function Source({
  buffer,
  slugs,
}: {
  buffer: EditorBuffer;
  slugs: readonly string[];
}): React.JSX.Element {
  const box = useRef<HTMLTextAreaElement>(null);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  const candidates = useMemo(
    () =>
      completion === null ? [] : completionsFor(completion, { slugs, sourceIds: buffer.sourceIds }),
    [completion, slugs, buffer.sourceIds],
  );

  /** Recompute what is being completed from wherever the caret now is. */
  const reconsider = useCallback(() => {
    const element = box.current;
    if (!element) return;
    setCompletion(completionAt(element.value, element.selectionStart));
    setHighlighted(0);
  }, []);

  const take = useCallback(
    (choice: string) => {
      if (!completion) return;
      const next = applyCompletion(buffer.markdown, completion, choice);
      buffer.setMarkdown(next.text);
      setCompletion(null);
      // After React has written the new value, or the caret would be put back
      // where the old one ended.
      requestAnimationFrame(() => {
        const element = box.current;
        if (element) element.setSelectionRange(next.caret, next.caret);
      });
    },
    [buffer, completion],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (candidates.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((at) => {
        const step = event.key === "ArrowDown" ? 1 : -1;
        return (at + step + candidates.length) % candidates.length;
      });
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      const choice = candidates[highlighted];
      if (!choice) return;
      event.preventDefault();
      take(choice);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setCompletion(null);
    }
  };

  const listId = "editor-completions";
  return (
    <div className="editor__source-box">
      <textarea
        ref={box}
        className="editor__source"
        value={buffer.markdown}
        spellCheck={false}
        aria-label="Page source"
        role="combobox"
        aria-expanded={candidates.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          candidates.length > 0 ? `${listId}-${String(highlighted)}` : undefined
        }
        onChange={(event) => {
          buffer.setMarkdown(event.target.value);
          setCompletion(completionAt(event.target.value, event.target.selectionStart));
          setHighlighted(0);
        }}
        onClick={reconsider}
        onKeyUp={reconsider}
        onBlur={() => setCompletion(null)}
        onKeyDown={onKeyDown}
      />
      {candidates.length > 0 ? (
        <ul className="editor__completions" id={listId} role="listbox" aria-label="Completions">
          {candidates.map((candidate, i) => (
            <li
              key={candidate}
              id={`${listId}-${String(i)}`}
              role="option"
              aria-selected={i === highlighted}
              className={i === highlighted ? "editor__completion is-on" : "editor__completion"}
              // `onMouseDown`, not `onClick`: the click would land after the
              // textarea's blur has already closed the list.
              onMouseDown={(event) => {
                event.preventDefault();
                take(candidate);
              }}
            >
              {candidate}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * What 8.8 shows instead of losing the change.
 *
 * It does not merge and it does not overwrite. The editor's job is to make the
 * conflict visible and let the person choose, because the one thing that must
 * not happen is a silent loss — and both versions still exist at this point.
 *
 * **Every button does what it says.** "Load theirs" replaces the buffer, so the
 * other writer's version is what is on screen and what a later save would
 * write. "Keep mine" only re-bases, arming this buffer to win. An earlier
 * version had one button labelled as the first and behaving as the second,
 * which is the silent loss with a reassuring label on it.
 *
 * The third — "Save mine as a copy" (6.4) — is the draft's, and the plan's
 * table kept it against 8.8's refusal on one ground: **a named copy is not a
 * silent pick.** Nothing is lost and nothing is overwritten; there are simply
 * two pages, and reconciling them is somebody's to do with both in front of
 * them.
 */
function Conflict({
  onDisk,
  busy,
  onTakeTheirs,
  onKeepMine,
  onSaveAsCopy,
}: {
  onDisk: string;
  busy: boolean;
  onTakeTheirs: () => void;
  onKeepMine: () => void;
  onSaveAsCopy: () => void;
}): React.JSX.Element {
  return (
    <div className="error">
      <strong>This page changed on disk since you opened it.</strong>
      <p>
        Something else wrote it after you opened it — your agent, or an editor outside this
        application. Nothing has been overwritten: both versions still exist, and this is where you
        choose what happens to them.
      </p>
      <pre>{onDisk}</pre>
      <div className="editor__bar">
        <Button onClick={onTakeTheirs} disabled={busy}>
          Load their version (discards my edits)
        </Button>
        <Button onClick={onSaveAsCopy} disabled={busy}>
          {busy ? "Saving…" : "Save mine as a copy"}
        </Button>
        <Button variant="danger" onClick={onKeepMine} disabled={busy}>
          Keep mine (overwrites theirs on the next save)
        </Button>
      </div>
    </div>
  );
}

/** The preview renders the body, not the frontmatter block. */
function stripFrontmatter(markdown: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/.exec(markdown);
  return match?.[1] ?? markdown;
}
