import "./tracing.js"; // disable tracing before any langchain import (R2.6) — keep first
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { ChatGroq } from "@langchain/groq";
import { Command, MemorySaver } from "@langchain/langgraph";
import { assertWithin, deletePage, OutsideProjectError, renamePage } from "@open-wiki/access";
import {
  createFilesystemMiddleware,
  createPatchToolCallsMiddleware,
  createSkillsMiddleware,
  createSummarizationMiddleware,
  isSandboxBackend,
} from "deepagents";
import { createAgent, humanInTheLoopMiddleware, tool, type InterruptOnConfig } from "langchain";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { WikiGateBackend } from "./wiki-gate-backend.js";
import { pageGuardMiddleware } from "./page-guard.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
// `DEFAULT_MODEL` is canonical in `agent-prefs.ts` (pure, no langchain) so the
// settings module can read the default without importing the agent's graph.
// Re-exported here to keep this module's public surface stable.
export { DEFAULT_MODEL } from "./agent-prefs.js";

/**
 * The embedded agent — `adr:0019`. A langchain `createAgent` graph with an
 * explicit deepagents middleware stack, scoped to the open project: it reads the
 * project the way a harness does (through the gate-backed `WikiGateBackend`) and
 * writes `wiki/` only through the validated store with origin `"agent"`.
 *
 * This module assembles the stack itself rather than calling `createDeepAgent`.
 * `createDeepAgent` makes `SubAgentMiddleware` required, so the `task` tool is
 * always emitted, and its harness-profile switch (`getModelProvider`) has no
 * `ChatGroq` mapping — every Groq instance resolves to `EMPTY_HARNESS_PROFILE`,
 * so the general-purpose subagent would always be built. Assembling the stack
 * ourselves is what makes `task` genuinely absent rather than present-but-dead
 * (R4.4), and keeps the `ChatGroq` instance so the Groq key is injected as
 * `apiKey`, never into `process.env`.
 */

/** The tools a write must pause for human approval on (R5.1). */
export const INTERRUPT_TOOLS = ["write_file", "edit_file", "rename_page", "delete_page"] as const;

/**
 * The `interruptOn` config — every write tool pauses for an approve/edit/reject
 * decision. No `when` predicate: the pause is unconditional, so a write tool
 * call always emits an interrupt before any `writePage`/`renamePage`/`deletePage`
 * call (R5.1, 6.8).
 */
export const INTERRUPT_ON: Record<string, InterruptOnConfig> = Object.fromEntries(
  INTERRUPT_TOOLS.map((name) => [
    name,
    {
      allowedDecisions: ["approve", "edit", "reject"],
      description: `Review the proposed wiki ${name.replace("_", " ")}`,
    },
  ]),
);

/**
 * The harness entry file candidates, in precedence order (R2.3, R2.9). Both are
 * renderings of one convention — `CLAUDE.md` for a project scaffolded for
 * Claude, `AGENTS.md` for the cross-harness name — and the precedence is fixed
 * rather than ambiguous: a project carrying both is read from `CLAUDE.md`.
 */
const HARNESS_ENTRY_FILES = ["CLAUDE.md", "AGENTS.md"] as const;

/**
 * Resolve the project's harness entry file — the agent's **first user message**
 * — deterministically (R2.3, R2.9). `CLAUDE.md` at the project root when it is
 * present, otherwise `AGENTS.md`; a project carrying neither resolves to `null`,
 * and the agent runs on the fixed system prompt alone. `plans/harness-portability.md`
 * will write one entry file per harness and a project may carry several, at which
 * point this resolver picks one from the scaffold metadata; for v1 the precedence
 * above is the decision.
 *
 * Read with `assertWithin` + real-path resolution (the same check the gate
 * uses), not a bare `node:fs` read: a junction at the entry file pointing outside
 * the project must not become the agent's first user message. Returned unchanged —
 * no hand-written prompt is appended beside it (the fixed system prompt is
 * application code, set separately on `createAgent`).
 */
export function resolveHarnessEntry(projectRoot: string): { content: string; path: string } | null {
  for (const name of HARNESS_ENTRY_FILES) {
    try {
      const real = assertWithin(projectRoot, resolve(projectRoot, name));
      if (!existsSync(real)) continue;
      return { content: readFileSync(real, "utf8"), path: name };
    } catch (e) {
      // A candidate that escapes the project is not the entry file; try the next.
      if (e instanceof OutsideProjectError) continue;
      throw e;
    }
  }
  return null;
}

