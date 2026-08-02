import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HumanMessage } from "@langchain/core/messages";
import { listOperations } from "@open-wiki/access";
import { createEmbeddedAgent, resumeCommand, type EmbeddedAgent } from "../src/main/agent/agent.js";
import { previewEdit } from "../src/main/agent/edit-preview.js";
import { WikiGateBackend } from "../src/main/agent/wiki-gate-backend.js";
import { ScriptedChatModel } from "./helpers/fake-model.js";

/**
 * The line is proved (group 6): the human-in-the-loop loop behaves the way the
 * spec claims. A scripted model — no network call — emits a write tool call, the
 * middleware interrupts *before* the tool runs, and the test resumes with the
 * human's decision. These are the invariants the security argument rests on:
 * a write never lands without an interrupt first, an approved write goes through
 * the store (validated, logged with origin `agent`, undoable), and a rejected
 * write never lands.
 */

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "ow-loop-"));
  mkdirSync(join(root, "wiki"), { recursive: true });
  mkdirSync(join(root, ".state"), { recursive: true });
  mkdirSync(join(root, ".claude", "skills"), { recursive: true });
  return root;
}

/** A minimal valid entity page the store's gate will accept. */
function validPage(slug: string, body = "Body.\n"): string {
  const fm = [
    `id: t:${slug}`,
    "type: t",
    `title: ${slug}`,
    "status: active",
    "aliases: []",
    'updated: ""',
    "sources: []",
    'superseded-by: ""',
  ].join("\n");
  return `---\n${fm}\n---\n${body}`;
}

let root: string;

beforeEach(() => (root = tempProject()));
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Read the interrupt the middleware surfaced, from the run's final state. */
function interruptOf(state: { tasks: Array<{ interrupts: Array<{ value?: unknown }> }> }): unknown {
  for (const task of state.tasks) {
    for (const interrupt of task.interrupts) {
      if (interrupt.value) return interrupt.value;
    }
  }
  return undefined;
}

/**
 * The agent wrapper's `getState` is typed as `never` (a placeholder); the real,
 * properly-typed `getState` lives on the compiled graph. Reach it through a
 * cast so the proof reads the run's state without fighting the wrapper's type.
 */
type AgentState = { tasks: Array<{ interrupts: Array<{ value?: unknown }> }> };
async function stateOf(embedded: EmbeddedAgent, config: unknown): Promise<AgentState> {
  return await (
    embedded.agent as unknown as { getState(c: unknown): Promise<AgentState> }
  ).getState(config);
}

/** Build an agent whose model is scripted to emit `write_file` then end with text. */
function agentWithWriteFile(path: string, content: string) {
  const model = new ScriptedChatModel([
    {
      toolCalls: [{ name: "write_file", args: { path, content } }],
    },
    { content: "Done." },
  ]);
  return createEmbeddedAgent({
    projectRoot: root,
    apiKey: "not-a-real-key",
    modelName: "unused-by-script",
    model,
  });
}

describe("the write loop — interrupt before the write (R5.1, 6.8)", () => {
  it("emits an interrupt and writes nothing before a decision", async () => {
    const embedded = agentWithWriteFile("wiki/fenix.md", validPage("fenix"));
    const config = { configurable: { thread_id: "t1" } };
    await embedded.agent.invoke(
      { messages: [new HumanMessage("write a page about fenix")] },
      config,
    );
    const state = await stateOf(embedded, config);
    // The middleware surfaced a HITL interrupt — the run is paused, not done.
    expect(interruptOf(state)).toBeDefined();
    // And crucially, the page is not on disk: nothing was written before the
    // human decided.
    expect(existsSync(join(root, "wiki", "fenix.md"))).toBe(false);
    expect(listOperations(root)).toHaveLength(0);
  });
});

