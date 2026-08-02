/**
 * The shapes that cross the chat IPC boundary (R1.2, R5.2–R5.5, R7.2).
 *
 * Pure types — no `electron` or `langchain` import — so the preload and the
 * renderer can name them without pulling the agent's dependency graph into a
 * sandboxed bundle that cannot run it (see `channels.ts` for why that matters).
 *
 * The push channel (`chat:event`) carries one {@link ChatEvent}, discriminated
 * by `kind`. The renderer switches on `kind` and never reaches across the bridge
 * for the model, the credential, or a raw streamEvents frame — those stay in the
 * main process (R2.1, R2.7).
 */

/** A new turn from the renderer. `thread_id` is the conversation. */
export interface ChatSendInput {
  text: string;
  threadId: string;
}

/**
 * Resume a paused run with the human's decisions (R5.3, R5.4). `threadId` is the
 * conversation the interrupt belongs to — langgraph routes the resume to the
 * pending interrupt on it. `interruptId` ties the decision to the proposal the
 * renderer is looking at; `runId` ties it to the paused run.
 */
export interface ChatResumeInput {
  threadId: string;
  decisions: unknown[];
  interruptId: string;
  runId: string;
}

/** Stop a run in flight (R5.5). */
export interface ChatCancelInput {
  runId: string;
}

/** What `chat:send` / `chat:resume` return immediately: the run is now live. */
export interface ChatRunStarted {
  runId: string;
}

/**
 * One agent action request the human is being asked to approve (R5.1). Carried
 * unchanged from the middleware's `HITLRequest` — the renderer never interprets
 * it, only renders it.
 */
export interface ChatActionRequest {
  name: string;
  args: Record<string, unknown>;
  description?: string;
}

/** One place an `edit_file`'s `old_string` occurs, as the pane shows it (R5.2). */
export interface ChatEditSite {
  /** 1-based line number of the match. */
  line: number;
  /** The whole line the match starts on, for context. */
  text: string;
}

/**
 * What a proposed `edit_file` will actually do, computed from the page on disk
 * before the human decides (R5.2). Without it a `replace_all` proposal renders
 * exactly like a single-site one and the human approves N changes having seen
 * the string once.
 */
export interface ChatEditPreview {
  /** How many times `old_string` occurs in the page. */
  occurrences: number;
  /** How many the edit will actually replace — all of them, or just the first. */
  replaced: number;
  /** Where each replaced occurrence is. Capped; see {@link ChatEditPreview.truncated}. */
  sites: ChatEditSite[];
  /** True when `sites` was capped and does not list every replaced occurrence. */
  truncated: boolean;
  /** The whole page as it will read once the edit lands; absent when too large to carry. */
  resulting?: string;
  /**
   * True when the resulting page was dropped for size. The sites are still the
   * disclosure R5.2 asks for, so the preview is degraded rather than abandoned.
   */
  resultingOmitted: boolean;
}

/** A review configuration for one action name. */
export interface ChatReviewConfig {
  actionName: string;
  allowedDecisions: ("approve" | "edit" | "reject")[];
  argsSchema?: Record<string, unknown>;
}

/**
 * The push payload, discriminated by `kind` (R1.2, R5.2).
 *
 * - `token` — a streamed model delta. Concatenate to render the turn.
 * - `tool` — a tool call started or ended; the renderer shows what the agent is
 *   doing (a read, a proposed write) without waiting for the turn to finish.
 * - `interrupt` — the run paused for human approval of a write. The renderer
 *   renders {@link ChatActionRequest}s with approve/edit/reject and resumes.
 *   `previews[i]` is the {@link ChatEditPreview} for `actionRequests[i]` when
 *   that request is an `edit_file` over a readable page, and `null` otherwise.
 * - `done` — the turn finished cleanly.
 * - `error` — the run failed; the renderer surfaces the message in place (R1.4)
 *   and keeps the conversation that produced it.
 */
export type ChatEvent =
  | { kind: "token"; threadId: string; runId: string; text: string }
  | {
      kind: "tool";
      threadId: string;
      runId: string;
      name: string;
      phase: "start" | "end";
      args?: unknown;
      result?: unknown;
    }
  | {
      kind: "interrupt";
      threadId: string;
      runId: string;
      interruptId: string;
      actionRequests: ChatActionRequest[];
      reviewConfigs?: ChatReviewConfig[];
      /** Aligned with `actionRequests` by index; `null` where there is nothing to preview. */
      previews?: (ChatEditPreview | null)[];
    }
  | { kind: "done"; threadId: string; runId: string }
  | { kind: "error"; threadId: string; runId: string; message: string };