/** The agent's write tools, named for the construction test and the IPC layer. */
export const AGENT_TOOL_NAMES = {
  rename: "rename_page",
  delete: "delete_page",
} as const;

export interface EmbeddedAgent {
  /** The compiled langchain agent — invoke via `streamEvents` / `Command`. */
  readonly agent: ReturnType<typeof createAgent>;
  /** The gate-backed backend the filesystem tools re-point at. */
  readonly backend: WikiGateBackend;
  /** One in-memory checkpointer, scoped to the project window, keyed by thread_id. */
  readonly checkpointer: MemorySaver;
  /** Every tool name the agent exposes (custom + middleware). */
  readonly toolNames: readonly string[];
  /**
   * The fixed, application-authored system prompt the agent was constructed with
   * (R2.3). Exposed so the construction is testable — the harness entry is not
   * the system prompt, and this is what is.
   */
  readonly systemPrompt: string;
  /**
   * The project's resolved harness entry (`CLAUDE.md` or `AGENTS.md`), carried in
   * unchanged as the agent's first user message on an empty thread (R2.9), or
   * `null` when the project carries neither. Exposed so the chat control can
   * inject it once per conversation.
   */
  readonly harnessEntry: { content: string; path: string } | null;
  /**
   * The model the agent reasons with. Exposed so the build is testable — the
   * `reasoningFormat` set on it is what keeps gpt-oss's chain-of-thought out of
   * the message history (see `createEmbeddedAgent`).
   */
  readonly model: BaseChatModel;
}

export interface CreateAgentInput {
  projectRoot: string;
  /** The Groq API key, read from `readSecrets` — injected as `apiKey`, never `process.env`. */
  apiKey: string;
  /** The user-selected model (default `openai/gpt-oss-120b`). */
  modelName: string;
  /**
   * A model to use in place of `ChatGroq`. Production leaves this absent — the
   * Groq instance is built with the saved key. The proof tests (group 6) pass a
   * scripted model so the human-in-the-loop loop can be driven without a network
   * call: the model emits a tool call, the middleware interrupts, the test
   * resumes with a decision.
   */
  model?: BaseChatModel;
}

/**
 * Build the embedded agent for a project window (R2.1, R2.2, R2.5, R4.4, R7.1).
 * Construction makes no network call — `ChatGroq` is lazy — so this is safe to
 * test without a live key.
 */
