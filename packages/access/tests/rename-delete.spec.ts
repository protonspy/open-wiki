import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deletePage, renamePage } from "../src/write/rename-delete.js";
import { listOperations } from "../src/write/log.js";
import { undo } from "../src/write/undo.js";
import { readIndex } from "../src/store/index.js";
import { readFrontmatter } from "../src/store/page.js";

/**
 * One switch that makes `undo` throw, so the rollback's own failure path is
 * reachable. Wrapped rather than replaced: every other test here runs the real
 * `undo`, and a stub would make the rollback assertions above vacuous.
 */
const undoFails = vi.hoisted(() => ({ now: false }));
vi.mock("../src/write/undo.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/write/undo.js")>();
  return {
    ...actual,
    undo: (projectRoot: string, id: string): void => {
      if (undoFails.now) throw new Error("the snapshot is gone");
      actual.undo(projectRoot, id);
    },
  };
});

/** A valid entity page, the way the store writes one. */
const FENIX = `---
id: topic:fenix
type: topic
title: Fenix
status: active
aliases: []
updated: 2026-08-02
sources: []
superseded-by: ""
---
Fenix is a topic page.
`;

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "ow-rename-delete-"));
  mkdirSync(join(root, "wiki"), { recursive: true });
  mkdirSync(join(root, ".state"), { recursive: true });
  return root;
}

function writePage(root: string, path: string, content: string): void {
  writeFileSync(join(root, path), content, "utf8");
}

/** Frontmatter as a plain object, for asserting fields the store re-serialised. */
function fmOf(root: string, path: string): Record<string, unknown> {
  const block = readFrontmatter(readFileSync(join(root, path), "utf8"));
  if (!block || !block.parsed) throw new Error(`no readable frontmatter on ${path}`);
  return block.frontmatter as Record<string, unknown>;
}

const FIXED_DATE = "2026-08-02";

describe("deletePage (1.8) — gated removal", () => {
  let root: string;
  beforeEach(() => {
    root = tempProject();
    vi.useFakeTimers({ now: new Date(`${FIXED_DATE}T10:00:00Z`) });
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  });

  it("removes the page and records one undoable operation with the given origin — R4.2, R4.5", () => {
    writePage(root, "wiki/fenix.md", FENIX);
    const result = deletePage(root, "wiki/fenix.md", "agent");
    expect(result).toEqual({ ok: true, operationId: expect.any(String) });
    expect(existsSync(join(root, "wiki/fenix.md"))).toBe(false);
    const ops = listOperations(root);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.origin).toBe("agent");
    expect(ops[0]!.pages).toEqual([{ path: "wiki/fenix.md", existed: true }]);
  });

  it("undo restores the deleted page from the snapshot", () => {
    writePage(root, "wiki/fenix.md", FENIX);
    const result = deletePage(root, "wiki/fenix.md", "agent");
    if (!result.ok) throw new Error("expected ok");
    undo(root, result.operationId);
    expect(readFileSync(join(root, "wiki/fenix.md"), "utf8")).toBe(FENIX);
  });

  it("refuses the wiki record pages (index/changelog/log) — R4.6", () => {
    for (const name of ["index.md", "changelog.md", "log.md"]) {
      writePage(root, `wiki/${name}`, `# ${name}\n`);
      const result = deletePage(root, `wiki/${name}`, "agent");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("wiki record page");
      expect(existsSync(join(root, "wiki", name))).toBe(true);
    }
  });

  it("refuses a path outside the project", () => {
    const result = deletePage(root, "../escape.md", "agent");
    expect(result.ok).toBe(false);
  });

  it("refuses a non-wiki path", () => {
    writePage(root, "CLAUDE.md", "# rules\n");
    const result = deletePage(root, "CLAUDE.md", "agent");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not a wiki entity page");
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(true);
  });

  it("refuses a page that does not exist", () => {
    const result = deletePage(root, "wiki/ghost.md", "agent");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("no such page");
  });
});

