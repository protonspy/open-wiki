import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHANNELS, PUSH_CHANNELS } from "../src/main/channels.js";
import { createApi, dispatch } from "../src/main/ipc.js";
import type {
  ChatActionRequest,
  ChatEvent,
  ChatReviewConfig,
} from "../src/main/agent/chat-events.js";
import {
  createChatControl,
  type BuildAgent,
  type ChatCredentials,
} from "../src/main/agent/chat-control.js";
import type { EmbeddedAgent } from "../src/main/agent/agent.js";

/**
 * The IPC plumbing for the embedded agent (group 3): the channel names, the
 * push set, the dispatch routing, and the run loop that turns a streamEvents
 * frame into a `ChatEvent`. The model-driven proof — that a live Groq run
 * interrupts, resumes, and lands writes — is group 6; here the agent is a fake
 * that yields the frames we choose.
 */

describe("chat channels (3.1)", () => {
  it("names the three invoke channels and the one push channel", () => {
    expect(CHANNELS.chatSend).toBe("chat:send");
    expect(CHANNELS.chatResume).toBe("chat:resume");
    expect(CHANNELS.chatCancel).toBe("chat:cancel");
    expect(CHANNELS.chatEvent).toBe("chat:event");
  });

  it("treats chat:event as a push channel — no handler, only main→renderer", () => {
    expect(PUSH_CHANNELS.has(CHANNELS.chatEvent)).toBe(true);
    expect(PUSH_CHANNELS.has(CHANNELS.chatSend)).toBe(false);
    expect(PUSH_CHANNELS.has(CHANNELS.chatResume)).toBe(false);
    expect(PUSH_CHANNELS.has(CHANNELS.chatCancel)).toBe(false);
  });
});

describe("dispatch routes chat (3.1)", () => {
  it("routes chat:send to the control", async () => {
    const sent: { text: string; threadId: string }[] = [];
    const api = createApi({
      projectRoot: null,
      chat: {
        send: (input) => {
          sent.push(input);
          return { runId: "r1" };
        },
        resume: () => ({ runId: "r2" }),
        cancel: () => {},
      },
    });
    const out = await dispatch(api, CHANNELS.chatSend, [{ text: "hi", threadId: "t1" }]);
    expect(out).toEqual({ runId: "r1" });
    expect(sent[0]).toEqual({ text: "hi", threadId: "t1" });
  });

  it("routes chat:resume with the thread the interrupt belongs to", async () => {
    let got: unknown = null;
    const api = createApi({
      projectRoot: null,
      chat: {
        send: () => ({ runId: "r1" }),
        resume: (input) => {
          got = input;
          return { runId: "r2" };
        },
        cancel: () => {},
      },
    });
    const out = await dispatch(api, CHANNELS.chatResume, [
      { threadId: "t1", decisions: [{ type: "approve" }], interruptId: "i1", runId: "r1" },
    ]);
    expect(out).toEqual({ runId: "r2" });
    expect(got).toEqual({
      threadId: "t1",
      decisions: [{ type: "approve" }],
      interruptId: "i1",
      runId: "r1",
    });
  });

  it("routes chat:cancel to the control", async () => {
    let cancelled: string | null = null;
    const api = createApi({
      projectRoot: null,
      chat: {
        send: () => ({ runId: "r1" }),
        resume: () => ({ runId: "r2" }),
        cancel: (input) => {
          cancelled = input.runId;
        },
      },
    });
    await dispatch(api, CHANNELS.chatCancel, [{ runId: "r9" }]);
    expect(cancelled).toBe("r9");
  });

  it("refuses chat:send without a project window — no control wired", async () => {
    const api = createApi({ projectRoot: null });
    await expect(
      dispatch(api, CHANNELS.chatSend, [{ text: "hi", threadId: "t1" }]),
    ).rejects.toThrow(/agent is not available/);
  });

  it("refuses malformed chat:send", async () => {
    const api = createApi({
      projectRoot: null,
      chat: { send: () => ({ runId: "r" }), resume: () => ({ runId: "r" }), cancel: () => {} },
    });
    await expect(dispatch(api, CHANNELS.chatSend, [{ text: "hi" }])).rejects.toThrow(
      /text, threadId/,
    );
    await expect(dispatch(api, CHANNELS.chatSend, [])).rejects.toThrow(/text, threadId/);
  });

  it("refuses malformed chat:resume", async () => {
    const api = createApi({
      projectRoot: null,
      chat: { send: () => ({ runId: "r" }), resume: () => ({ runId: "r" }), cancel: () => {} },
    });
    await expect(
      dispatch(api, CHANNELS.chatResume, [{ threadId: "t", decisions: [], interruptId: "i" }]),
    ).rejects.toThrow(/threadId, decisions, interruptId, runId/);
  });
});