export function createEmbeddedAgent(input: CreateAgentInput): EmbeddedAgent {
  const { projectRoot, apiKey, modelName, model: injected } = input;
  const backend = new WikiGateBackend(projectRoot);

  // The two custom write tools, built over the gated access primitives with
  // origin `"agent"`. They close over `projectRoot` (R2.3, R4.2, R4.5, R4.6).
  const renamePageTool = tool(
    async ({ from, to }) => {
      const result = renamePage(projectRoot, from, to, "agent");
      return result.ok
        ? { ok: true as const, operationId: result.operationId }
        : { ok: false as const, reason: result.reasons.join("; ") };
    },
    {
      name: AGENT_TOOL_NAMES.rename,
      description:
        "Rename a wiki page by supersession: write the new page through the gate and mark the old one superseded. " +
        "Refuses to clobber an existing target and refuses the wiki index, changelog, and log. " +
        "Both paths must be inside wiki/ (e.g. wiki/old.md, wiki/new.md).",
      schema: z.object({
        from: z.string().describe("Project-relative path of the page to rename, e.g. wiki/old.md"),
        to: z.string().describe("Project-relative path for the new page, e.g. wiki/new.md"),
      }),
    },
  );

  const deletePageTool = tool(
    async ({ path }) => {
      const result = deletePage(projectRoot, path, "agent");
      return result.ok
        ? { ok: true as const, operationId: result.operationId }
        : { ok: false as const, reason: result.reason };
    },
    {
      name: AGENT_TOOL_NAMES.delete,
      description:
        "Delete a wiki page: gated removal — snapshot, unlink, log one undoable operation. " +
        "Refuses the wiki index, changelog, and log. The path must be inside wiki/ (e.g. wiki/old.md).",
      schema: z.object({
        path: z.string().describe("Project-relative path of the page to delete, e.g. wiki/old.md"),
      }),
    },
  );

  const customTools = [renamePageTool, deletePageTool];

  // Explicit deepagents middleware stack — no `SubAgentMiddleware`, so the
  // `task` tool is absent (R4.4). `execute` is filtered because `WikiGateBackend`
  // is not a sandbox backend. The eviction threshold is `null` so the
  // filesystem middleware never tries to write overflow to disk (the gate would
  // reject `/large_tool_results/` and `/conversation_history/` regardless).
  const middleware = [
    createFilesystemMiddleware({ backend, toolTokenLimitBeforeEvict: null }),
    createSkillsMiddleware({ backend, sources: [".claude/skills/"] }),
    createSummarizationMiddleware({ backend }),
    createPatchToolCallsMiddleware(),
    humanInTheLoopMiddleware({ interruptOn: INTERRUPT_ON }),
    // Last so afterModel runs first (captures the page hash before the HITL
    // interrupt) and wrapToolCall runs last (revalidates just before the write).
    pageGuardMiddleware({ projectRoot }),
  ];

  const harness = resolveHarnessEntry(projectRoot);
  // The `system` slot is the fixed, application-authored prompt (R2.3) — not the
  // harness entry. The harness entry is injected as the first user message of
  // each conversation by the chat control (R2.9), carried in unchanged.
  const systemPrompt = SYSTEM_PROMPT;

  const checkpointer = new MemorySaver();
  // The Groq instance is built with the saved key, never `process.env`. The
  // proof tests inject a scripted model in their place (R2.1 — the renderer
  // cannot reach the model; the test reaches it through the same seam).
  const model: BaseChatModel = injected ?? new ChatGroq({ model: modelName, apiKey });
  // gpt-oss is a reasoning model. Groq's default reasoning format returns the
  // chain-of-thought as a content block; ChatGroq stores it verbatim and sends
  // it back on the next turn, and Groq rejects an assistant message whose
  // `content` is not a string or a `text` block
  // ("messages.N.content.0.type : value is not one of the allowed values
  // ['text']"). `hidden` keeps the reasoning internal — the model still reasons
  // — and returns only the final answer as a plain string, so no reasoning block
  // ever enters the history to be rejected on the round trip. `hidden` is the
  // one reasoning format Groq allows alongside tool calls, which this agent
  // always binds. Set as a field because ChatGroq 1.3.1's constructor does not
  // read `reasoningFormat` from its params, and `invocationParams` reads the
  // field, not a call-time option — the field is the only seam.
  if (!injected && model instanceof ChatGroq) model.reasoningFormat = "hidden";
  const agent = createAgent({
    model,
    tools: customTools,
    systemPrompt,
    middleware,
    checkpointer,
  });

  const toolNames = collectToolNames(middleware, customTools, backend);

  return { agent, backend, checkpointer, toolNames, model, systemPrompt, harnessEntry: harness };
}

/** A middleware exposes its tools by name; that is all this needs. */
interface MiddlewareWithTools {
  tools?: ReadonlyArray<{ name?: string }>;
}

/**
 * The full set of tool names the agent binds: custom tools + middleware tools,
 * with the same runtime filter deepagents applies — `execute` is dropped when
 * the backend is not a sandbox (deepagents refuses the call regardless; this
 * keeps `toolNames` the set the model is actually offered, not the declared
 * set). `task` is never present: no subagent middleware is in the stack.
 */
function collectToolNames(
  middleware: ReadonlyArray<MiddlewareWithTools>,
  customTools: ReadonlyArray<{ name: string }>,
  backend: WikiGateBackend,
): string[] {
  const names = new Set<string>();
  for (const m of middleware) for (const t of m.tools ?? []) if (t.name) names.add(t.name);
  for (const t of customTools) names.add(t.name);
  if (!isSandboxBackend(backend)) names.delete("execute");
  return [...names].sort();
}

/**
 * Resume a paused run with the human's decisions (R5.3, R5.4). The value is a
 * `HITLResponse` (`{ decisions: Decision[] }`); langgraph routes it to the
 * pending interrupt on the same `thread_id`.
 */
export function resumeCommand(decisions: unknown[]): Command {
  return new Command({ resume: { decisions } });
}

/**
 * Run the agent, streaming token and tool-call events (R1.2, R5.5, R7.1, R7.2).
 * `onEvent` receives each streamEvents(v3) event; the caller (the IPC layer)
 * forwards the ones it cares about to the renderer over `chat:event`. A paused
 * run ends the iterator with the interrupt surfaced in the final state — the
 * IPC layer reads `agent.getState(config)` for the interrupt payload.
 */
export async function* streamAgent(
  embedded: EmbeddedAgent,
  text: string,
  threadId: string,
  onEvent: (event: unknown) => void,
): AsyncGenerator<void> {
  const stream = await embedded.agent.streamEvents(
    { messages: [{ role: "user", content: text }] },
    { version: "v3", configurable: { thread_id: threadId } },
  );
  for await (const event of stream) {
    onEvent(event);
    yield;
  }
}
