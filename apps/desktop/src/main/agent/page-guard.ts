import "./tracing.js"; // disable tracing before any langchain import (R2.6) — keep first
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AIMessage, ToolMessage, createMiddleware } from "langchain";
import { assertWithin, OutsideProjectError } from "@open-wiki/access";

/**
 * The revalidation guard for `adr:0019`'s human-in-the-loop writes (R5.5).
 *
 * A write tool call (`write_file` / `edit_file`) is held for human approval by
 * `humanInTheLoopMiddleware`. Between the interrupt and the human's decision,
 * the target page may change — an editor save, a `git pull`, another writer —
 * and a write applied against that stale view would silently clobber the change.
 * The requirement is to revalidate on resume and, if the page changed, refuse
 * the stale edit and re-propose rather than overwrite.
 *
 * This middleware sits **last** in the stack, which is what makes the timing
 * work. langchain runs `afterModel` hooks in **reverse** order (last middleware
 * first), so this guard's `afterModel` runs *before* the HITL middleware
 * interrupts — it captures the page's content hash at proposal time. It runs
 * `wrapToolCall` in **forward** order (first middleware outermost), so this
 * guard's `wrapToolCall` is innermost and runs last, *just before* the real
 * tool invokes the backend — it revalidates against the captured hash and
 * either lets the write through or returns an error the model re-proposes from.
 *
 * The hash is carried in a closure `Map`, not in graph state: the agent is built
 * once per project window and the run loop is sequential for a thread, so a
 * per-file map survives the pause without a state-schema extension. It is
 * consumed (deleted) on every tool execution so a later, fresh proposal is never
 * blocked by a stale expectation.
 *
 * **Keyed by thread *and* path, because the map outlives one thread.** One agent
 * instance is cached per window and every thread on it shares this closure. Two
 * threads proposing a write to the same page would otherwise collide on one
 * entry: the second proposal overwrites the first's hash, the first run consumes
 * it and revalidates against a view it never saw, and the second then finds
 * nothing and skips revalidation entirely — the guard off for exactly the run
 * that needed it. The thread id comes off the `runtime` both hooks receive —
 * see {@link threadOf} for which field, and why it reads two.
 */

const GUARD_TOOLS = new Set(["write_file", "edit_file"]);

/** The arg the model names the target with — deepagents normalizes `path`→`file_path`. */
function targetOf(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  const fp = args["file_path"];
  const p = args["path"];
  return typeof fp === "string" ? fp : typeof p === "string" ? p : undefined;
}

/**
 * The content hash of the page at a real path, or `null` when the page does not
 * exist. `{ unconfined: true }` when the path does not resolve inside the
 * project — the backend will refuse it on its own terms, so the guard has no
 * opinion and steps aside.
 */
type Hash = string | null | { unconfined: true };

