import { MessageSquarePlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ChatEditPreview, ChatEvent } from "../main/agent/chat-events.js";
import { bridge } from "./bridge.js";
import {
  chatAnnouncement,
  chatReducer,
  composerDisabled,
  composerPlaceholder,
  editableOf,
  initialChat,
  interruptShortcut,
  proposalOf,
  type ChatState,
  type EditableField,
  type Interrupt,
  type Message,
  type Proposal,
} from "./chat-model.js";
import { sideOf, wordDiff, type DiffSpan } from "./diff.js";
import { PaneBar } from "./PaneBar.js";
import { Button } from "./ui/Button.js";
import { Empty } from "./ui/Empty.js";

/**
 * The chat pane (specs/embedded-agent, R1). The embedded agent's window into
 * the project: the renderer sends a message over `chat:send` and renders the
 * stream the main process pushes over `chat:event`. The model and the Groq key
 * stay in main (R2.1, R2.7) — this component never sees either.
 *
 * Thin by design. The half that decides what to show — folding the event
 * stream into a conversation, reading the write proposal off the tool args —
 * is {@link chat-model.ts}, tested without a DOM. What is here is wiring: a
 * reducer, a subscription, a composer, and the approve/reject/edit card a
 * paused write surfaces (R5).
 *
 * One conversation per window: a `threadId` generated for the component's life
 * (R7.1). In-memory for v1; the conversation does not survive a restart.
 */

export interface ChatProps {
  /** Open the settings sheet — the empty state links here when no key is set (R1.3). */
  onOpenSettings: () => void;
  /** Re-check the credential when the pane becomes active (a key saved in settings). */
  active: boolean;
}

