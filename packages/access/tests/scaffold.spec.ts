import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffold, DirectoryOccupiedError } from "../src/scaffold.js";
import { readSettings } from "../src/config/settings.js";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "ow-scaffold-"));
}

describe("scaffold (2.1)", () => {
  let root: string;
  beforeEach(() => (root = tempDir()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("creates raw/, wiki/ and .state/ and writes settings, ignore and skills", () => {
    const result = scaffold(root);
    expect(existsSync(join(root, "raw"))).toBe(true);
    expect(existsSync(join(root, "wiki"))).toBe(true);
    expect(existsSync(join(root, ".state"))).toBe(true);
    expect(existsSync(join(root, "ow.json"))).toBe(true);
    expect(existsSync(join(root, ".gitignore"))).toBe(true);
    expect(existsSync(join(root, ".claude", "skills", "wiki", "SKILL.md"))).toBe(true);
    expect(existsSync(join(root, ".claude", "skills", "codewiki", "SKILL.md"))).toBe(true);
    expect(result.skills.written).toContain("wiki");
    expect(result.skills.written).toContain("codewiki");
    expect(result.settings.language).toBe("en");
  });

  it("is idempotent — running again does not throw and skips existing skills", () => {
    scaffold(root);
    const second = scaffold(root);
    expect(second.skills.skipped).toContain("wiki");
    expect(second.skills.skipped).toContain("codewiki");
    expect(readSettings(root).language).toBe("en");
  });

  it("refuses a directory already occupied by something else", () => {
    writeFileSync(join(root, "unrelated.txt"), "x");
    expect(() => scaffold(root)).toThrow(DirectoryOccupiedError);
  });

  it("scaffolds into a brand-new directory that does not yet exist", () => {
    const fresh = join(root, "nested", "new-project");
    scaffold(fresh);
    expect(existsSync(join(fresh, "wiki"))).toBe(true);
    expect(existsSync(join(fresh, "ow.json"))).toBe(true);
  });

  it("the wiki skill carries the version marker for staleness reporting", () => {
    scaffold(root);
    const body = readFileSync(join(root, ".claude", "skills", "wiki", "SKILL.md"), "utf8");
    expect(body).toContain("open-wiki-version:");
  });
});
