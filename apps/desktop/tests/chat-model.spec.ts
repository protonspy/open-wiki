import { describe, expect, it } from "vitest";
import type { ChatActionRequest, ChatEvent } from "../src/main/agent/chat-events.js";
import {
  applyEvent,
  initialChat,
  proposalOf,
  resumeRun,
  sendUser,
} from "../src/renderer/chat-model.js";

/**
 * The pure half of the chat pane (group 4): folding the event stream into a
 * conversation, and reading the write proposal off the tool args the middleware
 * surfaced. The React component is thin; this is what it has to get right.
 */

describe("sendUser / resumeRun (R1.2, R5.3)", () => {
  it("appends the user's message and marks the run live", () => {
    const s = sendUser(initialChat, "write a page");
    expect(s.running).toBe(true);
    expect(s.messages).toEqual([{ role: "user", text: "write a page", tools: [] }]);
    expect(s.interrupt).toBeNull();
    expect(s.error).toBeNull();
  });

  it("resume clears the interrupt and marks the run live again", () => {
    const paused = {
      ...initialChat,
      running: false,
      interrupt: {
        runId: "r1",
        interruptId: "i1",
        actionRequests: [{ name: "write_file", args: { path: "wiki/a.md", content: "x" } }],
      },
    };
    const s = resumeRun(paused);
    expect(s.running).toBe(true);
    expect(s.interrupt).toBeNull();
  });
});

