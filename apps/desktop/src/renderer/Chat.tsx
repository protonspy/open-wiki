import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ChatEditPreview, ChatEvent } from "../main/agent/chat-events.js";
import { bridge } from "./bridge.js";
import {
  chatReducer,
  editableOf,
  initialChat,
  proposalOf,
  type ChatState,
  type EditableField,
  type Interrupt,
  type Message,
  type Proposal,
} from "./chat-model.js";

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
  // One conversation per window (R7.1).
  const [threadId] = useState(() => crypto.randomUUID());
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

  if (hasKey === null) return <p className="empty">Checking the agent…</p>;

  if (hasKey === false) {
    return <EmptyAgent onOpenSettings={onOpenSettings} />;
  }

  return (
    <div className="chat">
      <div className="chat__scroll" ref={scroller}>
        {state.messages.length === 0 ? (
          <p className="empty">Ask the agent to read the project and write a page.</p>
        ) : (
          state.messages.map((m, i) => <Turn key={i} message={m} />)
        )}
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
          placeholder={state.running ? "The agent is working…" : "Message the agent"}
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
          disabled={state.running}
        />
        {state.running ? (
          <button type="button" className="btn" onClick={cancel}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn btn--primary" disabled={!draft.trim()}>
            Send
          </button>
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

  if (!proposal || !action) {
    // An interrupt with no renderable proposal: still pause for a decision,
    // showing the raw action name so the human is not staring at nothing.
    return (
      <div className="chat__interrupt">
        <p className="chat__interrupt-lead">
          The agent wants to run a tool and is waiting for approval.
        </p>
        <div className="chat__interrupt-actions">
          <button type="button" className="btn btn--primary" onClick={onApprove}>
            Approve
          </button>
          <button type="button" className="btn" onClick={onReject}>
            Reject
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="chat__interrupt">
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
            <button type="submit" className="btn btn--primary">
              Send edited
            </button>
            <button type="button" className="btn" onClick={() => setEditing(null)}>
              Cancel edit
            </button>
          </div>
        </form>
      ) : (
        <div className="chat__interrupt-actions">
          <button type="button" className="btn btn--primary" onClick={onApprove}>
            Approve
          </button>
          {editable ? (
            <button type="button" className="btn" onClick={() => setEditing(editable.value)}>
              Edit
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onReject}>
            Reject
          </button>
        </div>
      )}
    </div>
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
            <pre className="chat__diff">{proposal.oldString}</pre>
          </dd>
        </>
      ) : null}
      {proposal.newString !== undefined ? (
        <>
          <dt>{proposal.tool === "edit_file" ? "With" : "Content"}</dt>
          <dd>
            <pre className="chat__diff">{proposal.newString}</pre>
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
        <button type="button" className="btn btn--primary" onClick={onOpenSettings}>
          Open settings
        </button>
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
