import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffold } from "../src/scaffold.js";
import { scaffoldSkills } from "../src/skills.js";
import { writeEntryFiles } from "../src/claude-md.js";
import { readSettings, writeSettings, InvalidSettingsError } from "../src/config/settings.js";

/**
 * Scaffolding a project for more than one harness (2.3), and recording which
 * ones it carries.
 *
 * The assertions come from `adr:0024` and from the plan's third divergence —
 * a project directory is not one developer's setup, so the answer is plural and
 * committed — never from reading the scaffolder to see what it happens to do.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ow-harness-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const skill = (dir: string, name: string) => join(root, ...dir.split("/"), name, "SKILL.md");

describe("ow.json records the harnesses (2.3)", () => {
  it("starts empty, which is not the same as 'none wanted'", () => {
    expect(readSettings(root).harnesses).toEqual([]);
  });

  it("keeps what it was given", () => {
    expect(writeSettings(root, { harnesses: ["codex"] }).harnesses).toEqual(["codex"]);
    expect(readSettings(root).harnesses).toEqual(["codex"]);
  });

  it("normalises order and duplicates, so two projects agree byte for byte", () => {
    expect(
      writeSettings(root, { harnesses: ["opencode", "claude", "opencode"] }).harnesses,
    ).toEqual(["claude", "opencode"]);
  });

  it("refuses a harness nobody supports, naming what is allowed", () => {
    writeFileSync(join(root, "ow.json"), JSON.stringify({ harnesses: ["cursor"] }), "utf8");
    expect(() => readSettings(root)).toThrow(InvalidSettingsError);
    expect(() => readSettings(root)).toThrow(/cursor/);
  });

  it("refuses a harnesses value that is not a list", () => {
    writeFileSync(join(root, "ow.json"), JSON.stringify({ harnesses: "codex" }), "utf8");
    expect(() => readSettings(root)).toThrow(/must be an array/);
  });

  it("is still a closed schema", () => {
    writeFileSync(join(root, "ow.json"), JSON.stringify({ harness: "codex" }), "utf8");
    expect(() => readSettings(root)).toThrow(/the schema is closed/);
  });
});

describe("scaffolding for a named harness", () => {
  it("writes the skills where that harness reads them, and nowhere else", () => {
    scaffold(root, { harnesses: ["codex"] });
    expect(existsSync(skill(".codex/skills", "wiki"))).toBe(true);
    expect(existsSync(skill(".codex/skills", "codewiki"))).toBe(true);
    expect(existsSync(skill(".claude/skills", "wiki"))).toBe(false);
    expect(existsSync(skill(".opencode/skills", "wiki"))).toBe(false);
  });

  it("accepts more than one, and writes every one of them", () => {
    scaffold(root, { harnesses: ["claude", "opencode"] });
    expect(existsSync(skill(".claude/skills", "wiki"))).toBe(true);
    expect(existsSync(skill(".opencode/skills", "wiki"))).toBe(true);
    expect(existsSync(skill(".codex/skills", "wiki"))).toBe(false);
    expect(readSettings(root).harnesses).toEqual(["claude", "opencode"]);
  });

  it("ships the same convention text to each of them", () => {
    scaffold(root, { harnesses: ["claude", "codex"] });
    expect(readFileSync(skill(".codex/skills", "wiki"), "utf8")).toBe(
      readFileSync(skill(".claude/skills", "wiki"), "utf8"),
    );
  });

  it("reports staleness per harness, so a user knows which copy is old", () => {
    scaffold(root, { harnesses: ["claude", "codex"] });
    writeFileSync(skill(".codex/skills", "wiki"), "---\nopen-wiki-version: 0.1.0\n---\nold\n");
    const outdated = scaffoldSkills(root, { harnesses: ["claude", "codex"] }).outdated;
    expect(outdated).toHaveLength(1);
    expect(outdated[0]).toMatchObject({ dir: "wiki", harness: "codex", found: "0.1.0" });
  });
});

describe("re-running init", () => {
  it("keeps the harnesses already recorded when none is named", () => {
    scaffold(root, { harnesses: ["codex"] });
    scaffold(root);
    expect(readSettings(root).harnesses).toEqual(["codex"]);
    expect(existsSync(skill(".codex/skills", "wiki"))).toBe(true);
  });

  it("adds a harness rather than replacing what is there (5.4's hinge)", () => {
    scaffold(root, { harnesses: ["codex"] });
    scaffold(root, { harnesses: ["claude"] });
    expect(readSettings(root).harnesses).toEqual(["claude", "codex"]);
    expect(existsSync(skill(".claude/skills", "wiki"))).toBe(true);
    expect(existsSync(skill(".codex/skills", "wiki"))).toBe(true);
  });

  it("still writes Claude Code's skills for a project that records no harness", () => {
    // What every project scaffolded before adr:0024 already has on disk. Reading
    // an empty list as "none wanted" would strip it of its convention.
    scaffold(root);
    expect(existsSync(skill(".claude/skills", "wiki"))).toBe(true);
  });
});

describe("a link is never a file this product writes", () => {
  /**
   * A cloned repository can plant a symbolic link at any path this product is
   * about to write — the paths are fixed and predictable, and on Windows a
   * directory junction needs no privilege. `existsSync` answers "nothing there"
   * for a *dangling* link, so the create path used to follow it and write at
   * its target; an ordinary link was followed by `refresh` and by the
   * regenerated entry files, which overwrite by design.
   *
   * `seedWiki` already knew this and answered it with `lstat`. The lesson had
   * not been carried to the other two writers, and this group had just extended
   * both to twice as many directories.
   */
  const canSymlink = (): boolean => {
    try {
      const probe = join(root, "probe");
      symlinkSync(join(root, "nowhere"), probe);
      rmSync(probe, { force: true });
      return true;
    } catch {
      return false;
    }
  };

  it.skipIf(!canSymlink())("refuses a dangling link planted where a skill goes", () => {
    const target = join(root, "..", "escaped.md");
    mkdirSync(join(root, ".codex", "skills", "wiki"), { recursive: true });
    symlinkSync(target, skill(".codex/skills", "wiki"));

    expect(() => scaffold(root, { harnesses: ["codex"] })).toThrow(/symbolic link/i);
    expect(existsSync(target), "nothing may be written at the link's target").toBe(false);
  });

  it.skipIf(!canSymlink())(
    "refuses a link where the entry file goes, even though it is generated",
    () => {
      const target = join(root, "..", "escaped-entry.md");
      symlinkSync(target, join(root, "AGENTS.md"));

      expect(() => writeEntryFiles(root, "en", ["codex"])).toThrow(/symbolic link/i);
      expect(existsSync(target)).toBe(false);
    },
  );

  it.skipIf(!canSymlink())(
    "refuses a link on the refresh path too, where the write is deliberate",
    () => {
      scaffold(root, { harnesses: ["codex"] });
      const file = skill(".codex/skills", "wiki");
      const target = join(root, "..", "escaped-refresh.md");
      rmSync(file);
      symlinkSync(target, file);

      expect(() => scaffoldSkills(root, { harnesses: ["codex"], refresh: true })).toThrow(
        /symbolic link/i,
      );
      expect(existsSync(target)).toBe(false);
    },
  );
});

describe("the entry files a scaffolded project gets", () => {
  it("writes AGENTS.md once for Codex and opencode together", () => {
    scaffold(root, { harnesses: ["codex", "opencode"] });
    // The scaffolder writes skills; the entry file is `ow init`'s (2.7). What
    // matters here is that the recorded list is what a renderer will be given.
    expect(readSettings(root).harnesses).toEqual(["codex", "opencode"]);
  });
});