function hashAt(projectRoot: string, filePath: string): Hash {
  let abs: string;
  try {
    abs = assertWithin(projectRoot, resolve(projectRoot, filePath));
  } catch (e) {
    if (e instanceof OutsideProjectError) return { unconfined: true };
    return { unconfined: true };
  }
  if (!existsSync(abs)) return null;
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

/** What a `Runtime` carries that this guard reads. Loose, so a test can pass a plain object. */
interface RuntimeLike {
  executionInfo?: { threadId?: string };
  configurable?: { thread_id?: unknown };
}

/**
 * The thread the current hook is running for.
 *
 * Two sources, in this order. `executionInfo.threadId` is the documented one and
 * is what a later langgraph will populate; in `@langchain/langgraph@1.4.8` it is
 * undefined inside a middleware hook, where the id is only on
 * `configurable.thread_id` — the value `chat-control.ts` passes in. Reading both
 * is what stops either version from silently degrading to one shared bucket,
 * which is exactly the collision this key exists to close.
 */
function threadOf(runtime: RuntimeLike | undefined): string {
  const fromExecution = runtime?.executionInfo?.threadId;
  if (typeof fromExecution === "string" && fromExecution.length > 0) return fromExecution;
  const fromConfig = runtime?.configurable?.thread_id;
  return typeof fromConfig === "string" ? fromConfig : "";
}

/**
 * The map key for one thread's expectation about one page. `NUL` separates the
 * two because it cannot occur in either a thread id or a path, so no pair of
 * (thread, path) can collide with another.
 *
 * A run with no checkpointer has no thread id; those runs share the `""` bucket,
 * which is the behavior before this key existed and is correct for a
 * single-threaded caller.
 */
function keyFor(runtime: RuntimeLike | undefined, filePath: string): string {
  return `${threadOf(runtime)}\u0000${filePath}`;
}

/** Forget every expectation captured for one thread. */
function dropThread(expected: Map<string, Hash>, thread: string): void {
  const prefix = `${thread}\u0000`;
  for (const key of expected.keys()) {
    if (key.startsWith(prefix)) expected.delete(key);
  }
}

function sameHash(a: Hash, b: Hash): boolean {
  if (a === null && b === null) return true;
  if (typeof a === "string" && typeof b === "string") return a === b;
  return false;
}

/**
 * Build the guard for one project window. The `projectRoot` is the same root the
 * backend confines to, so the guard reads the page the backend is about to write.
 */
export function pageGuardMiddleware({ projectRoot }: { projectRoot: string }) {
  /** `<thread id>\0<file_path>` → hash at proposal time. Consumed on the next tool execution. */
  const expected = new Map<string, Hash>();

  return createMiddleware({
    name: "PageGuardMiddleware",
    afterModel: async (state, runtime) => {
      // The last AI message carries the tool calls the model just proposed. The
      // HITL middleware interrupts on the same message, immediately after this
      // hook (afterModel runs last-first, and this guard is last in the stack).
      const messages = ((state as { messages?: unknown[] }).messages ?? []) as unknown[];
      const last = [...messages].reverse().find((m) => AIMessage.isInstance(m)) as
        { tool_calls?: Array<{ name: string; args?: Record<string, unknown> }> } | undefined;
      // Drop anything this thread captured earlier and never consumed. Only the
      // tool's own execution consumes an entry, and a run can end without one —
      // `chat:cancel` aborts the stream mid-pause, and a run error ends it the
      // same way — so without this the map only ever grows. It is also the
      // moment it is provably safe: a thread's runs are sequential, so every
      // entry standing when this hook fires belongs to a turn that is over.
      dropThread(expected, threadOf(runtime));

      const toolCalls = last?.tool_calls;
      if (!Array.isArray(toolCalls) || toolCalls.length === 0) return;
      for (const tc of toolCalls) {
        if (!GUARD_TOOLS.has(tc.name)) continue;
        const fp = targetOf(tc.args);
        if (!fp) continue;
        expected.set(keyFor(runtime, fp), hashAt(projectRoot, fp));
      }
    },
    wrapToolCall: async (request, handler) => {
      const name = String(request.tool?.name ?? request.toolCall.name);
      if (!GUARD_TOOLS.has(name)) return handler(request);
      const fp = targetOf(request.toolCall.args as Record<string, unknown> | undefined);
      if (!fp) return handler(request);
      const key = keyFor(request.runtime, fp);
      const prior = expected.get(key);
      if (prior === undefined) return handler(request); // nothing captured (e.g. auto-approved) — no opinion
      expected.delete(key); // consume so a fresh proposal is never blocked by it
      if (prior !== null && typeof prior === "object" && "unconfined" in prior) {
        return handler(request); // let the backend refuse on its own terms
      }
      const current = hashAt(projectRoot, fp);
      if (sameHash(prior, current)) return handler(request); // unchanged since the proposal
      // The page changed between the interrupt and the decision. Refuse to
      // apply the stale edit; tell the model to re-read and re-propose, which
      // interrupts again as a fresh proposal (R5.5).
      return new ToolMessage({
        content: `the page ${fp} changed since this edit was proposed; re-read it and propose the edit again`,
        tool_call_id: request.toolCall.id ?? "",
        name,
        status: "error",
      });
    },
  });
}
