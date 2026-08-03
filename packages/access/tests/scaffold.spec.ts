import { describe, expect, it, beforeEach, afterEach } from "vitest";
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
import { dirname, join } from "node:path";
import { scaffold, DirectoryOccupiedError } from "../src/scaffold.js";
import { readSettings } from "../src/config/settings.js";
import { checkProject } from "../src/check/checks.js";

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

  // R1.3 — adopting a project that already exists must not cost it anything.
  // The idempotency test above covers the skills and the settings; this covers
  // what the user actually wrote.
  it("leaves the pages a project already holds alone", () => {
    scaffold(root);
    writeFileSync(join(root, "wiki", "fenix.md"), "---\nid: fenix\n---\n\nmine\n", "utf8");
    writeFileSync(join(root, "wiki", "index.md"), "# my own index\n", "utf8");
    scaffold(root);
    expect(readFileSync(join(root, "wiki", "fenix.md"), "utf8")).toContain("mine");
    expect(readFileSync(join(root, "wiki", "index.md"), "utf8")).toBe("# my own index\n");
  });

  // `specs/opening-an-existing-project`, R1.1 — the case the refusal has always
  // told the user to use, and which nothing here read until now.
  it("accepts a git repository that is already being worked in", () => {
    mkdirSync(join(root, ".git"), { recursive: true });
    writeFileSync(join(root, "README.md"), "somebody's project\n", "utf8");
    mkdirSync(join(root, "src"), { recursive: true });
    scaffold(root);
    expect(existsSync(join(root, "wiki"))).toBe(true);
    expect(existsSync(join(root, "ow.json"))).toBe(true);
    // Its own files are untouched: a wiki is added to the repository, not
    // instead of it.
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("somebody's project\n");
  });

  it("accepts a worktree, where .git is a file rather than a directory", () => {
    writeFileSync(join(root, ".git"), "gitdir: ../.git/worktrees/feature\n", "utf8");
    writeFileSync(join(root, "unrelated.txt"), "x");
    expect(() => scaffold(root)).not.toThrow();
  });

  it("still refuses a populated directory that is not under version control", () => {
    // R1.2. The guard's whole point: scaffolding prints success, so a mistyped
    // path must not quietly become a project somewhere nobody looks again.
    mkdirSync(join(root, "holiday-photos"), { recursive: true });
    writeFileSync(join(root, "notes.txt"), "x");
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

/**
 * The wiki's own pages (plan 1.3). The skills tell the agent to link a new page
 * from `index.md` and record it in `changelog.md`; the checks read both. Before
 * this, neither file existed until something happened to write one.
 */
describe("scaffold seeds the wiki's own pages (1.3)", () => {
  let root: string;
  beforeEach(() => (root = tempDir()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("writes index.md and changelog.md, and says it did", () => {
    const result = scaffold(root);
    expect(existsSync(join(root, "wiki", "index.md"))).toBe(true);
    expect(existsSync(join(root, "wiki", "changelog.md"))).toBe(true);
    expect(result.wiki.written).toEqual(["wiki/index.md", "wiki/changelog.md"].map(toPlatform));
  });

  it("leaves log.md absent, because an empty log is noise", () => {
    scaffold(root);
    expect(existsSync(join(root, "wiki", "log.md"))).toBe(false);
  });

  it("gives the index the section a page is registered into", () => {
    scaffold(root);
    expect(readFileSync(join(root, "wiki", "index.md"), "utf8")).toContain("## Pages");
  });

  it("never writes over a wiki somebody has been keeping", () => {
    // `ow init` is idempotent and the launcher goes through the same door, so
    // a second scaffold must not replace a curated index with the seed.
    scaffold(root);
    writeFileSync(join(root, "wiki", "index.md"), "# Index\n\n- [[fenix]]\n", "utf8");
    const second = scaffold(root);
    expect(readFileSync(join(root, "wiki", "index.md"), "utf8")).toContain("[[fenix]]");
    expect(second.wiki.written).toEqual([]);
  });

  it("writes nothing when something else already bears the name", () => {
    // The platform-independent half of the guard, and the half that runs
    // everywhere: `lstat` answers about the name rather than about what the
    // name points at, so anything there at all means this does not write. A
    // directory is that case, plantable without the privilege a symlink needs.
    scaffold(root);
    rmSync(join(root, "wiki", "index.md"));
    mkdirSync(join(root, "wiki", "index.md"));
    expect(scaffold(root).wiki.written).toEqual([]);
  });

  it("refuses to follow a dangling symlink planted at one of the seed paths", (ctx) => {
    // The case `existsSync` answers "no" to and a plain write then follows out
    // of the project: it follows the link to a target that is not there, so the
    // guard sees nothing and the write creates that target — outside
    // `projectRoot`, which is the containment `adr:0013` states.
    scaffold(root);
    rmSync(join(root, "wiki", "index.md"));
    const outside = join(dirname(root), "planted.md");
    try {
      symlinkSync(outside, join(root, "wiki", "index.md"));
    } catch (err) {
      // Privileged on most Windows accounts, and that is a different failure
      // from this one. Reported as a skip, never as a pass.
      ctx.skip(`symlink creation unavailable: ${err instanceof Error ? err.message : err}`);
      return;
    }
    try {
      expect(scaffold(root).wiki.written).toEqual([]);
      expect(existsSync(outside)).toBe(false);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("leaves a brand-new project with nothing for `ow check` to report", () => {
    // The seeds are prose, and prose in the changelog is read for wikilinks:
    // an example link written into either file would report itself as a page
    // that does not exist, on the first check a project ever runs.
    scaffold(root);
    expect(checkProject(root).findings).toEqual([]);
  });
});

/** The result reports paths the way `join` builds them on this platform. */
function toPlatform(path: string): string {
  return join(...path.split("/"));
}
