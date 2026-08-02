import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { pageGuardMiddleware } from "../src/main/agent/page-guard.js";

/**
 * The guard's hooks, driven directly (R5.5). `agent-loop.spec.ts` proves the
 * guard through a real run, which is the proof that matters; this reaches the
 * two hooks on their own to exercise the paths a run cannot reproduce — a turn
 * that ends without the tool ever executing, which is what `chat:cancel` and a
 * run error both leave behind.
 */

/** The two hooks, off the middleware object, typed loosely — this drives them by hand. */
type Hooks = {
  afterModel(state: unknown, runtime: unknown): Promise<unknown>;
  wrapToolCall(request: unknown, handler: (r: unknown) => unknown): Promise<unknown>;
};

const runtimeFor = (threadId: string) => ({ configurable: { thread_id: threadId } });

/** The state shape `afterModel` reads: the last AI message and its tool calls. */
const proposing = (path: string) => ({
  messages: [
    new AIMessage({
      content: "",
      tool_calls: [{ name: "write_file", args: { path }, id: "c1", type: "tool_call" as const }],
    }),
  ],
});

/** A turn that proposed nothing — the model just answered in text. */
const answering = () => ({ messages: [new AIMessage({ content: "Nothing to do." })] });

const callFor = (path: string) => ({
  tool: { name: "write_file" },
  toolCall: { name: "write_file", args: { path }, id: "c1" },
  runtime: undefined as unknown,
});

describe("the page guard's expectations do not outlive the turn that made them", () => {
  let root: string;
  let page: string;
  let hooks: Hooks;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ow-guard-"));
    mkdirSync(join(root, "wiki"), { recursive: true });
    page = "wiki/p.md";
    writeFileSync(join(root, page), "one\n");
    hooks = pageGuardMiddleware({ projectRoot: root }) as unknown as Hooks;
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** Run the guard's `wrapToolCall`, reporting whether the write was let through. */
  async function attemptWrite(threadId: string): Promise<"through" | "refused"> {
    let reached = false;
    const request = { ...callFor(page), runtime: runtimeFor(threadId) };
    const result = await hooks.wrapToolCall(request, () => {
      reached = true;
      return new ToolMessage({ content: "ok", tool_call_id: "c1", name: "write_file" });
    });
    void result;
    return reached ? "through" : "refused";
  }

  it("refuses the write when the page changed since the proposal", async () => {
    // The baseline the two cases below are read against.
    await hooks.afterModel(proposing(page), runtimeFor("t1"));
    writeFileSync(join(root, page), "two\n");
    expect(await attemptWrite("t1")).toBe("refused");
  });

  it("forgets a proposal the turn never executed, rather than holding it forever", async () => {
    // A run cancelled while paused, or ended by an error, never reaches the
    // tool — so nothing consumes the entry. The next turn on the thread clears
    // it: only the tool's own execution consumes one, so without this the map
    // grows for the window's whole life.
    await hooks.afterModel(proposing(page), runtimeFor("t1"));
    // …cancelled. The next turn proposes nothing at all.
    await hooks.afterModel(answering(), runtimeFor("t1"));
    // The page then changes. The abandoned expectation is gone, so the guard has
    // no opinion here — it does not judge this write against a proposal from a
    // turn that ended.
    writeFileSync(join(root, page), "two\n");
    expect(await attemptWrite("t1")).toBe("through");
  });

  it("clears only the thread that is running, never another's", async () => {
    // The sweep is prefix-based, so a thread whose id is a prefix of another's
    // must not take its entries with it.
    await hooks.afterModel(proposing(page), runtimeFor("t"));
    await hooks.afterModel(proposing(page), runtimeFor("t1"));
    // Thread "t" starts a new turn, clearing its own. "t1" keeps its expectation.
    await hooks.afterModel(answering(), runtimeFor("t"));
    writeFileSync(join(root, page), "two\n");
    expect(await attemptWrite("t")).toBe("through");
    expect(await attemptWrite("t1")).toBe("refused");
  });
});