describe("renamePage (1.8) — supersession rename", () => {
  let root: string;
  beforeEach(() => {
    root = tempProject();
    vi.useFakeTimers({ now: new Date(`${FIXED_DATE}T10:00:00Z`) });
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  });

  it("writes the new page and marks the old superseded by it, in one operation — R4.2, R4.5", () => {
    writePage(root, "wiki/fenix.md", FENIX);
    const result = renamePage(root, "wiki/fenix.md", "wiki/fenix-2.md", "agent");
    expect(result).toEqual({ ok: true, operationId: expect.any(String) });

    // The new page is active, its id follows the new slug.
    expect(existsSync(join(root, "wiki/fenix-2.md"))).toBe(true);
    const newFm = fmOf(root, "wiki/fenix-2.md");
    expect(newFm["id"]).toBe("topic:fenix-2");
    expect(newFm["status"]).toBe("active");

    // The old page is superseded, named the new page as its replacement.
    expect(existsSync(join(root, "wiki/fenix.md"))).toBe(true);
    const oldFm = fmOf(root, "wiki/fenix.md");
    expect(oldFm["status"]).toBe("superseded");
    expect(oldFm["superseded-by"]).toBe("topic:fenix-2");

    // One operation, carrying the agent origin, covering both pages.
    const ops = listOperations(root);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.origin).toBe("agent");
    const paths = ops[0]!.pages.map((p) => p.path).sort();
    expect(paths).toEqual(["wiki/fenix-2.md", "wiki/fenix.md"]);
  });

  it("makes the new page reachable from the index", () => {
    writePage(root, "wiki/fenix.md", FENIX);
    renamePage(root, "wiki/fenix.md", "wiki/fenix-2.md", "agent");
    expect(readIndex(root)).toContain("[[fenix-2]]");
  });

  it("refuses to clobber an existing target — R4.6", () => {
    writePage(root, "wiki/fenix.md", FENIX);
    writePage(root, "wiki/fenix-2.md", FENIX.replace(/fenix/g, "fenix-2"));
    const before = readFileSync(join(root, "wiki/fenix-2.md"), "utf8");
    const result = renamePage(root, "wiki/fenix.md", "wiki/fenix-2.md", "agent");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons.join("; ")).toContain("already exists");
    // Nothing changed: the clobber target is untouched.
    expect(readFileSync(join(root, "wiki/fenix-2.md"), "utf8")).toBe(before);
  });

  it("refuses the wiki record pages as source or target — R4.6", () => {
    writePage(root, "wiki/index.md", "# Index\n");
    writePage(root, "wiki/fenix.md", FENIX);
    // Targeting a record page.
    const toRecord = renamePage(root, "wiki/fenix.md", "wiki/index.md", "agent");
    expect(toRecord.ok).toBe(false);
    // Renaming a record page as the source.
    const fromRecord = renamePage(root, "wiki/index.md", "wiki/index-2.md", "agent");
    expect(fromRecord.ok).toBe(false);
  });

  it("refuses a path outside the project", () => {
    writePage(root, "wiki/fenix.md", FENIX);
    const result = renamePage(root, "wiki/fenix.md", "../escape.md", "agent");
    expect(result.ok).toBe(false);
  });

  it("refuses a non-existent source page", () => {
    const result = renamePage(root, "wiki/ghost.md", "wiki/ghost-2.md", "agent");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons.join("; ")).toContain("no such page");
  });

  it("undo restores the old page to its active content and removes the new", () => {
    writePage(root, "wiki/fenix.md", FENIX);
    const result = renamePage(root, "wiki/fenix.md", "wiki/fenix-2.md", "agent");
    if (!result.ok) throw new Error("expected ok");
    undo(root, result.operationId);
    expect(readFileSync(join(root, "wiki/fenix.md"), "utf8")).toBe(FENIX);
    expect(existsSync(join(root, "wiki/fenix-2.md"))).toBe(false);
  });

  it("rolls both pages back when a step after the first write fails", () => {
    // A rename is two writes, so it has two chances to fail — and half-applied
    // is worse than refused: the new page would exist while the old one still
    // read `active`, one entity live twice with nothing saying which is current.
    // An unwritable `index.md` (here a directory; in the wild a lock, a full
    // disk, an antivirus scan) fails the step after both pages are written,
    // which is exactly the window the rollback exists for.
    writePage(root, "wiki/fenix.md", FENIX);
    // The two record pages already hold something, so a rollback that leaves
    // them appended-to is visible as a difference rather than as a created file.
    writePage(
      root,
      "wiki/log.md",
      "# Log\n\nEvery write to the wiki, with who made it. Newest last.\n\n",
    );
    writePage(
      root,
      "wiki/changelog.md",
      "# Changelog\n\nWhat changed in the wiki, newest first.\n\n",
    );
    const logBefore = readFileSync(join(root, "wiki/log.md"), "utf8");
    const changelogBefore = readFileSync(join(root, "wiki/changelog.md"), "utf8");
    mkdirSync(join(root, "wiki/index.md"), { recursive: true });

    const result = renamePage(root, "wiki/fenix.md", "wiki/fenix-2.md", "agent");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons.join("; ")).toContain("rolled back");

    // Both pages are back as they were: the old page active and byte-identical,
    // the new page gone.
    expect(readFileSync(join(root, "wiki/fenix.md"), "utf8")).toBe(FENIX);
    expect(existsSync(join(root, "wiki/fenix-2.md"))).toBe(false);

    // And so are the wiki's own records. A rename writes five files, not two:
    // the operation snapshot covers the pages, and `log.md` / `changelog.md` had
    // already been appended to by the time `index.md` failed. Left behind, they
    // announce a rename that never happened — the changelog is what a reader
    // trusts to say what the wiki did.
    expect(readFileSync(join(root, "wiki/log.md"), "utf8")).toBe(logBefore);
    expect(readFileSync(join(root, "wiki/changelog.md"), "utf8")).toBe(changelogBefore);
  });

  it("rolls the record pages back even when they did not exist before", () => {
    // The first rename in a fresh project creates `log.md` and `changelog.md`.
    // Restoring means removing them, not writing an empty one.
    writePage(root, "wiki/fenix.md", FENIX);
    mkdirSync(join(root, "wiki/index.md"), { recursive: true });
    expect(existsSync(join(root, "wiki/log.md"))).toBe(false);

    const result = renamePage(root, "wiki/fenix.md", "wiki/fenix-2.md", "agent");
    expect(result.ok).toBe(false);
    expect(existsSync(join(root, "wiki/log.md"))).toBe(false);
    expect(existsSync(join(root, "wiki/changelog.md"))).toBe(false);
    // The directory standing in for `index.md` is left exactly as it was found —
    // the rollback removes a file the rename created, never a tree it did not.
    expect(existsSync(join(root, "wiki/index.md"))).toBe(true);
  });

  it("reports a rollback that itself failed instead of claiming it succeeded", () => {
    // "rolled back" is a promise about the state of the pages. If `undo` throws,
    // that promise is false, and a caller told only "rolled back" would believe
    // the wiki is intact — so the failure and the operation id both reach them.
    writePage(root, "wiki/fenix.md", FENIX);
    mkdirSync(join(root, "wiki/index.md"), { recursive: true });
    undoFails.now = true;
    try {
      const result = renamePage(root, "wiki/fenix.md", "wiki/fenix-2.md", "agent");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const said = result.reasons.join("; ");
        expect(said).toContain("rolled back");
        expect(said).toContain("the rollback of the two pages failed");
        expect(said).toContain("the snapshot is gone");
      }
    } finally {
      undoFails.now = false;
    }
  });
});
