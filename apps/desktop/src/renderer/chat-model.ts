import type {
  ChatActionRequest,
  ChatEditPreview,
  ChatEvent,
  ChatReviewConfig,
} from "../main/agent/chat-events.js";

/**
 * The conversation the chat pane renders, folded from the {@link ChatEvent}
 * stream (R1.2, R5.2). Pure functions, so the half of the pane that decides
 * what to show — which tokens belong to which turn, what a tool call looked
 * like, when a run is paused or done — is tested without a DOM, the way the
 * other renderer modules are.
 *
 * One run is one `chat:send` and the events it produces; one thread is one
 * conversation, one `thread_id` per project window (R7.1). The component owns a
 * thread id for its lifetime; this model never sees it.
 */

/** A tool call the agent made, as the pane shows it. */
export interface ToolCall {
  name: string;
  phase: "start" | "end";
  args?: unknown;
  result?: unknown;
}

/** One turn in the conversation. */
export interface Message {
  role: "user" | "assistant";
  /** Concatenated model tokens for an assistant turn; the sent text for a user turn. */
  text: string;
  /** Tool calls the agent made during this assistant turn, in order. */
  tools: ToolCall[];
}

/** A paused write the human is being asked to approve (R5.1, R5.2). */
export interface Interrupt {
  runId: string;
  interruptId: string;
  actionRequests: ChatActionRequest[];
  reviewConfigs?: ChatReviewConfig[];
  /** Aligned with `actionRequests`: what an `edit_file` will actually do (R5.2). */
  previews?: (ChatEditPreview | null)[];
}

/** The pane's whole state. */
export interface ChatState {
  messages: Message[];
  running: boolean;
  interrupt: Interrupt | null;
  error: string | null;
}

export const initialChat: ChatState = {
  messages: [],
  running: false,
  interrupt: null,
  error: null,
};

/** Begin a turn: append the user's message and mark the run live (R1.2). */
export function sendUser(state: ChatState, text: string): ChatState {
  return {
    messages: [...state.messages, { role: "user", text, tools: [] }],
    running: true,
    interrupt: null,
    error: null,
  };
}

/** Resume after a decision: the run is live again, the interrupt clears (R5.3). */
export function resumeRun(state: ChatState): ChatState {
  return { ...state, running: true, interrupt: null };
}

/**
 * Fold one {@link ChatEvent} into the state (R1.2, R1.4, R5.1, R5.2).
 *
 * - `token` appends to the current assistant turn, starting one if the last
 *   message is not the model's.
 * - `tool` records the call on the current assistant turn. A second `start`
 *   before the first `end` is a new call; `end` matches the most recent
 *   unfinished call of the same name.
 * - `interrupt` pauses the run and stores the proposal. A second interrupt
 *   replaces the first — that is how a changed page comes back as a fresh
 *   proposal rather than a stale one (R5.5, 4.3).
 * - `done` ends the run.
 * - `error` ends the run and surfaces the message in place, leaving the
 *   conversation that produced it intact (R1.4).
 */
export function applyEvent(state: ChatState, event: ChatEvent): ChatState {
  switch (event.kind) {
    case "token":
      return { ...state, messages: appendToken(state.messages, event.text) };
    case "tool":
      return { ...state, messages: applyTool(state.messages, event) };
    case "interrupt":
      return {
        ...state,
        running: false,
        interrupt: {
          runId: event.runId,
          interruptId: event.interruptId,
          actionRequests: event.actionRequests,
          reviewConfigs: event.reviewConfigs,
          previews: event.previews,
        },
      };
    case "done":
      return { ...state, running: false };
    case "error":
      return { ...state, running: false, error: event.message };
  }
}

