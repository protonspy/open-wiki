import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uploadTextSource, readIndex } from "@open-wiki/access";
import { gateOutput } from "../src/commands/gate.js";

/**
 * `ow gate pre|post` as the harness invokes it (plan 9.5): a JSON payload on
 * stdin, and JSON on stdout for PreToolUse. What is checked here is the wiring
 * between the payload and the handlers — that the decision reaches stdout in
 * the shape the hook contract expects, that `cwd` in the payload is what names
 * the project, and that a payload the gate cannot read passes through rather
 * than blocking the agent's tool on a parse error.
 */

const DATE = "2026-08-01";

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "ow-gate-"));
  mkdirSync(join(root, "wiki"), { recursive: true });
  mkdirSync(join(root, "raw"), { recursive: true });
  mkdirSync(join(root, ".state"), { recursive: true });
  return root;
}

function page(slug: string, title: string, body: string): string {
  return [
    "---",
    `id: concept:${slug}`,
    "type: concept",
    `title: ${title}`,
    "status: active",
    "aliases: []",
    'updated: ""',
    "sources: []",
    'superseded-by: ""',
    "---",
    body,
  ].join("\n");
}

interface HookOutput {
  hookSpecificOutput: {
    permissionDecision: "allow" | "deny";
    permissionDecisionReason?: string;
    updatedInput?: { content: string };
  };
}

const parse = (raw: string | null): HookOutput => JSON.parse(raw!) as HookOutput;

describe("ow gate pre (9.5)", () => {
  let root: string;
  let sourceId: string;

  beforeEach(() => {
    root = tempProject();
    sourceId = uploadTextSource(root, "Notes", "# Notes\n\nFenix is a rebuild.\n").id;
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function payload(content: string, slug = "fenix"): string {
    return JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      cwd: root,
      tool_use_id: `tu_${slug}`,
      tool_input: { file_path: join(root, "wiki", `${slug}.md`), content },
    });
  }

  it("prints the completed content as updatedInput", () => {
    const out = parse(gateOutput("pre", payload(page("fenix", "Fenix", `See src://${sourceId}#p1.\n`)), root, DATE));
    expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(out.hookSpecificOutput.updatedInput!.content).toContain(`updated: ${DATE}`);
  });

  it("prints a denial the agent can act on", () => {
    const out = parse(gateOutput("pre", payload(page("bogus", "Bogus", "See src://nope#p1.\n"), "bogus"), root, DATE));
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("nope");
  });

  it("prints nothing for a tool the gate has no opinion about", () => {
    const raw = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      cwd: root,
      tool_use_id: "tu_r",
      tool_input: { file_path: join(root, "wiki", "fenix.md") },
    });
    expect(gateOutput("pre", raw, root, DATE)).toBeNull();
  });

  it("takes the project from the payload's cwd, not from where the process happens to be", () => {
    // The fallback names a directory that is not a project at all: if the gate
    // used it, the write would not be recognised as a wiki write.
    const elsewhere = mkdtempSync(join(tmpdir(), "ow-gate-elsewhere-"));
    try {
      const out = parse(
        gateOutput("pre", payload(page("fenix", "Fenix", `See src://${sourceId}#p1.\n`)), elsewhere, DATE),
      );
      expect(out.hookSpecificOutput.updatedInput!.content).toContain(`updated: ${DATE}`);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("falls back to the given cwd when the payload names none", () => {
    const raw = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_use_id: "tu_nocwd",
      tool_input: {
        file_path: join(root, "wiki", "fenix.md"),
        content: page("fenix", "Fenix", `See src://${sourceId}#p1.\n`),
      },
    });
    const out = parse(gateOutput("pre", raw, root, DATE));
    expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("passes through a payload it cannot read rather than blocking the tool", () => {
    expect(gateOutput("pre", "{ not json", root, DATE)).toBeNull();
    expect(gateOutput("post", "{ not json", root, DATE)).toBeNull();
  });

  it("passes through an empty payload", () => {
    expect(gateOutput("pre", "", root, DATE)).toBeNull();
    expect(gateOutput("pre", "   \n", root, DATE)).toBeNull();
  });
});

describe("ow gate post (9.5)", () => {
  let root: string;
  let sourceId: string;

  beforeEach(() => {
    root = tempProject();
    sourceId = uploadTextSource(root, "Notes", "# Notes\n\nFenix is a rebuild.\n").id;
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("records the write the pre pass accepted, and prints nothing", () => {
    const file = join(root, "wiki", "fenix.md");
    const pre = parse(
      gateOutput(
        "pre",
        JSON.stringify({
          hook_event_name: "PreToolUse",
          tool_name: "Write",
          cwd: root,
          tool_use_id: "tu_1",
          tool_input: { file_path: file, content: page("fenix", "Fenix", `See src://${sourceId}#p1.\n`) },
        }),
        root,
        DATE,
      ),
    );
    writeFileSync(file, pre.hookSpecificOutput.updatedInput!.content, "utf8");

    const out = gateOutput(
      "post",
      JSON.stringify({
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        cwd: root,
        tool_use_id: "tu_1",
        tool_input: { file_path: file, content: "" },
        tool_response: {},
      }),
      root,
      DATE,
    );

    expect(out).toBeNull();
    expect(readIndex(root)).toContain("[[fenix]]");
    expect(existsSync(join(root, ".state", "pending", "tu_1.json"))).toBe(false);
    expect(readFileSync(join(root, "wiki", "fenix.md"), "utf8")).toContain("Fenix");
  });
});
