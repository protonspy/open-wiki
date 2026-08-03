import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HARNESSES, PROFILES, readSettings } from "@open-wiki/access";
import { canLeave, nextStep, STEPS } from "../src/renderer/first-run.js";
import { HARNESS_CHOICES, toggleHarness } from "../src/renderer/harnesses.js";
import { createProject, setLanguage } from "../src/main/settings.js";

/**
 * The desktop's harness choice (2.6) and the entry file it regenerates (2.7).
 *
 * **A form, not a picker.** The desktop has no terminal, so the CLI's answer
 * does not port — and 8.12 already paid for ignoring that once, when a chain of
 * `prompt()` calls answered nothing at all in a packaged build. What is asserted
 * here is that the same scaffolder runs underneath, because a project is the
 * same project whichever door it came through.
 */

let root: string;
let appData: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ow-hform-"));
  appData = mkdtempSync(join(tmpdir(), "ow-hform-data-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(appData, { recursive: true, force: true });
});

describe("the harness step (2.6)", () => {
  it("comes before the language, because it decides which files carry it", () => {
    const ids = STEPS.map((s) => s.id);
    expect(ids.indexOf("harness")).toBeLessThan(ids.indexOf("language"));
    expect(nextStep("project")).toBe("harness");
  });

  it("cannot be left with nothing chosen", () => {
    const project = { name: "fenix", directory: "C:\\x" };
    expect(canLeave("harness", { ...project, harnesses: [] })).toBe(false);
    expect(canLeave("harness", { ...project, harnesses: ["codex"] })).toBe(true);
  });

  it("says the convention is committed, since that is why the answer matters", () => {
    const step = STEPS.find((s) => s.id === "harness");
    expect(step?.detail).toMatch(/commit|clone/i);
  });
});

describe("the renderer's mirrored list stays true to the profiles", () => {
  /**
   * The renderer may only *type*-import `@open-wiki/access` — a value import
   * pulls `node:fs` into the browser bundle — so `harnesses.ts` writes the list
   * out instead of reading it, exactly as `languages.ts` does. A mirror nobody
   * checks is two answers to one question, and this is the check. A test can
   * import both sides because it runs in Node.
   */
  it("offers every harness, in the same order, with the same labels", () => {
    expect(HARNESS_CHOICES.map((c) => c.value)).toEqual([...HARNESSES]);
    for (const choice of HARNESS_CHOICES) {
      expect(choice.label).toBe(PROFILES[choice.value].label);
    }
  });

  it("shows what each choice actually writes into the directory", () => {
    for (const choice of HARNESS_CHOICES) {
      const profile = PROFILES[choice.value];
      expect(choice.detail).toContain(profile.entryFile);
      expect(choice.detail).toContain(profile.skillsDir);
    }
  });

  it("toggles one on and off, keeping the list's own order", () => {
    expect(toggleHarness([], "opencode")).toEqual(["opencode"]);
    expect(toggleHarness(["opencode"], "claude")).toEqual(["claude", "opencode"]);
    expect(toggleHarness(["claude", "opencode"], "claude")).toEqual(["opencode"]);
    expect(toggleHarness(["opencode"], "opencode")).toEqual([]);
  });
});

describe("createProject through the form", () => {
  const dir = () => join(root, "fenix");

  it("scaffolds every harness the form was given", () => {
    createProject("fenix", dir(), "en", appData, ["codex", "opencode"]);
    expect(existsSync(join(dir(), ".codex", "skills", "wiki", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir(), ".opencode", "skills", "wiki", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir(), ".claude", "skills", "wiki", "SKILL.md"))).toBe(false);
    expect(readSettings(dir()).harnesses).toEqual(["codex", "opencode"]);
  });

  it("writes the entry file each of them reads", () => {
    createProject("fenix", dir(), "en", appData, ["codex", "opencode"]);
    expect(existsSync(join(dir(), "AGENTS.md"))).toBe(true);
    expect(existsSync(join(dir(), "CLAUDE.md"))).toBe(false);
  });

  it("still means Claude Code for a caller that names nothing", () => {
    // Every caller before 2.6 meant exactly this, and the signature is reached
    // by more than the form.
    createProject("fenix", dir(), "en", appData);
    expect(existsSync(join(dir(), "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(dir(), ".claude", "skills", "wiki", "SKILL.md"))).toBe(true);
  });
});

describe("changing the language regenerates the right file (2.7)", () => {
  const dir = () => join(root, "fenix");

  it("rewrites AGENTS.md for a project that has one", () => {
    createProject("fenix", dir(), "en", appData, ["codex"]);
    expect(readFileSync(join(dir(), "AGENTS.md"), "utf8")).toContain("English");

    setLanguage(dir(), "pt-BR");
    expect(readFileSync(join(dir(), "AGENTS.md"), "utf8")).toContain("Brazilian Portuguese");
    // And does not invent a CLAUDE.md the project never had — that file would
    // be read by opencode and by nothing else here, saying the wrong thing.
    expect(existsSync(join(dir(), "CLAUDE.md"))).toBe(false);
  });

  it("rewrites every entry file a multi-harness project carries", () => {
    createProject("fenix", dir(), "en", appData, ["claude", "codex"]);
    setLanguage(dir(), "es");
    expect(readFileSync(join(dir(), "AGENTS.md"), "utf8")).toContain("Spanish");
    // CLAUDE.md is the pointer here, so it carries the import rather than the
    // language — one text, not two copies that could disagree about it.
    expect(readFileSync(join(dir(), "CLAUDE.md"), "utf8")).toContain("@AGENTS.md");
  });

  it("rewrites CLAUDE.md for a project scaffolded before harnesses were recorded", () => {
    createProject("fenix", dir(), "en", appData);
    setLanguage(dir(), "pt-BR");
    expect(readFileSync(join(dir(), "CLAUDE.md"), "utf8")).toContain("Brazilian Portuguese");
  });
});