export function Chat({ onOpenSettings, active }: ChatProps): React.JSX.Element {
  const [state, dispatch] = useReducer(chatReducer, initialChat);
  // null = not checked yet; true/false once the credential is known.
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  // One conversation per window (R7.1) — and a new one on request (uxpass 6.1),
  // which is why this is a state rather than a constant. The transcript and the
  // thread id are replaced together: a cleared window still addressing the
  // checkpointed thread would show nothing while the agent remembered
  // everything.
  const [threadId, setThreadId] = useState(() => crypto.randomUUID());
  /** Which model the agent is running (uxpass 6.1) — chosen in Settings. */
  const [model, setModel] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // The stream subscription lives for the component's life; the reducer is the
  // stable sink, so the handler does not need to re-bind on every render.
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  useEffect(
    () =>
      bridge().onChatEvent((event) =>
        dispatchRef.current({ type: "event", event: event as ChatEvent }),
      ),
    [],
  );

  // Re-check the credential whenever the pane is shown — a key saved in the
  // settings sheet is not a project change, so it does not arrive any other
  // way (R1.3, R2.4).
  const checkKey = useCallback(async () => {
    try {
      const c = await bridge().credential();
      setHasKey(c.provider === "groq" && c.hasKey);
    } catch {
      setHasKey(false);
    }
    // uxpass 6.1 — the model is chosen in Settings and was never shown where it
    // is used, though `agentModels()` has been on the bridge the whole time.
    // Re-read with the credential, because choosing one is not a project change
    // and arrives no other way.
    try {
      setModel((await bridge().agentModels()).selectedModel);
    } catch {
      setModel(null);
    }
  }, []);
  useEffect(() => {
    if (active) void checkKey();
  }, [active, checkKey]);

  // Keep the tail of the conversation in view as tokens arrive.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages, state.interrupt]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || hasKey !== true || state.running) return;
    dispatch({ type: "send", text });
    setDraft("");
    try {
      const res = await bridge().chatSend({ text, threadId });
      setRunId(res.runId);
    } catch (e) {
      dispatchRef.current({
        type: "event",
        event: { kind: "error", threadId, runId: runId ?? "", message: messageOf(e) },
      });
    }
  }, [draft, hasKey, state.running, threadId, runId]);

  const resume = useCallback(
    async (decisions: unknown[]) => {
      const interrupt = state.interrupt;
      if (!interrupt) return;
      dispatch({ type: "resume" });
      try {
        const res = await bridge().chatResume({
          threadId,
          decisions,
          interruptId: interrupt.interruptId,
          runId: interrupt.runId,
        });
        setRunId(res.runId);
      } catch (e) {
        dispatchRef.current({
          type: "event",
          event: { kind: "error", threadId, runId: interrupt.runId, message: messageOf(e) },
        });
      }
    },
    [state.interrupt, threadId],
  );

  const cancel = useCallback(() => {
    if (runId) void bridge().chatCancel({ runId });
  }, [runId]);

  /**
   * A new conversation (uxpass 6.1).
   *
   * The transcript and the thread id go together — see the note on `threadId`.
   * A run in flight is stopped first, because the events of a cancelled run
   * would otherwise arrive into the transcript that replaced it.
   */
  const startOver = useCallback(() => {
    if (runId) void bridge().chatCancel({ runId });
    setRunId(null);
    setDraft("");
    setThreadId(crypto.randomUUID());
    dispatch({ type: "reset" });
  }, [runId]);

  // Before the pane can be a pane at all: no answer yet, or no key. Both keep
  // the padded frame `main--bleed` no longer supplies.
  if (hasKey === null) {
    return (
      <div className="chat chat--gate">
        <p className="empty">Checking the agent&hellip;</p>
      </div>
    );
  }

  if (hasKey === false) {
    return (
      <div className="chat chat--gate">
        <EmptyAgent onOpenSettings={onOpenSettings} />
      </div>
    );
  }

  return (
    <div className="chat">
      {/* uxpass 4.2 — the boundaries of a turn, and the moment it stops for a
          decision. Nothing else in this window changes as much without anybody
          touching it, and the only signal there was is a placeholder that
          disappears when somebody types. Always in the document, because a live
          region nobody was watching announces nothing. */}
      <p className="visually-hidden" role="status" aria-live="polite">
        {chatAnnouncement(state)}
      </p>

      {/* uxpass 6.1 — every other pane has a bar; this one had no title, no
          model and no way to start again. The model is chosen in Settings and
          was never shown where it is used. */}
      <PaneBar
        title="Chat"
        detail={
          model ? (
            <code className="pane-bar__path">{model}</code>
          ) : (
            <span className="pane-bar__note">the agent&rsquo;s model is set in Settings</span>
          )
        }
      >
        <Button
          icon={MessageSquarePlus}
          onClick={startOver}
          disabled={state.messages.length === 0 && !state.running}
        >
          New conversation
        </Button>
      </PaneBar>

      <div className="chat__scroll" ref={scroller}>
        {state.messages.length === 0 ? (
          /* uxpass 8.1 — one grey sentence over 570px of void, saying nothing
             about what this pane can do or what asking it looks like. */
          <Empty title="The agent, in this window">
            <p>
              It reads this project and writes the wiki through the same gate the editor uses,
              pausing for your approval on every write — nothing lands without you seeing it first.
            </p>
            <p>Ask it for something:</p>
            <ul className="empty-state__examples">
              <li>
                <code>read raw/ and write a page about the cutover</code>
              </li>
              <li>
                <code>what does this project already say about retention?</code>
              </li>
              <li>
                <code>fix the broken links the checks pane found</code>
              </li>
            </ul>
          </Empty>
        ) : (
          state.messages.map((m, i) => <Turn key={i} message={m} />)
        )}
        {/* uxpass 6.6 — the working state was the composer's placeholder, which
            disappears the moment anybody types into the box. It is an element
            in the transcript now, where the answer is going to appear. */}
        {state.running ? (
          <p className="chat__working">
            <span className="chat__working-dot" aria-hidden />
            The agent is working&hellip;
          </p>
        ) : null}
        {state.error ? <p className="error">{state.error}</p> : null}
        {state.interrupt ? (
          // Keyed by the interrupt, so a replacement proposal remounts the card.
          // Without a key React reuses the instance and its local `editing`
          // survives — the textarea would still hold text derived from the
          // superseded proposal, and `Send edited` would post the new action's
          // args with the old proposal's value. That is precisely the clobber
          // the re-propose in R5.5 exists to prevent, reintroduced in the UI.
          <InterruptCard
            key={`${state.interrupt.runId}:${state.interrupt.interruptId}`}
            interrupt={state.interrupt}
            onApprove={() => void resume([{ type: "approve" }])}
            onReject={() => void resume([{ type: "reject", message: "rejected by the user" }])}
            onEdit={(editedAction) => void resume([{ type: "edit", editedAction }])}
          />
        ) : null}
      </div>

      <form
        className="chat__composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          className="chat__input"
          aria-label="Message the agent"
          // uxpass 6.4 — the box is only ever read while it is disabled, so the
          // placeholder is where the reason goes.
          placeholder={composerPlaceholder(state)}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a newline. The instinct people bring
            // from every other chat window, kept rather than re-taught.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          // uxpass 6.4 — a paused run is not a run you may talk over: the
          // composer stayed live through an interrupt, so a message could be
          // sent into a run waiting for a decision.
          disabled={composerDisabled(state)}
        />
        {state.running ? (
          <Button onClick={cancel}>Stop</Button>
        ) : (
          <Button
            type="submit"
            variant="primary"
            disabled={!draft.trim() || state.interrupt !== null}
          >
            Send
          </Button>
        )}
      </form>
    </div>
  );
}