describe("an approved write lands through the store (R4.1, R4.5, R5.3, 6.7)", () => {
  it("writes the page, logs the operation with origin agent, and is undoable", async () => {
    const embedded = agentWithWriteFile("wiki/fenix.md", validPage("fenix"));
    const config = { configurable: { thread_id: "t2" } };
    await embedded.agent.invoke(
      { messages: [new HumanMessage("write a page about fenix")] },
      config,
    );
    await embedded.agent.invoke(resumeCommand([{ type: "approve" }]), config);

    // The page landed on disk.
    expect(existsSync(join(root, "wiki", "fenix.md"))).toBe(true);
    // Through the store: one operation, origin "agent", and undoable (the
    // operation list is the undo history).
    const ops = listOperations(root);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.origin).toBe("agent");
    expect(ops[0]!.pages[0]!.path.replace(/\\/g, "/")).toBe("wiki/fenix.md");
  });
});

describe("a rejected write does not land (R5.3, 6.7)", () => {
  it("writes nothing and logs no operation", async () => {
    const embedded = agentWithWriteFile("wiki/rejected.md", validPage("rejected"));
    const config = { configurable: { thread_id: "t3" } };
    await embedded.agent.invoke({ messages: [new HumanMessage("write a page")] }, config);
    await embedded.agent.invoke(resumeCommand([{ type: "reject", message: "no" }]), config);

    expect(existsSync(join(root, "wiki", "rejected.md"))).toBe(false);
    expect(listOperations(root)).toHaveLength(0);
  });
});

describe("a replace_all edit's interrupt carries the flag and lands exactly (R5.2, 6.9)", () => {
  it("interrupts on a replace_all edit, and an approval replaces every match and nothing else", async () => {
    // Seed a page whose body has the match three times.
    writeFileSync(join(root, "wiki", "alpha.md"), validPage("alpha", "x x x\n"));
    const model = new ScriptedChatModel([
      {
        toolCalls: [
          {
            name: "edit_file",
            args: {
              path: join(root, "wiki", "alpha.md"),
              old_string: "x",
              new_string: "y",
              replace_all: true,
            },
          },
        ],
      },
      { content: "Done." },
    ]);
    const embedded = createEmbeddedAgent({
      projectRoot: root,
      apiKey: "not-a-real-key",
      modelName: "unused",
      model,
    });
    const config = { configurable: { thread_id: "t4" } };
    await embedded.agent.invoke({ messages: [new HumanMessage("replace all")] }, config);

    const state = await stateOf(embedded, config);
    const interrupt = interruptOf(state) as
      | {
          actionRequests?: Array<{ name: string; args: Record<string, unknown> }>;
        }
      | undefined;
    // The interrupt surfaces the edit_file call with replace_all set, so the
    // human is approving the global replace, not a single site.
    const action = interrupt?.actionRequests?.[0];
    expect(action?.name).toBe("edit_file");
    expect(action?.args["replace_all"]).toBe(true);

    // And the human is shown *where*: the args say "replace x with y", which for
    // a one-character match is exactly the smuggling case R5.2 exists to close.
    // The preview computed off the paused proposal names every site (R5.2, 6.9).
    const preview = previewEdit(root, "wiki/alpha.md", action!.args);
    expect(preview).toBeTruthy();
    expect(preview!.occurrences).toBe(3);
    expect(preview!.replaced).toBe(3);
    expect(preview!.sites).toHaveLength(3);
    expect(preview!.sites.every((s) => s.text.includes("x"))).toBe(true);
    expect(preview!.resulting).toContain("y y y");

    // Before the decision, the page is untouched.
    expect(readFileSync(join(root, "wiki", "alpha.md"), "utf8")).toContain("x x x");

    await embedded.agent.invoke(resumeCommand([{ type: "approve" }]), config);

    const after = readFileSync(join(root, "wiki", "alpha.md"), "utf8");
    expect(after).toContain("y y y");
    // The frontmatter (title: alpha, no "x") is intact — only the body changed.
    expect(after).toContain("title: alpha");
    expect(after).not.toMatch(/\bx\b/);
  });
});