describe("applyEvent — tokens (R1.2)", () => {
  it("starts an assistant turn and concatenates deltas into it", () => {
    let s = sendUser(initialChat, "hi");
    s = applyEvent(s, token("Hel"));
    s = applyEvent(s, token("lo"));
    expect(s.messages[1]).toEqual({ role: "assistant", text: "Hello", tools: [] });
  });

  it("appends to the current assistant turn, not a new one", () => {
    let s = sendUser(initialChat, "hi");
    s = applyEvent(s, token("a"));
    s = applyEvent(s, token("b"));
    expect(s.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
  });
});

describe("applyEvent — tools (R5.2)", () => {
  it("records a tool call as completed once its end arrives", () => {
    let s = sendUser(initialChat, "read");
    s = applyEvent(s, tool("read_file", "start", { path: "wiki/a.md" }));
    // While in flight, the call is a start.
    expect(s.messages[s.messages.length - 1]!.tools).toEqual([
      { name: "read_file", phase: "start", args: { path: "wiki/a.md" } },
    ]);
    s = applyEvent(s, tool("read_file", "end", undefined, "body"));
    // The same call, now completed with its result — one entry, not two.
    const assistant = s.messages[s.messages.length - 1]!;
    expect(assistant.tools).toEqual([
      { name: "read_file", phase: "end", args: { path: "wiki/a.md" }, result: "body" },
    ]);
  });

  it("matches an end to the most recent unfinished call of the same name", () => {
    let s = sendUser(initialChat, "two reads");
    s = applyEvent(s, tool("read_file", "start", { path: "a.md" }));
    s = applyEvent(s, tool("read_file", "start", { path: "b.md" }));
    s = applyEvent(s, tool("read_file", "end", undefined, "B"));
    const tools = s.messages[s.messages.length - 1]!.tools;
    expect(tools[1]).toMatchObject({ phase: "end", result: "B" });
    expect(tools[0]).toMatchObject({ phase: "start" });
  });
});

describe("applyEvent — interrupt (R5.1, R5.5)", () => {
  it("pauses the run and stores the proposed write", () => {
    let s = sendUser(initialChat, "write");
    s = applyEvent(
      s,
      interrupt("r1", "i1", [{ name: "write_file", args: { path: "wiki/a.md", content: "x" } }]),
    );
    expect(s.running).toBe(false);
    expect(s.interrupt?.runId).toBe("r1");
    expect(s.interrupt?.actionRequests).toHaveLength(1);
  });

  it("replaces an existing interrupt with a fresh proposal (R5.5, 4.3)", () => {
    let s = sendUser(initialChat, "edit");
    s = applyEvent(
      s,
      interrupt("r1", "i1", [{ name: "edit_file", args: { path: "wiki/a.md", old_string: "x" } }]),
    );
    // The page changed; the run re-interrupts with a fresh proposal.
    s = applyEvent(
      s,
      interrupt("r1", "i2", [{ name: "edit_file", args: { path: "wiki/a.md", old_string: "y" } }]),
    );
    expect(s.interrupt?.interruptId).toBe("i2");
    expect(s.interrupt?.actionRequests[0]?.args).toMatchObject({ old_string: "y" });
  });
});

describe("applyEvent — done and error (R1.4)", () => {
  it("done ends the run", () => {
    let s = sendUser(initialChat, "hi");
    s = applyEvent(s, done("r1"));
    expect(s.running).toBe(false);
  });

  it("error ends the run and surfaces the message, keeping the conversation", () => {
    let s = sendUser(initialChat, "hi");
    s = applyEvent(s, token("half a turn"));
    s = applyEvent(s, err("r1", "groq blew up"));
    expect(s.running).toBe(false);
    expect(s.error).toBe("groq blew up");
    // The conversation that produced the error is preserved.
    expect(s.messages).toHaveLength(2);
    expect(s.messages[1]?.text).toBe("half a turn");
  });
});

describe("proposalOf (R5.2)", () => {
  it("reads a write_file proposal", () => {
    expect(
      proposalOf({ name: "write_file", args: { path: "wiki/new.md", content: "body" } }),
    ).toEqual({ tool: "write_file", path: "wiki/new.md", newString: "body" });
  });

  it("reads an edit_file proposal, including replace_all", () => {
    expect(
      proposalOf({
        name: "edit_file",
        args: { path: "wiki/a.md", old_string: "x", new_string: "y", replace_all: true },
      }),
    ).toEqual({
      tool: "edit_file",
      path: "wiki/a.md",
      oldString: "x",
      newString: "y",
      replaceAll: true,
    });
  });

  it("reads a rename_page proposal", () => {
    expect(
      proposalOf({ name: "rename_page", args: { from: "wiki/old.md", to: "wiki/new.md" } }),
    ).toEqual({ tool: "rename_page", path: "wiki/old.md", to: "wiki/new.md" });
  });

  it("reads a delete_page proposal", () => {
    expect(proposalOf({ name: "delete_page", args: { path: "wiki/old.md" } })).toEqual({
      tool: "delete_page",
      path: "wiki/old.md",
    });
  });

  it("returns null for a tool with no path", () => {
    expect(proposalOf({ name: "read_file", args: {} })).toBeNull();
  });

  // deepagents' filesystem tools name the target `file_path`; `path` is the
  // older shape. Reading only `path` returned null for every real proposal,
  // which dropped the card to its nothing-renderable fallback: approve or
  // reject, with the fields and the preview both gone. This is the arg name
  // the interrupt actually carries, so it is the one that has to work.
  it("reads file_path, the name the tools actually use", () => {
    expect(
      proposalOf({
        name: "edit_file",
        args: { file_path: "wiki/a.md", old_string: "x", new_string: "y" },
      }),
    ).toEqual({
      tool: "edit_file",
      path: "wiki/a.md",
      oldString: "x",
      newString: "y",
      replaceAll: false,
    });
    expect(
      proposalOf({ name: "write_file", args: { file_path: "wiki/new.md", content: "body" } }),
    ).toEqual({ tool: "write_file", path: "wiki/new.md", newString: "body" });
  });
});

function token(text: string): ChatEvent {
  return { kind: "token", threadId: "t", runId: "r", text };
}

function tool(name: string, phase: "start" | "end", args?: unknown, result?: unknown): ChatEvent {
  return { kind: "tool", threadId: "t", runId: "r", name, phase, args, result };
}

function interrupt(
  runId: string,
  interruptId: string,
  actionRequests: ChatActionRequest[],
): ChatEvent {
  return { kind: "interrupt", threadId: "t", runId, interruptId, actionRequests };
}

function done(runId: string): ChatEvent {
  return { kind: "done", threadId: "t", runId };
}

function err(runId: string, message: string): ChatEvent {
  return { kind: "error", threadId: "t", runId, message };
}