/** Append a model delta to the current assistant turn, starting one if needed. */
function appendToken(messages: Message[], text: string): Message[] {
  const last = messages[messages.length - 1];
  if (last && last.role === "assistant") {
    return [...messages.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...messages, { role: "assistant", text, tools: [] }];
}

/** Record a tool boundary on the current assistant turn. */
function applyTool(messages: Message[], event: Extract<ChatEvent, { kind: "tool" }>): Message[] {
  const last = messages[messages.length - 1];
  const turn: Message =
    last && last.role === "assistant" ? last : { role: "assistant", text: "", tools: [] };
  const base = last && last.role === "assistant" ? messages.slice(0, -1) : messages;
  if (event.phase === "start") {
    return [
      ...base,
      { ...turn, tools: [...turn.tools, { name: event.name, phase: "start", args: event.args }] },
    ];
  }
  // end: mark the most recent unfinished call of the same name as done.
  const tools = [...turn.tools];
  for (let i = tools.length - 1; i >= 0; i--) {
    const t = tools[i];
    if (t && t.name === event.name && t.phase === "start") {
      tools[i] = { ...t, phase: "end", result: event.result };
      break;
    }
  }
  return [...base, { ...turn, tools }];
}

/**
 * The proposal a `write_file` / `edit_file` call carries, read off the tool
 * args the middleware surfaced (R5.2). `null` for a tool whose args are not a
 * write the pane knows how to render as a proposal.
 */
export interface Proposal {
  tool: string;
  path: string;
  /** `write_file` / `edit_file`: the full new content (write) or replacement string (edit). */
  newString?: string;
  /** `edit_file`: the string being replaced. */
  oldString?: string;
  /** `edit_file`: whether the replace is global. */
  replaceAll?: boolean;
  /** `rename_page`: the destination. */
  to?: string;
}

/**
 * Read the proposal off an action request's args. The deepagents `write_file`
 * carries `{ file_path, content }`, `edit_file` carries `{ file_path,
 * old_string, new_string, replace_all? }`, `rename_page` carries `{ from, to }`,
 * `delete_page` carries `{ path }`. The pane renders exactly these — no
 * inference, no fetching the page — so what the human approves is what the
 * model proposed.
 *
 * `file_path` first, then `path`: deepagents' filesystem tools name the target
 * `file_path` and the older shape used `path`. Reading only `path` returned null
 * for every real `edit_file`, which dropped the pane to its no-renderable-
 * proposal fallback — approve or reject with the details and the preview both
 * gone. The same order `previewOf` and the page guard read them in.
 */
export function proposalOf(action: ChatActionRequest): Proposal | null {
  const args = action.args as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  const path = str(args["file_path"]) ?? str(args["path"]) ?? str(args["from"]);
  if (!path) return null;
  switch (action.name) {
    case "write_file":
      return { tool: action.name, path, newString: str(args["content"]) };
    case "edit_file":
      return {
        tool: action.name,
        path,
        oldString: str(args["old_string"]),
        newString: str(args["new_string"]),
        replaceAll: args["replace_all"] === true,
      };
    case "rename_page":
      return { tool: action.name, path, to: str(args["to"]) };
    case "delete_page":
      return { tool: action.name, path };
    default:
      return null;
  }
}

/**
 * Which field of a proposal the human may edit, and the tool/args to resume with
 * when they have. `delete_page` has nothing editable, so it returns `null` and
 * the pane offers only approve/reject.
 */
export interface EditableField {
  /** The args key the edited value replaces. */
  key: "content" | "new_string" | "to";
  /** The value to pre-fill the editor with. */
  value: string;
  /** The action name, for the resumed `editedAction`. */
  name: string;
  /** The full args, with the edited field applied. */
  argsWith(value: string): Record<string, unknown>;
}

/** The one field a proposal lets the human revise (R5.4), or null if none. */
export function editableOf(proposal: Proposal, action: ChatActionRequest): EditableField | null {
  const args = { ...action.args };
  switch (proposal.tool) {
    case "write_file":
      return {
        key: "content",
        value: proposal.newString ?? "",
        name: action.name,
        argsWith: (v) => ({ ...args, content: v }),
      };
    case "edit_file":
      return {
        key: "new_string",
        value: proposal.newString ?? "",
        name: action.name,
        argsWith: (v) => ({ ...args, new_string: v }),
      };
    case "rename_page":
      return {
        key: "to",
        value: proposal.to ?? "",
        name: action.name,
        argsWith: (v) => ({ ...args, to: v }),
      };
    default:
      return null;
  }
}

/**
 * What the pane announces, given where the run is (uxpass 4.2).
 *
 * **The three things that change without the user acting**, and the reason a
 * live region is worth having at all here: a turn starting, a turn ending, and
 * the moment the agent stops and waits for a decision. Somebody who cannot see
 * the transcript had no way to learn any of them — the only signal was the
 * composer's placeholder, which vanishes the moment anybody types.
 *
 * The boundaries, not the tokens: announcing a stream word by word is a region
 * that never stops talking, which is how a live region becomes something people
 * turn off.
 */
export function chatAnnouncement(state: ChatState): string {
  if (state.error !== null) return `The agent stopped: ${state.error}`;
  if (state.interrupt) return "The agent is waiting for your approval before it writes.";
  if (state.running) return "The agent is working.";
  if (state.messages.some((message) => message.role === "assistant")) {
    return "The agent has finished its turn.";
  }
  return "";
}

/**
 * What the composer says while it cannot be typed into (uxpass 6.4, 6.6).
 *
 * Two findings meet here. The composer stayed enabled during an interrupt, so a
 * message could be sent into a run that was paused waiting for a decision — and
 * the working state lived in the placeholder, which disappears the moment
 * anybody types. The placeholder now says why the box is disabled, and it is
 * only ever read while it *is* disabled; the working state is an element of its
 * own in the transcript.
 */
export function composerPlaceholder(state: ChatState): string {
  if (state.interrupt) return "Approve or reject the write above to carry on";
  if (state.running) return "The agent is working…";
  return "Message the agent";
}

/** Whether the composer may be typed into at all (uxpass 6.4). */
export function composerDisabled(state: ChatState): boolean {
  return state.running || state.interrupt !== null;
}

/** What a chord means while an approval card has the focus (uxpass 6.5). */
export type InterruptDecision = "approve" | "reject";

/**
 * The keyboard for a repeated approve loop (uxpass 6.5).
 *
 * **Modified, not bare.** `A` and `R` would be faster and are not available: the
 * card carries an Edit textarea, and a bare letter that decides a write while
 * somebody is typing into one is the worst possible false positive for a
 * human-in-the-loop surface. `Ctrl`/`Cmd` with Enter and Backspace is the pair
 * every editor already uses for *commit* and *discard*.
 */
export function interruptShortcut(chord: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): InterruptDecision | null {
  if (!(chord.ctrlKey === true || chord.metaKey === true)) return null;
  if (chord.altKey === true || chord.shiftKey === true) return null;
  if (chord.key === "Enter") return "approve";
  if (chord.key === "Backspace") return "reject";
  return null;
}

/** The actions the pane dispatches to its reducer. */
export type ChatAction =
  | { type: "send"; text: string }
  | { type: "resume" }
  | { type: "reset" }
  | { type: "event"; event: ChatEvent };

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send":
      return sendUser(state, action.text);
    case "resume":
      return resumeRun(state);
    // A new conversation (uxpass 6.1). The thread id is the component's and is
    // replaced beside this — a cleared transcript still addressing the old
    // checkpointed thread would be a window showing nothing and an agent
    // remembering everything.
    case "reset":
      return initialChat;
    case "event":
      return applyEvent(state, action.event);
  }
}
