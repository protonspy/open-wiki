import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isConfigWrite } from "../src/gate/guard.js";

describe("isConfigWrite (9.6)", () => {
  let root: string;
  beforeEach(() => (root = mkdtempSync(join(tmpdir(), "ow-guard-"))));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("flags a write under .claude/", () => {
    expect(isConfigWrite(join(root, ".claude", "settings.json"), root)).toBe(true);
    expect(isConfigWrite(join(root, ".claude", "skills", "wiki", "SKILL.md"), root)).toBe(true);
    expect(isConfigWrite(join(root, ".claude", "hooks", "hooks.json"), root)).toBe(true);
  });

  it("flags the root .mcp.json and CLAUDE.md", () => {
    expect(isConfigWrite(join(root, ".mcp.json"), root)).toBe(true);
    expect(isConfigWrite(join(root, "CLAUDE.md"), root)).toBe(true);
  });

  /**
   * The refusal is cross-harness or it is not a refusal.
   *
   * A project scaffolded for Claude Code *and* Codex has Claude's `PreToolUse`
   * hook installed and Codex's not. If the guard knew only `.claude/`, an agent
   * running under that hook could rewrite `AGENTS.md` or
   * `.codex/skills/wiki/SKILL.md` — files a *sibling* harness loads next session
   * as trusted instructions — and the gate would answer "allow". A security
   * review found exactly that once these paths became things this product
   * scaffolds. The convention text is instructions to an agent, so editing it
   * is editing what the next agent believes.
   */
  it("flags every harness's convention, not only the one whose gate is running", () => {
    for (const path of [
      "AGENTS.md",
      join(".codex", "skills", "wiki", "SKILL.md"),
      join(".codex", "hooks.json"),
      join(".codex", "config.toml"),
      join(".opencode", "skills", "codewiki", "SKILL.md"),
      join(".opencode", "plugin", "open-wiki.ts"),
      "opencode.json",
    ]) {
      expect(isConfigWrite(join(root, path), root), path).toBe(true);
    }
  });

  it("flags them whatever this project records, because ow.json is committed too", () => {
    // A project that quietly dropped `codex` from its harnesses would otherwise
    // unlock `.codex/` for the write path — and `ow.json` arrives with a clone
    // like every other file here.
    expect(isConfigWrite(join(root, ".codex", "skills", "wiki", "SKILL.md"), root)).toBe(true);
  });

  it("still does not flag a page that merely sits near one of those names", () => {
    expect(isConfigWrite(join(root, "wiki", "AGENTS.md"), root)).toBe(false);
    expect(isConfigWrite(join(root, "docs", "opencode.json-notes.md"), root)).toBe(false);
  });

  it("does not flag a wiki page or a source", () => {
    expect(isConfigWrite(join(root, "wiki", "fenix.md"), root)).toBe(false);
    expect(isConfigWrite(join(root, "raw", "arquitetura-fenix.pdf", "text.md"), root)).toBe(false);
    expect(isConfigWrite(join(root, "codewiki", "dispatch.md"), root)).toBe(false);
  });

  it("does not flag an unrelated file that merely contains the substring", () => {
    expect(isConfigWrite(join(root, "docs", "CLAUDE.md-guide.md"), root)).toBe(false);
    expect(isConfigWrite(join(root, "wiki", ".mcp.json-notes.md"), root)).toBe(false);
  });

  it("flags the protected names whatever case they are written in", () => {
    // Windows is case-insensitive by default and is the only platform the
    // product supports, so each of these addresses the very file the guard
    // exists to protect. Matching the literal casing would leave the guard to
    // be stepped around with the shift key.
    expect(isConfigWrite(join(root, "claude.md"), root)).toBe(true);
    expect(isConfigWrite(join(root, "Claude.MD"), root)).toBe(true);
    expect(isConfigWrite(join(root, ".MCP.JSON"), root)).toBe(true);
    expect(isConfigWrite(join(root, ".CLAUDE", "settings.json"), root)).toBe(true);
    expect(isConfigWrite(join(root, ".ClAuDe", "hooks", "hooks.json"), root)).toBe(true);
  });

  it("still does not flag a lookalike once case is folded", () => {
    expect(isConfigWrite(join(root, "docs", "claude.md"), root)).toBe(false);
    expect(isConfigWrite(join(root, "wiki", "CLAUDE.md"), root)).toBe(false);
    expect(isConfigWrite(join(root, ".claudex", "settings.json"), root)).toBe(false);
  });

  it("does not treat a path outside the project as a config write", () => {
    expect(isConfigWrite(join(root, "..", ".claude", "settings.json"), root)).toBe(false);
  });

  it("resolves relative paths against the project root", () => {
    expect(isConfigWrite(".claude/settings.json", root)).toBe(true);
    expect(isConfigWrite("CLAUDE.md", root)).toBe(true);
    expect(isConfigWrite("wiki/fenix.md", root)).toBe(false);
  });
});