describe("resuming against a page changed since the interrupt (R5.5, 6.14)", () => {
  it("does not apply the stale edit and re-interrupts with a fresh proposal", async () => {
    // Seed a page that already exists — the guard captures its content hash at
    // proposal time, so a change in the pause window is detectable.
    writeFileSync(join(root, "wiki", "old.md"), validPage("old", "A body\n"));
    const proposed = validPage("old", "B body\n");
    const model = new ScriptedChatModel([
      // First proposal: overwrite old.md with B. Interrupts before the write.
      { toolCalls: [{ name: "write_file", args: { path: "wiki/old.md", content: proposed } }] },
      // The stale write is refused; the model re-proposes (a fresh proposal).
      { toolCalls: [{ name: "write_file", args: { path: "wiki/old.md", content: proposed } }] },
      { content: "Done." },
    ]);
    const embedded = createEmbeddedAgent({
      projectRoot: root,
      apiKey: "not-a-real-key",
      modelName: "unused",
      model,
    });
    const config = { configurable: { thread_id: "t6" } };

    // 1. The first proposal interrupts before any write.
    await embedded.agent.invoke({ messages: [new HumanMessage("rewrite old")] }, config);
    const state1 = await stateOf(embedded, config);
    expect(interruptOf(state1)).toBeDefined();

    // 2. While paused, an outside writer changes the page (an editor save, a
    //    git pull, another agent). The approved write is now stale.
    writeFileSync(join(root, "wiki", "old.md"), validPage("old", "C body\n"));

    // 3. The user approves the (now-stale) proposal. The guard revalidates and
    //    refuses — the stale edit does NOT land. The page is still C, not B.
    await embedded.agent.invoke(resumeCommand([{ type: "approve" }]), config);
    expect(readFileSync(join(root, "wiki", "old.md"), "utf8")).toContain("C body");
    expect(readFileSync(join(root, "wiki", "old.md"), "utf8")).not.toContain("B body");

    // 4. The model re-proposed, and that fresh proposal interrupts again — a
    //    fresh review, not a silent clobber.
    const state2 = await stateOf(embedded, config);
    expect(interruptOf(state2)).toBeDefined();

    // 5. Approving the fresh proposal (the page is unchanged since it) applies it.
    await embedded.agent.invoke(resumeCommand([{ type: "approve" }]), config);
    const after = readFileSync(join(root, "wiki", "old.md"), "utf8");
    expect(after).toContain("B body");
    expect(after).not.toContain("C body");
  });
});

describe("eviction creates no file on disk (R4.3, 6.11)", () => {
  it("a run leaves no /large_tool_results/ or /conversation_history/ behind", async () => {
    // The filesystem middleware is built with toolTokenLimitBeforeEvict: null,
    // so it never tries to spill overflow to disk — and the gate would reject
    // those paths regardless. A completed run is the proof: nothing is created.
    const embedded = agentWithWriteFile("wiki/fenix.md", validPage("fenix"));
    const config = { configurable: { thread_id: "t5" } };
    await embedded.agent.invoke({ messages: [new HumanMessage("write a page")] }, config);
    await embedded.agent.invoke(resumeCommand([{ type: "approve" }]), config);

    expect(existsSync(join(root, "large_tool_results"))).toBe(false);
    expect(existsSync(join(root, "conversation_history"))).toBe(false);
  });

  it("the gate refuses the eviction paths directly, so raising the limit is still safe", () => {
    // The test above cannot trigger a real eviction — the null limit makes it
    // structurally impossible — so on its own it would pass whether or not the
    // second half of the claim ("the gate rejects the eviction path") were true.
    // This asserts that half against the backend, which is what would have to
    // hold if a future change ever gave the limit a number.
    const backend = new WikiGateBackend(root);
    for (const path of [
      "/large_tool_results/tool-1.txt",
      "/conversation_history/thread-1.json",
      "large_tool_results/tool-1.txt",
    ]) {
      const result = backend.write(path, "spilled tool output");
      expect(result, `${path} is refused`).toHaveProperty("error");
      expect(existsSync(join(root, "large_tool_results"))).toBe(false);
      expect(existsSync(join(root, "conversation_history"))).toBe(false);
    }
  });
});
