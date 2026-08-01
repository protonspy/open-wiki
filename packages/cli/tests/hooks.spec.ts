import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPreToolUse, runPostToolUse, detectShellWrite } from "../src/hooks.js";

function tempProject() {
  const root = mkdtempSync(join(tmpdir(), "ow-cli-"));
  mkdirSync(join(root, "wiki"), { recursive: true });
  mkdirSync(join(root, ".state"), { recursive: true });
  return root;
}

const DATE = "2026-08-01";
const GOOD_FM =
  'id: t:fenix\ntype: t\ntitle: Fenix\nstatus: active\naliases: []\nupdated: ""\nsources: []\nsuperseded-by: ""';
function page(fm: string, body = "Body.\n"): string {
  return `---\n${fm}\n---\n${body}`;
}

function preWrite(root: string, rel: string, content: string, tool_use_id = "tu_1") {
  return runPreToolUse(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      cwd: root,
      tool_use_id,
      tool_input: { file_path: join(root, rel), content },
    },
    root,
    DATE,
  );
}

describe("detectShellWrite (9.5)", () => {
  it("flags a redirection that writes a wiki page", () => {
    expect(detectShellWrite(`echo hi > wiki/fenix.md`, "/p")).toBe("wiki/fenix.md");
    expect(detectShellWrite(`cat x >> wiki/fenix.md`, "/p")).toBe("wiki/fenix.md");
  });
  it("flags cp/mv/tee/sed -i into wiki/ or codewiki/", () => {
    expect(detectShellWrite(`cp /tmp/x wiki/fenix.md`, "/p")).toBe("wiki/fenix.md");
    expect(detectShellWrite(`mv /tmp/x codewiki/dispatch.md`, "/p")).toBe("codewiki/dispatch.md");
    expect(detectShellWrite(`echo hi | tee wiki/fenix.md`, "/p")).toBe("wiki/fenix.md");
    expect(detectShellWrite(`sed -i 's/a/b/' wiki/fenix.md`, "/p")).toBe("wiki/fenix.md");
  });
  it("does not flag reading a wiki page", () => {
    expect(detectShellWrite(`cat wiki/fenix.md`, "/p")).toBeNull();
    expect(detectShellWrite(`grep x wiki/fenix.md`, "/p")).toBeNull();
    expect(detectShellWrite(`ls wiki/`, "/p")).toBeNull();
  });
  it("does not flag a write outside the wiki", () => {
    expect(detectShellWrite(`echo hi > notes/fenix.md`, "/p")).toBeNull();
    expect(detectShellWrite(`echo hi > README.md`, "/p")).toBeNull();
  });
  it("flags a shell write that uses Windows backslash separators", () => {
    expect(detectShellWrite(`echo hi > wiki\\fenix.md`, "/p")).toBe("wiki/fenix.md");
    expect(detectShellWrite(`cp /tmp/x codewiki\\dispatch.md`, "/p")).toBe("codewiki/dispatch.md");
  });
});

describe("runPreToolUse — Bash (9.5)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("denies a shell write to a wiki page and points at the convention", () => {
    const out = runPreToolUse(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        cwd: root,
        tool_use_id: "tu_b",
        tool_input: { command: `echo hi > wiki/fenix.md` },
      },
      root,
      DATE,
    );
    expect(out?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out?.hookSpecificOutput.permissionDecisionReason ?? "").toContain("wiki");
  });

  it("passes a shell command that only reads", () => {
    const out = runPreToolUse(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        cwd: root,
        tool_use_id: "tu_b",
        tool_input: { command: `cat wiki/fenix.md` },
      },
      root,
      DATE,
    );
    expect(out).toBeNull();
  });
});