/**
 * A fake `EmbeddedAgent` whose `streamEvents` yields the frames a test supplies
 * and whose `getState` answers the state a test supplies. Built through the
 * same `BuildAgent` seam a test passes to {@link createChatControl}.
 */
function fakeAgent(frames: unknown[], state: unknown): BuildAgent {
  return () =>
    ({
      agent: {
        async *streamEvents() {
          for (const f of frames) yield f;
        },
        async getState() {
          return state;
        },
      },
    }) as unknown as EmbeddedAgent;
}

describe("createChatControl run loop (2.6, 3.2)", () => {
  let root: string;
  beforeEach(() => (root = mkdtempSync(join(tmpdir(), "ow-chat-"))));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const creds = (): ChatCredentials => ({
    apiKey: "not-a-real-key",
    modelName: "openai/gpt-oss-120b",
  });

  it("refuses to run with no credential and pushes an error in place (R1.3)", () => {
    const pushed: ChatEvent[] = [];
    const control = createChatControl({
      projectRoot: root,
      resolveCredentials: () => null,
      send: (_c, p) => pushed.push(p as ChatEvent),
      buildAgent: fakeAgent([], { tasks: [] }),
    });
    control.send({ text: "hi", threadId: "t" });
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.kind).toBe("error");
    expect((pushed[0] as { message: string }).message).toMatch(/no Groq key/i);
  });

  it("forwards token and tool frames, then done (R1.2, R5.2)", async () => {
    const pushed: ChatEvent[] = [];
    const frames = [
      { event: "on_chat_model_stream", data: { chunk: { content: "Hel" } } },
      { event: "on_chat_model_stream", data: { chunk: { content: "lo" } } },
      { event: "on_tool_start", name: "read_file", data: { input: { path: "wiki/a.md" } } },
      { event: "on_tool_end", name: "read_file", data: { output: "body" } },
    ];
    const control = createChatControl({
      projectRoot: root,
      resolveCredentials: creds,
      send: (_c, p) => pushed.push(p as ChatEvent),
      buildAgent: fakeAgent(frames, { tasks: [] }),
    });
    control.send({ text: "hi", threadId: "t" });
    await waitFor(() => pushed.length >= 4 && pushed[pushed.length - 1]!.kind === "done");
    const kinds = pushed.map((e) => e.kind);
    expect(kinds).toEqual(["token", "token", "tool", "tool", "done"]);
    expect((pushed[0] as { text: string }).text).toBe("Hel");
    expect((pushed[2] as { phase: string }).phase).toBe("start");
    expect((pushed[3] as { phase: string }).phase).toBe("end");
  });

  it("drops tool-call deltas and non-text content from the model stream", async () => {
    const pushed: ChatEvent[] = [];
    const frames = [
      { event: "on_chat_model_stream", data: { chunk: { content: [{ type: "tool_use" }] } } },
      { event: "on_chat_model_stream", data: { chunk: { content: "" } } },
      { event: "on_chat_model_stream", data: { chunk: { content: "x" } } },
    ];
    const control = createChatControl({
      projectRoot: root,
      resolveCredentials: creds,
      send: (_c, p) => pushed.push(p as ChatEvent),
      buildAgent: fakeAgent(frames, { tasks: [] }),
    });
    control.send({ text: "hi", threadId: "t" });
    await waitFor(() => pushed.some((e) => e.kind === "done"));
    const tokens = pushed.filter((e) => e.kind === "token");
    expect(tokens).toHaveLength(1);
    expect((tokens[0] as { text: string }).text).toBe("x");
  });

  it("surfaces a paused run as an interrupt with the proposed action (R5.1)", async () => {
    const pushed: ChatEvent[] = [];
    const actionRequests: ChatActionRequest[] = [
      { name: "write_file", args: { path: "wiki/new.md", content: "body" } },
    ];
    const reviewConfigs: ChatReviewConfig[] = [
      { actionName: "write_file", allowedDecisions: ["approve", "edit", "reject"] },
    ];
    const state = {
      tasks: [{ interrupts: [{ id: "int-1", value: { actionRequests, reviewConfigs } }] }],
    };
    const control = createChatControl({
      projectRoot: root,
      resolveCredentials: creds,
      send: (_c, p) => pushed.push(p as ChatEvent),
      buildAgent: fakeAgent([], state),
    });
    const { runId } = control.send({ text: "write a page", threadId: "t" });
    await waitFor(() => pushed.some((e) => e.kind === "interrupt"));
    const interrupt = pushed.find((e) => e.kind === "interrupt") as Extract<
      ChatEvent,
      { kind: "interrupt" }
    >;
    expect(interrupt.interruptId).toBe("int-1");
    expect(interrupt.runId).toBe(runId);
    expect(interrupt.actionRequests).toEqual(actionRequests);
    expect(interrupt.reviewConfigs).toEqual(reviewConfigs);
  });

  it("carries every match site on a replace_all edit's interrupt (R5.2, 6.9)", async () => {
    mkdirSync(join(root, "wiki"), { recursive: true });
    writeFileSync(join(root, "wiki", "a.md"), "the x\nno match\nand x\nx again\n");
    const pushed: ChatEvent[] = [];
    const actionRequests: ChatActionRequest[] = [
      {
        name: "edit_file",
        args: { path: "wiki/a.md", old_string: "x", new_string: "y", replace_all: true },
      },
    ];
    const control = createChatControl({
      projectRoot: root,
      resolveCredentials: creds,
      send: (_c, p) => pushed.push(p as ChatEvent),
      buildAgent: fakeAgent([], {
        tasks: [{ interrupts: [{ id: "int-9", value: { actionRequests } }] }],
      }),
    });
    control.send({ text: "replace all", threadId: "t" });
    await waitFor(() => pushed.some((e) => e.kind === "interrupt"));
    const interrupt = pushed.find((e) => e.kind === "interrupt") as Extract<
      ChatEvent,
      { kind: "interrupt" }
    >;
    // The proposal alone would show `x` → `y` once, indistinguishable from a
    // single-site edit. The preview is what tells the human it is three places,
    // where they are, and what the page will read like afterwards (R5.2).
    const preview = interrupt.previews?.[0];
    expect(preview).toBeTruthy();
    expect(preview!.occurrences).toBe(3);
    expect(preview!.replaced).toBe(3);
    expect(preview!.sites.map((s) => s.line)).toEqual([1, 3, 4]);
    expect(preview!.resulting).toBe("the y\nno match\nand y\ny again\n");
  });

  it("carries no preview for a proposal that is not an edit (R5.2)", async () => {
    const pushed: ChatEvent[] = [];
    const actionRequests: ChatActionRequest[] = [
      { name: "write_file", args: { path: "wiki/new.md", content: "body" } },
    ];
    const control = createChatControl({
      projectRoot: root,
      resolveCredentials: creds,
      send: (_c, p) => pushed.push(p as ChatEvent),
      buildAgent: fakeAgent([], {
        tasks: [{ interrupts: [{ id: "int-10", value: { actionRequests } }] }],
      }),
    });
    control.send({ text: "write", threadId: "t" });
    await waitFor(() => pushed.some((e) => e.kind === "interrupt"));
    const interrupt = pushed.find((e) => e.kind === "interrupt") as Extract<
      ChatEvent,
      { kind: "interrupt" }
    >;
    expect(interrupt.previews).toEqual([null]);
  });

  it("rebuilds the agent when the credential is rotated, and not otherwise", async () => {
    const built: ChatCredentials[] = [];
    let current: ChatCredentials = { apiKey: "first", modelName: "openai/gpt-oss-120b" };
    const control = createChatControl({
      projectRoot: root,
      resolveCredentials: () => current,
      send: () => {},
      buildAgent: (input) => {
        built.push({ apiKey: input.apiKey, modelName: input.modelName });
        return {
          agent: {
            async *streamEvents() {},
            async getState() {
              return { tasks: [] };
            },
          },
        } as unknown as EmbeddedAgent;
      },
    });
    control.send({ text: "one", threadId: "t" });
    control.send({ text: "two", threadId: "t" });
    // Same credential and model — one build, cached for the window.
    expect(built).toHaveLength(1);

    // A rotated key must not keep reaching the model with the key the user just
    // revoked, which is usually revoked because it leaked.
    current = { apiKey: "second", modelName: "openai/gpt-oss-120b" };
    control.send({ text: "three", threadId: "t" });
    expect(built).toHaveLength(2);
    expect(built[1]!.apiKey).toBe("second");

    // And a changed model selection takes effect on the next send, too.
    current = { apiKey: "second", modelName: "another/model" };
    control.send({ text: "four", threadId: "t" });
    expect(built).toHaveLength(3);
    expect(built[2]!.modelName).toBe("another/model");
  });

  it("emits done (not error) when the user cancels a run (R5.5)", async () => {
    const pushed: ChatEvent[] = [];
    let releaseStream: () => void = () => {};
    const release = new Promise<void>((r) => (releaseStream = r));
    const control = createChatControl({
      projectRoot: root,
      resolveCredentials: creds,
      send: (_c, p) => pushed.push(p as ChatEvent),
      buildAgent: () =>
        ({
          agent: {
            async *streamEvents(_input: unknown, opts: { signal?: AbortSignal }) {
              // Hold the stream so cancel can abort it mid-flight.
              const signal: AbortSignal | undefined = opts?.signal;
              if (!signal) {
                await release;
                return;
              }
              yield { event: "on_chat_model_stream", data: { chunk: { content: "p" } } };
              const aborted = new Promise<void>((r2) =>
                signal.addEventListener("abort", () => r2()),
              );
              await Promise.race([release, aborted]);
            },
            async getState() {
              return { tasks: [] };
            },
          },
        }) as unknown as EmbeddedAgent,
    });
    const { runId } = control.send({ text: "hi", threadId: "t" });
    await waitFor(() => pushed.some((e) => e.kind === "token"));
    control.cancel({ runId });
    releaseStream();
    await waitFor(() => pushed.some((e) => e.kind === "done"));
    const kinds = pushed.map((e) => e.kind);
    expect(kinds).not.toContain("error");
    expect(kinds).toContain("done");
  });

  it("emits an error in place when the stream throws (R1.4)", async () => {
    const pushed: ChatEvent[] = [];
    const control = createChatControl({
      projectRoot: root,
      resolveCredentials: creds,
      send: (_c, p) => pushed.push(p as ChatEvent),
      buildAgent: () =>
        ({
          agent: {
            // eslint-disable-next-line require-yield -- the stream throws before any frame
            async *streamEvents() {
              throw new Error("groq blew up");
            },
            async getState() {
              return { tasks: [] };
            },
          },
        }) as unknown as EmbeddedAgent,
    });
    control.send({ text: "hi", threadId: "t" });
    await waitFor(() => pushed.some((e) => e.kind === "error"));
    const err = pushed.find((e) => e.kind === "error") as Extract<ChatEvent, { kind: "error" }>;
    expect(err.message).toMatch(/groq blew up/);
  });

  it("injects the harness entry as the first user message on an empty thread, and not on a later turn (R2.9)", async () => {
    // The harness entry (CLAUDE.md / AGENTS.md) is the conversation's first user
    // message, injected once on the empty thread and then carried by the
    // checkpointer — not re-sent every turn. Asserted by capturing the input the
    // run loop hands to `streamEvents`: turn 1 carries the entry ahead of the
    // user's text; turn 2 carries only the user's text.
    const seen: unknown[] = [];
    let getStateCalls = 0;
    const harnessEntry = { content: "HARNESS-ENTRY", path: "CLAUDE.md" };
    const pushed: ChatEvent[] = [];
    const control = createChatControl({
      projectRoot: root,
      resolveCredentials: creds,
      send: (_c, p) => pushed.push(p as ChatEvent),
      buildAgent: () =>
        ({
          agent: {
            async *streamEvents(input: unknown) {
              seen.push(input);
              yield { event: "on_chat_model_stream", data: { chunk: { content: "ok" } } };
            },
            async getState() {
              getStateCalls += 1;
              // The first read (before turn 1) sees an empty thread; every later
              // read sees the conversation the checkpointer now holds.
              return getStateCalls === 1
                ? { tasks: [], values: { messages: [] } }
                : { tasks: [], values: { messages: [{ role: "user", content: "prior" }] } };
            },
          },
          harnessEntry,
        }) as unknown as EmbeddedAgent,
    });
    control.send({ text: "first", threadId: "t" });
    await waitFor(() => pushed.some((e) => e.kind === "done"));
    const first = seen[0] as { messages: { role: string; content: string }[] };
    // Turn 1: the harness entry is injected ahead of the user's first message.
    expect(first.messages[0]).toEqual({ role: "user", content: "HARNESS-ENTRY" });
    expect(first.messages[1]).toEqual({ role: "user", content: "first" });

    control.send({ text: "second", threadId: "t" });
    await waitFor(() => pushed.filter((e) => e.kind === "done").length >= 2);
    const second = seen[1] as { messages: { role: string; content: string }[] };
    // Turn 2: the checkpointer already holds the entry, so only the user's text
    // is sent — the entry is not re-injected every turn.
    expect(second.messages).toEqual([{ role: "user", content: "second" }]);
  });

  it("sends only the user's text when the project has no harness entry (R2.9)", async () => {
    // A project with neither CLAUDE.md nor AGENTS.md resolves no harness entry,
    // so the run loop sends only the user's text — the fixed system prompt alone
    // frames the agent.
    const seen: unknown[] = [];
    const pushed: ChatEvent[] = [];
    const control = createChatControl({
      projectRoot: root,
      resolveCredentials: creds,
      send: (_c, p) => pushed.push(p as ChatEvent),
      buildAgent: () =>
        ({
          agent: {
            async *streamEvents(input: unknown) {
              seen.push(input);
              yield { event: "on_chat_model_stream", data: { chunk: { content: "ok" } } };
            },
            async getState() {
              return { tasks: [], values: { messages: [] } };
            },
          },
          harnessEntry: null,
        }) as unknown as EmbeddedAgent,
    });
    control.send({ text: "hello", threadId: "t" });
    await waitFor(() => pushed.some((e) => e.kind === "done"));
    const first = seen[0] as { messages: { role: string; content: string }[] };
    expect(first.messages).toEqual([{ role: "user", content: "hello" }]);
  });
});

async function waitFor(cond: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the chat run loop");
    await new Promise((r) => setTimeout(r, 10));
  }
}