/** One turn in the conversation: the text and the tool calls it produced. */
function Turn({ message }: { message: Message }): React.JSX.Element {
  return (
    <div className={`chat__turn chat__turn--${message.role}`}>
      {message.text ? <div className="chat__bubble">{message.text}</div> : null}
      {message.tools.length > 0 ? (
        <ul className="chat__tools">
          {message.tools.map((t, i) => (
            <li key={i} className="chat__tool">
              <code>{t.name}</code>
              <span className="chat__tool-phase">{t.phase === "start" ? "…" : "done"}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The approve/reject/edit card a paused write surfaces (R5.1, R5.2). The
 * proposal is read off the tool args the middleware surfaced — exactly what the
 * model proposed, no inference. Edit is inline: a textarea pre-filled with the
 * one editable field, submitted as an `edit` decision (R5.4).
 */
function InterruptCard({
  interrupt,
  onApprove,
  onReject,
  onEdit,
}: {
  interrupt: Interrupt;
  onApprove: () => void;
  onReject: () => void;
  onEdit: (editedAction: { name: string; args: Record<string, unknown> }) => void;
}): React.JSX.Element {
  // One action per interrupt in v1 — the middleware bundles calls, but a write
  // tool is the one that pauses, and a single proposal is the common case.
  const action = interrupt.actionRequests[0];
  const proposal = action ? proposalOf(action) : null;
  const preview = interrupt.previews?.[0] ?? null;
  const editable: EditableField | null = proposal && action ? editableOf(proposal, action) : null;
  const [editing, setEditing] = useState<string | null>(null);
  const card = useRef<HTMLDivElement>(null);

  /**
   * The focus goes to the card when it appears (uxpass 6.5).
   *
   * The run has stopped and the window is waiting on a person: leaving the focus
   * wherever it was — usually the composer, which is now disabled — is a pause
   * nobody using a keyboard can answer without hunting for it. The card is
   * `tabindex="-1"` so it can hold focus without becoming a tab stop of its own.
   *
   * Mounted once per interrupt, because the card is keyed by it (see the call
   * site) — so a replacement proposal takes the focus again, which is right: it
   * is a different write.
   */
  useEffect(() => card.current?.focus(), []);

  /**
   * The keyboard for a repeated approve loop (uxpass 6.5).
   *
   * **Only while the card is showing its decision, never while it is being
   * edited.** The edit textarea is a descendant of this card, so a keydown in it
   * bubbles here — and both chords mean something else inside a text field.
   * `Ctrl+Enter` is the submit reflex, and it would have approved the *original*
   * proposal, silently discarding the edit somebody opened the box specifically
   * to make; `Ctrl+Backspace` is delete-previous-word, and it would have rejected
   * the whole write instead of deleting a word.
   *
   * That is the one failure this surface exists to prevent — a write landing
   * without the human having read what landed — reintroduced by the shortcut
   * meant to make reviewing cheaper. Scoped rather than fixed in the textarea,
   * because the rule is about which state the card is in, and a
   * `stopPropagation` in one child leaves the next child to remember.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (editing !== null) return;
    const decision = interruptShortcut(event);
    if (decision === null) return;
    event.preventDefault();
    if (decision === "approve") onApprove();
    else onReject();
  };

  if (!proposal || !action) {
    // An interrupt with no renderable proposal: still pause for a decision,
    // showing the raw action name so the human is not staring at nothing.
    return (
      <div
        className="chat__interrupt"
        ref={card}
        tabIndex={-1}
        role="group"
        aria-label="The agent is waiting for approval"
        onKeyDown={onKeyDown}
      >
        <p className="chat__interrupt-lead">
          The agent wants to run a tool and is waiting for approval.
        </p>
        <div className="chat__interrupt-actions">
          <Button variant="primary" onClick={onApprove}>
            Approve
          </Button>
          <Button onClick={onReject}>Reject</Button>
        </div>
        <Shortcuts />
      </div>
    );
  }

  return (
    <div
      className="chat__interrupt"
      ref={card}
      tabIndex={-1}
      role="group"
      aria-label={`The agent wants to ${labelFor(proposal)}`}
      onKeyDown={onKeyDown}
    >
      <p className="chat__interrupt-lead">
        The agent wants to <strong>{labelFor(proposal)}</strong>. Review it before it lands.
      </p>
      <ProposalView proposal={proposal} preview={preview} />
      {editing !== null && editable ? (
        <form
          className="chat__edit"
          onSubmit={(e) => {
            e.preventDefault();
            onEdit({ name: editable.name, args: editable.argsWith(editing) });
            setEditing(null);
          }}
        >
          <textarea
            className="chat__input"
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            aria-label={`Edited ${editable.key}`}
          />
          <div className="chat__interrupt-actions">
            <Button type="submit" variant="primary">
              Send edited
            </Button>
            <Button onClick={() => setEditing(null)}>Cancel edit</Button>
          </div>
        </form>
      ) : (
        <>
          <div className="chat__interrupt-actions">
            <Button variant="primary" onClick={onApprove}>
              Approve
            </Button>
            {editable ? <Button onClick={() => setEditing(editable.value)}>Edit</Button> : null}
            <Button onClick={onReject}>Reject</Button>
          </div>
          <Shortcuts />
        </>
      )}
    </div>
  );
}

/**
 * What the two chords are, said where they are used (uxpass 6.5).
 *
 * A shortcut nobody is told about is a shortcut nobody uses, and this pane's
 * whole ergonomics is a repeated approve loop.
 */
function Shortcuts(): React.JSX.Element {
  return (
    <p className="chat__shortcuts">
      <kbd>Ctrl</kbd>+<kbd>Enter</kbd> approves &middot; <kbd>Ctrl</kbd>+<kbd>Backspace</kbd>{" "}
      rejects
    </p>
  );
}

/**
 * The proposal, rendered as the fields its tool carries (R5.2).
 *
 * For an `edit_file` the fields alone are not enough to decide on: `old_string`
 * shown once looks the same whether it occurs once in the page or forty times.
 * The `preview` — computed in the main process from the page on disk — is what
 * closes that: every site the edit will touch, and the page as it will read.
 */
function ProposalView({
  proposal,
  preview,
}: {
  proposal: Proposal;
  preview: ChatEditPreview | null;
}): React.JSX.Element {
  /**
   * The two sides, with what actually changed marked (uxpass 6.3).
   *
   * Computed once and used for both rows, so *Replace* and *With* are two views
   * of one comparison rather than two independent renderings that could
   * disagree. `null` when either side is too long to diff — see `DIFF_LIMIT`.
   */
  const spans = useMemo(
    () =>
      proposal.oldString !== undefined && proposal.newString !== undefined
        ? wordDiff(proposal.oldString, proposal.newString)
        : null,
    [proposal.oldString, proposal.newString],
  );

  return (
    <dl className="chat__proposal">
      <dt>Path</dt>
      <dd>
        <code>{proposal.path}</code>
      </dd>
      {proposal.tool === "rename_page" && proposal.to ? (
        <>
          <dt>To</dt>
          <dd>
            <code>{proposal.to}</code>
          </dd>
        </>
      ) : null}
      {proposal.oldString !== undefined ? (
        <>
          <dt>Replace{proposal.replaceAll ? " (all)" : ""}</dt>
          <dd>
            {spans ? (
              <Marked spans={sideOf(spans, "before")} side="before" />
            ) : (
              <pre className="chat__diff">{proposal.oldString}</pre>
            )}
          </dd>
        </>
      ) : null}
      {proposal.newString !== undefined ? (
        <>
          <dt>{proposal.tool === "edit_file" ? "With" : "Content"}</dt>
          <dd>
            {spans ? (
              <Marked spans={sideOf(spans, "after")} side="after" />
            ) : (
              <pre className="chat__diff">{proposal.newString}</pre>
            )}
            {proposal.oldString !== undefined && spans === null ? (
              <p className="chat__sites-lead">
                Too long to compare word by word — both sides are shown whole.
              </p>
            ) : null}
          </dd>
        </>
      ) : null}
      {preview ? (
        <>
          <dt>Sites</dt>
          <dd>
            <p className="chat__sites-lead">
              {preview.replaced === preview.occurrences
                ? `Replaces ${countLabel(preview.replaced)} in this page.`
                : `Replaces ${countLabel(preview.replaced)} of ${preview.occurrences} matches in this page.`}
            </p>
            <ul className="chat__sites">
              {preview.sites.map((site, i) => (
                <li key={i} className="chat__site">
                  <span className="chat__site-line">{site.line}</span>
                  <code className="chat__site-text">{site.text}</code>
                </li>
              ))}
            </ul>
            {preview.truncated ? (
              <p className="chat__sites-lead">
                Showing the first {preview.sites.length}; every match will be replaced.
              </p>
            ) : null}
          </dd>
          <dt>Resulting page</dt>
          <dd>
            {preview.resulting !== undefined ? (
              <pre className="chat__diff">{preview.resulting}</pre>
            ) : (
              <p className="chat__sites-lead">
                This page is too large to show in full here — the sites above are every place the
                edit will touch.
              </p>
            )}
          </dd>
        </>
      ) : null}
    </dl>
  );
}

/**
 * One side of the diff (uxpass 6.3).
 *
 * **Marked, never colour alone** — the same rule the checks pane follows for
 * severity. A removed run is struck through and an added one is underlined, and
 * each carries a name for the ear, because the whole point of this card is that
 * somebody can tell what changed without reading both blocks twice.
 */
function Marked({
  spans,
  side,
}: {
  spans: readonly DiffSpan[];
  side: "before" | "after";
}): React.JSX.Element {
  const changed = side === "before" ? "removed" : "added";
  return (
    <pre className="chat__diff">
      {spans.map((span, i) =>
        span.kind === "same" ? (
          <span key={i}>{span.text}</span>
        ) : (
          <mark key={i} className={`chat__diff-${changed}`}>
            <span className="visually-hidden">
              {changed === "removed" ? "removed: " : "added: "}
            </span>
            {span.text}
          </mark>
        ),
      )}
    </pre>
  );
}

/** `1 match` / `4 matches` — the count, said the way a person reads it. */
function countLabel(n: number): string {
  return n === 1 ? "1 match" : `${n} matches`;
}

/** The empty state: no Groq key, so the agent is disabled (R1.3, R2.4, R1.5). */
function EmptyAgent({ onOpenSettings }: { onOpenSettings: () => void }): React.JSX.Element {
  return (
    <div className="doorway">
      <p className="doorway__lead">The agent needs a Groq key.</p>
      <p>
        The chat pane runs an embedded agent that reads this project and writes the wiki through the
        gate, pausing for your approval on every write. It uses the same Groq key as transcription —
        add one in settings to enable it.
      </p>
      <p>
        <Button variant="primary" onClick={onOpenSettings}>
          Open settings
        </Button>
      </p>
    </div>
  );
}

/** One short verb phrase describing what the proposed tool does. */
function labelFor(proposal: Proposal): string {
  switch (proposal.tool) {
    case "write_file":
      return `write ${proposal.path}`;
    case "edit_file":
      return `edit ${proposal.path}`;
    case "rename_page":
      return `rename ${proposal.path} to ${proposal.to ?? "?"}`;
    case "delete_page":
      return `delete ${proposal.path}`;
    default:
      return proposal.tool;
  }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Silence the unused-import lint for the state type re-exported through props.
export type { ChatState };