describe("runPreToolUse — Write/Edit (9.5, 9.6)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("passes a non-gated file through unchanged", () => {
    expect(preWrite(root, "README.md", "hi\n")).toBeNull();
  });

  it("refuses a write to the gate's own configuration (9.6)", () => {
    const out = preWrite(root, ".claude/settings.json", "{}");
    expect(out?.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("completes and accepts a valid page, returning updatedInput", () => {
    const out = preWrite(root, "wiki/fenix.md", page(GOOD_FM));
    expect(out?.hookSpecificOutput.permissionDecision).toBe("allow");
    const ui = out?.hookSpecificOutput.updatedInput as { content: string };
    expect(ui.content).toContain("updated: 2026-08-01");
  });

  it("does not return updatedInput when completion changed nothing", () => {
    const filled = page(GOOD_FM.replace('updated: ""', "updated: 2026-08-01"));
    const out = preWrite(root, "wiki/fenix.md", filled);
    expect(out?.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(out?.hookSpecificOutput.updatedInput).toBeUndefined();
  });

  it("denies an invalid page with a readable reason", () => {
    const out = preWrite(root, "wiki/fenix.md", page(GOOD_FM.replace("type: t\n", "")));
    expect(out?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out?.hookSpecificOutput.permissionDecisionReason ?? "").toContain("type");
  });

  it("denies a page with a broken wikilink", () => {
    const out = preWrite(root, "wiki/fenix.md", page(GOOD_FM, "See [[no-such]].\n"));
    expect(out?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out?.hookSpecificOutput.permissionDecisionReason ?? "").toContain("no-such");
  });

  it("completes an Edit by replacing the whole file with the completed content", () => {
    writeFileSync(join(root, "wiki", "fenix.md"), page(GOOD_FM, "Old body.\n"));
    const out = runPreToolUse(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Edit",
        cwd: root,
        tool_use_id: "tu_e",
        tool_input: {
          file_path: join(root, "wiki", "fenix.md"),
          old_string: "Old body.",
          new_string: "New body.",
        },
      },
      root,
      DATE,
    );
    expect(out?.hookSpecificOutput.permissionDecision).toBe("allow");
    const ui = out?.hookSpecificOutput.updatedInput as { new_string: string };
    expect(ui.new_string).toContain("New body.");
    expect(ui.new_string).toContain("updated: 2026-08-01");
  });
});

describe("runPostToolUse — recording (9.5, 5.6, 5.7)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("records a created page in log.md, changelog.md and index.md after the write", () => {
    preWrite(root, "wiki/fenix.md", page(GOOD_FM), "tu_c");
    // The agent's tool performed the write with the completed content.
    writeFileSync(join(root, "wiki", "fenix.md"), page(GOOD_FM.replace('""', "2026-08-01")));
    runPostToolUse(
      {
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        cwd: root,
        tool_use_id: "tu_c",
        tool_input: { file_path: join(root, "wiki", "fenix.md"), content: "" },
        tool_response: {},
      },
      root,
      DATE,
    );
    expect(existsSync(join(root, "wiki", "log.md"))).toBe(true);
    expect(existsSync(join(root, "wiki", "changelog.md"))).toBe(true);
    expect(readFileSync(join(root, "wiki", "index.md"), "utf8")).toContain("[[fenix]]");
    expect(readFileSync(join(root, "wiki", "log.md"), "utf8")).toContain("created [[fenix]]");
  });

  it("records a modified page when the page already existed", () => {
    writeFileSync(join(root, "wiki", "fenix.md"), page(GOOD_FM.replace('""', "2026-08-01")));
    preWrite(root, "wiki/fenix.md", page(GOOD_FM, "edited.\n"), "tu_m");
    writeFileSync(join(root, "wiki", "fenix.md"), page(GOOD_FM.replace('""', "2026-08-01"), "edited.\n"));
    runPostToolUse(
      {
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        cwd: root,
        tool_use_id: "tu_m",
        tool_input: { file_path: join(root, "wiki", "fenix.md"), content: "" },
        tool_response: {},
      },
      root,
      DATE,
    );
    expect(readFileSync(join(root, "wiki", "log.md"), "utf8")).toContain("modified [[fenix]]");
  });

  it("does nothing when the write was not a gated page (no sidecar)", () => {
    runPostToolUse(
      {
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        cwd: root,
        tool_use_id: "tu_n",
        tool_input: { file_path: join(root, "README.md"), content: "" },
        tool_response: {},
      },
      root,
      DATE,
    );
    expect(existsSync(join(root, "wiki", "log.md"))).toBe(false);
  });
});