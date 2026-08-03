import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectRegistry, readSettings } from "@open-wiki/access";
import { runInit, staleSkillsNotice } from "../src/commands/init.js";

/**
 * `ow init` (plan 9.3, 9.4, 9.5): the scaffolder of 2.1 makes the project, and
 * this command adds the two things it does not — the hooks that put writes
 * through the gate, and the generated `CLAUDE.md`.
 *
 * `runInit` registers through `new ProjectRegistry()`, which resolves the
 * application data directory from the environment, so these tests point that
 * environment at a temp directory rather than the real one. `APPDATA` is what
 * Windows uses and `HOME` is the fallback; both are set, because CI runs on
 * Windows and this suite must not depend on which one is read.
 */

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("ow init (9.3–9.5)", () => {
  let root: string;
  let appData: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    root = tempDir("ow-init-");
    appData = tempDir("ow-init-appdata-");
    savedEnv = { APPDATA: process.env["APPDATA"], HOME: process.env["HOME"] };
    process.env["APPDATA"] = appData;
    process.env["HOME"] = appData;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(appData, { recursive: true, force: true });
  });

  it("scaffolds the project and installs the gate", () => {
    const result = runInit({ projectRoot: root });

    expect(result.projectRoot).toBe(root);
    expect(result.skills.written.length).toBeGreaterThan(0);
    for (const dir of ["raw", "wiki", ".state"]) {
      expect(existsSync(join(root, dir)), dir).toBe(true);
    }
    expect(existsSync(result.hooks)).toBe(true);
    expect(result.entryFiles).toHaveLength(1);
    expect(existsSync(result.entryFiles[0]!)).toBe(true);
    // No `--name`, so nothing was registered.
    expect(result.registeredName).toBeUndefined();
  });

  it("is idempotent — a second init refreshes rather than refusing", () => {
    runInit({ projectRoot: root });
    const again = runInit({ projectRoot: root });
    expect(again.skills.skipped.length).toBeGreaterThan(0);
    expect(again.skills.written).toEqual([]);
  });

  describe("skills that have aged in the project (5.3)", () => {
    const OLD = "---\nname: wiki\nopen-wiki-version: 0.1.0\n---\nthe old convention\n";
    const wikiSkill = (): string => join(root, ".claude", "skills", "wiki", "SKILL.md");

    it("reports an aged skill and leaves it alone", () => {
      runInit({ projectRoot: root });
      writeFileSync(wikiSkill(), OLD, "utf8");

      const again = runInit({ projectRoot: root });
      expect(again.skills.outdated.map((s) => s.dir)).toEqual(["wiki"]);
      expect(readFileSync(wikiSkill(), "utf8")).toBe(OLD);
    });

    it("says what to do about it, and that doing it overwrites the file", () => {
      const notice = staleSkillsNotice([
        { dir: "wiki", harness: "claude" as const, found: "0.1.0", expected: "0.3.0" },
      ]);
      expect(notice).toContain("wiki: 0.1.0");
      expect(notice).toContain("--refresh-skills");
      expect(notice).toMatch(/overwrites the files/i);
    });

    it("says nothing at all when nothing has aged", () => {
      expect(staleSkillsNotice([])).toBe("");
    });

    it("renders an unreadable skill as such rather than as a missing marker", () => {
      const notice = staleSkillsNotice([
        {
          dir: "wiki",
          harness: "claude" as const,
          found: "unreadable" as const,
          expected: "0.3.0",
        },
        { dir: "codewiki", harness: "claude" as const, found: null, expected: "0.3.0" },
      ]);
      expect(notice).toContain("wiki: could not be read");
      expect(notice).toContain("codewiki: no version marker");
    });

    it("rewrites it with --refresh-skills, and then says nothing is out of date", () => {
      // The bug this pins: the run that fixed the file also reported it as
      // stale, telling the caller to re-run the flag it had just been given.
      runInit({ projectRoot: root });
      writeFileSync(wikiSkill(), OLD, "utf8");

      const refreshed = runInit({ projectRoot: root, refreshSkills: true });
      expect(refreshed.skills.written).toContain("wiki");
      expect(refreshed.skills.outdated).toEqual([]);
      expect(staleSkillsNotice(refreshed.skills.outdated)).toBe("");
      expect(readFileSync(wikiSkill(), "utf8")).toContain("ow source list --unprocessed");
    });
  });

  it("records the chosen language in the settings and the generated CLAUDE.md", () => {
    const result = runInit({ projectRoot: root, language: "pt-BR" });
    expect(readSettings(root).language).toBe("pt-BR");
    expect(readFileSync(result.entryFiles[0]!, "utf8")).toContain("Brazilian Portuguese");
  });

  it("keeps the language a later init does not mention", () => {
    runInit({ projectRoot: root, language: "es" });
    const result = runInit({ projectRoot: root });
    expect(readSettings(root).language).toBe("es");
    expect(readFileSync(result.entryFiles[0]!, "utf8")).toContain("Spanish");
  });

  it("refuses a language the project has no content convention for", () => {
    expect(() => runInit({ projectRoot: root, language: "fr" })).toThrow(
      /--language must be one of/,
    );
  });

  it("registers the project under --name, so .mcp.json can name it", () => {
    const result = runInit({ projectRoot: root, name: "fenix" });
    expect(result.registeredName).toBe("fenix");
    expect(new ProjectRegistry(join(appData, "open-wiki")).resolve("fenix")).toBe(root);
  });

  it("refuses a --name that is a path rather than a name", () => {
    expect(() => runInit({ projectRoot: root, name: "C:\\dev\\fenix" })).toThrow(
      /is not a valid project name/,
    );
  });

  it("refuses a directory already occupied by something else, and says what to do", () => {
    const occupied = tempDir("ow-init-occupied-");
    writeFileSync(join(occupied, "somebody-elses-file.txt"), "not a wiki\n", "utf8");
    try {
      expect(() => runInit({ projectRoot: occupied })).toThrow(/already occupied/);
      expect(() => runInit({ projectRoot: occupied })).toThrow(/empty directory, a git repo/);
    } finally {
      rmSync(occupied, { recursive: true, force: true });
    }
  });
});
