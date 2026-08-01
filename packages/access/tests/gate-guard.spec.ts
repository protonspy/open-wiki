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

  it("does not flag a wiki page or a source", () => {
    expect(isConfigWrite(join(root, "wiki", "fenix.md"), root)).toBe(false);
    expect(isConfigWrite(join(root, "raw", "arquitetura-fenix.pdf", "text.md"), root)).toBe(false);
    expect(isConfigWrite(join(root, "codewiki", "dispatch.md"), root)).toBe(false);
  });

  it("does not flag an unrelated file that merely contains the substring", () => {
    expect(isConfigWrite(join(root, "docs", "CLAUDE.md-guide.md"), root)).toBe(false);
    expect(isConfigWrite(join(root, "wiki", ".mcp.json-notes.md"), root)).toBe(false);
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