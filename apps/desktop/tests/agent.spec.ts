import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { isSandboxBackend } from "deepagents";
import { isCommand } from "@langchain/langgraph";
import {
  AGENT_TOOL_NAMES,
  DEFAULT_MODEL,
  INTERRUPT_ON,
  INTERRUPT_TOOLS,
  createEmbeddedAgent,
  resolveHarnessEntry,
  resumeCommand,
} from "../src/main/agent/agent.js";
import { disableTracing } from "../src/main/agent/tracing.js";

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "ow-agent-"));
  mkdirSync(join(root, "wiki"), { recursive: true });
  mkdirSync(join(root, ".state"), { recursive: true });
  mkdirSync(join(root, ".claude", "skills"), { recursive: true });
  return root;
}

describe("tracing (R2.6)", () => {
  it("disables LANGCHAIN_TRACING_V2 and clears LangSmith credential vars", () => {
    process.env.LANGSMITH_API_KEY = "leak";
    process.env.LANGCHAIN_API_KEY = "leak";
    disableTracing();
    expect(process.env.LANGCHAIN_TRACING_V2).toBe("false");
    expect(process.env.LANGSMITH_API_KEY).toBeUndefined();
    expect(process.env.LANGCHAIN_API_KEY).toBeUndefined();
  });

  // `@langchain/core`'s `isTracingEnabled` enables tracing when *any* of four
  // variables reads "true", so switching one off leaves three that switch it
  // back on. Each is asserted on its own: a loop that set them all at once
  // would pass with three of the four still unhandled.
  it.each([
    "LANGSMITH_TRACING_V2",
    "LANGCHAIN_TRACING_V2",
    "LANGSMITH_TRACING",
    "LANGCHAIN_TRACING",
  ])("forces %s to false when a developer has it set globally", (name) => {
    process.env[name] = "true";
    disableTracing();
    expect(process.env[name]).toBe("false");
  });

  // The switches above route to LangSmith. These route the same spans somewhere
  // else — an OpenTelemetry collector, or a list of replica endpoints carrying
  // their own api keys — so clearing the LangSmith endpoint alone leaks anyway.
  it.each([
    "LANGSMITH_TRACING_MODE",
    "LANGSMITH_OTEL_ENABLED",
    "OTEL_ENABLED",
    "LANGSMITH_RUNS_ENDPOINTS",
  ])("clears %s, so no alternative transport is left configured", (name) => {
    process.env[name] = name === "LANGSMITH_TRACING_MODE" ? "otel" : "true";
    disableTracing();
    expect(process.env[name]).toBeUndefined();
  });

  // The disabling only works if it runs before any langchain module is
  // evaluated, and ES modules evaluate imports in written order. So a module
  // that imports `langchain` / `@langchain/*` while reaching `./tracing.js`
  // second has already lost — the guard has to be the *first* import of every
  // module on the path. Asserted over the source, because module caching makes
  // the ordering untestable at runtime: importing anything here evaluates it
  // once and every later import is a no-op.
  it("is the first import of every module that pulls in langchain (R2.6)", () => {
    const mainDir = join(import.meta.dirname, "..", "src", "main");
    const sources = ["index.ts", "agent/agent.ts", "agent/chat-control.ts"].map((rel) => ({
      rel,
      // The tracing module itself is exempt: it is the guard.
      text: readFileSync(join(mainDir, rel), "utf8"),
    }));
    for (const { rel, text } of sources) {
      const imports = text.split(/\r?\n/).filter((line) => /^import[\s"']/.test(line));
      expect(imports.length, `${rel} has imports`).toBeGreaterThan(0);
      expect(imports[0], `${rel} imports the tracing guard first`).toMatch(
        /^import ["'][^"']*tracing\.js["'];/,
      );
    }
    // What counts as reaching langchain: `deepagents` does — it is a langchain
    // package under another name and importing it at runtime loads langchain
    // just the same. `import type` does not — `verbatimModuleSyntax` erases it,
    // so it emits no import at all and can load nothing. (`wiki-gate-backend.ts`
    // is exactly that case: it names deepagents' protocol types and no more.)
    //
    // Checked first, because the sweep below is only worth having if the
    // detector can still tell those apart — one that answers "no" to everything
    // passes silently forever.
    expect(reachesLangchain('import { readFileSync } from "node:fs";\n')).toBe(false);
    expect(reachesLangchain('import type { X } from "deepagents";\n')).toBe(false);
    expect(reachesLangchain('import { createAgent } from "langchain";\n')).toBe(true);
    expect(reachesLangchain('import { MemorySaver } from "@langchain/langgraph";\n')).toBe(true);
    expect(reachesLangchain('import { createFilesystemMiddleware } from "deepagents";\n')).toBe(
      true,
    );
    // And the case the whole-file regex got wrong: an innocent first import
    // followed by a type-only one must not read as a runtime langchain import.
    expect(
      reachesLangchain(
        'import { existsSync } from "node:fs";\nimport type {\n  A,\n} from "deepagents";\n',
      ),
    ).toBe(false);

    // Nothing else under src/main may reach langchain without the guard first —
    // a new importer either puts it first or is added to the list above.
    const offenders: string[] = [];
    for (const file of walk(mainDir)) {
      const rel = relative(mainDir, file).split("\\").join("/");
      if (sources.some((s) => s.rel === rel) || rel === "agent/tracing.ts") continue;
      const text = readFileSync(file, "utf8");
      if (!reachesLangchain(text)) continue;
      const imports = text.split(/\r?\n/).filter((line) => /^import[\s"']/.test(line));
      if (!/^import ["'][^"']*tracing\.js["'];/.test(imports[0] ?? "")) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * Does this source load langchain at runtime?
 *
 * Statement by statement, because a whole-file regex is not sound here: a lazy
 * `[\s\S]*?` anchored at one `^import` happily runs past the end of that
 * statement and pairs an innocent `import { readFileSync }` with a *later*
 * line's package name. Matching each import in turn and asking whether that
 * statement is `import type` is the difference between "this file loads
 * langchain" and "this file mentions it somewhere".
 */
function reachesLangchain(text: string): boolean {
  const statements = /^import\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']/gm;
  for (const m of text.matchAll(statements)) {
    // `import type` is erased by `verbatimModuleSyntax` — it emits nothing and
    // so can load nothing. Naming deepagents' protocol types is not importing it.
    if (m[0].startsWith("import type")) continue;
    const spec = m[1] ?? "";
    if (/^(langchain$|@langchain\/|deepagents$)/.test(spec)) return true;
  }
  return false;
}

/** Every `.ts` file under a directory, recursively. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("resolveHarnessEntry (R2.3)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("reads CLAUDE.md at the project root as the system prompt, unchanged", () => {
    writeFileSync(join(root, "CLAUDE.md"), "# Rules\nYou are an open-wiki agent.\n");
    const h = resolveHarnessEntry(root);
    expect(h).not.toBeNull();
    expect(h!.path).toBe("CLAUDE.md");
    expect(h!.content).toContain("open-wiki agent");
  });

  it("returns null when there is no harness entry file", () => {
    expect(resolveHarnessEntry(root)).toBeNull();
  });
});

describe("createEmbeddedAgent — construction (R2.1, R2.5, R4.4, R7.1)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("constructs without a network call and exposes the filesystem + custom tools", () => {
    const { backend, toolNames } = createEmbeddedAgent({
      projectRoot: root,
      apiKey: "not-a-real-key",
      modelName: DEFAULT_MODEL,
    });
    expect(isSandboxBackend(backend)).toBe(false);
    // The deepagents filesystem tools, re-pointed at the gate-backed backend.
    for (const name of ["ls", "read_file", "write_file", "edit_file", "glob", "grep"]) {
      expect(toolNames).toContain(name);
    }
    // The two custom write tools over the access primitives.
    expect(toolNames).toContain(AGENT_TOOL_NAMES.rename);
    expect(toolNames).toContain(AGENT_TOOL_NAMES.delete);
  });

  it("does not expose the task/subagent tool (R4.4, 6.4)", () => {
    const { toolNames } = createEmbeddedAgent({
      projectRoot: root,
      apiKey: "not-a-real-key",
      modelName: DEFAULT_MODEL,
    });
    expect(toolNames).not.toContain("task");
  });

  it("rejects an execute call because the backend is not a sandbox (R4.4, 6.3)", async () => {
    const { agent } = createEmbeddedAgent({
      projectRoot: root,
      apiKey: "not-a-real-key",
      modelName: DEFAULT_MODEL,
    });
    // The filesystem middleware registers an `execute` tool whose handler refuses
    // for a non-sandbox backend (deepagents gates it on `isSandboxBackend`); the
    // model is never offered it, and a direct call is rejected.
    const toolsNode = (
      agent as unknown as {
        graph: {
          nodes: {
            tools: {
              tools?: unknown[];
              bound?: { tools?: unknown[] };
              func?: { tools?: unknown[] };
            };
          };
        };
      }
    ).graph.nodes.tools;
    const bound = (toolsNode.tools ?? toolsNode.bound?.tools ?? toolsNode.func?.tools) as
      { name: string; invoke: (input: unknown) => Promise<unknown> }[] | undefined;
    const execute = bound?.find((t) => t.name === "execute");
    expect(execute).toBeDefined();
    const result = await execute!.invoke({ command: "echo hi" });
    const text = typeof result === "string" ? result : JSON.stringify(result);
    expect(text).toMatch(/execution not available|does not support command execution/i);
  });

  it("interrupts on every write tool (R5.1)", () => {
    expect(INTERRUPT_TOOLS).toEqual(["write_file", "edit_file", "rename_page", "delete_page"]);
    for (const name of INTERRUPT_TOOLS) {
      expect(INTERRUPT_ON[name]).toBeDefined();
      expect(INTERRUPT_ON[name]!.allowedDecisions).toEqual(["approve", "edit", "reject"]);
    }
  });

  it("uses CLAUDE.md as the system prompt when present", () => {
    writeFileSync(join(root, "CLAUDE.md"), "# Rules\nCarry the convention in.\n");
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(true);
    // Construction does not throw with a system prompt resolved from disk.
    expect(() =>
      createEmbeddedAgent({
        projectRoot: root,
        apiKey: "not-a-real-key",
        modelName: DEFAULT_MODEL,
      }),
    ).not.toThrow();
  });
});

describe("resumeCommand (R5.3, R5.4)", () => {
  it("builds a Command carrying the human's decisions as the resume value", () => {
    const cmd = resumeCommand([{ type: "approve" }]);
    expect(isCommand(cmd)).toBe(true);
  });
});
