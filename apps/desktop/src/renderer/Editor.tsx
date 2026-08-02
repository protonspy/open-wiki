import { useCallback, useMemo, useState } from "react";
import type { PageView } from "../main/api.js";
import { bridge } from "./bridge.js";
import { renderPageBody } from "./markdown.js";

/**
 * Editing a page (plan 8.7 and 8.8).
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
 * still there.
 */
export function Editor({
  page,
  slugs,
  onSaved,
  onCancel,
}: {
  page: PageView;
  slugs: readonly string[];
  onSaved: (markdown: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [markdown, setMarkdown] = useState(page.markdown);
  const [base, setBase] = useState(page.markdown);
  const [problems, setProblems] = useState<string[]>([]);
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = useMemo(
    () => renderPageBody(stripFrontmatter(markdown), { slugs }),
    [markdown, slugs],
  );

  /**
   * The third answer to a conflict (6.4): keep both, and name the copy.
   *
   * 8.8's rule is that nothing is picked *silently*, not that there are only
   * two ways out. The copy is a page of its own with a slug of its own, so
   * neither version is lost and the reconciliation is somebody's to do with
   * both in front of them.
   */
  const saveAsCopy = useCallback(async () => {
    setBusy(true);
    setProblems([]);
    try {
      const result = await bridge().saveAsCopy(page.slug, markdown);
      if (result.saved) {
        setConflict(null);
        // The editor closes onto the copy, because that is the page the buffer
        // now belongs to — staying on the original with the copy's content in
        // the box is how the next save overwrites the thing this just avoided.
        onSaved(result.markdown);
        return;
      }
      setProblems(result.reason === "stale" ? ["that page moved again"] : result.problems);
    } catch (e) {
      setProblems([e instanceof Error ? e.message : String(e)]);
    } finally {
      setBusy(false);
    }
  }, [markdown, onSaved, page.slug]);

  const save = useCallback(async () => {
    setBusy(true);
    setProblems([]);
    setConflict(null);
    try {
      const result = await bridge().save({ slug: page.slug, markdown, baseMarkdown: base });
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
  }, [base, markdown, onSaved, page.slug]);

  return (
    <div className="editor">
      <div className="editor__bar">
        <button onClick={() => void save()} disabled={busy}>
          Save
        </button>
        <button onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {busy ? <span className="empty">saving…</span> : null}
      </div>

      {problems.length > 0 ? (
        <div className="error">
          <strong>This page cannot be saved yet:</strong>
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {conflict !== null ? (
        <Conflict
          onDisk={conflict}
          busy={busy}
          onTakeTheirs={() => {
            setMarkdown(conflict);
            setBase(conflict);
            setConflict(null);
          }}
          onKeepMine={() => {
            setBase(conflict);
            setConflict(null);
          }}
          onSaveAsCopy={() => void saveAsCopy()}
        />
      ) : null}

      <div className="editor__panes">
        <textarea
          className="editor__source"
          value={markdown}
          spellCheck={false}
          onChange={(event) => setMarkdown(event.target.value)}
        />
        <article className="page" dangerouslySetInnerHTML={{ __html: preview }} />
      </div>
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
        <button onClick={onTakeTheirs} disabled={busy}>
          Load their version (discards my edits)
        </button>
        <button onClick={onSaveAsCopy} disabled={busy}>
          {busy ? "Saving…" : "Save mine as a copy"}
        </button>
        <button className="danger" onClick={onKeepMine} disabled={busy}>
          Keep mine (overwrites theirs on the next save)
        </button>
      </div>
    </div>
  );
}

/** The preview renders the body, not the frontmatter block. */
function stripFrontmatter(markdown: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/.exec(markdown);
  return match?.[1] ?? markdown;
}
