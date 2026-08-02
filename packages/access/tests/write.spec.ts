import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { snapshot, atomicWrite, writePage } from "../src/write/atomic-write.js";
import { listOperations, getOperation } from "../src/write/log.js";
import { undo, UnknownOperationError } from "../src/write/undo.js";
import { OutsideProjectError } from "../src/paths.js";

function tempProject() {
  const root = mkdtempSync(join(tmpdir(), "ow-write-"));
  mkdirSync(join(root, "wiki"), { recursive: true });
  mkdirSync(join(root, ".state"), { recursive: true });
  return root;
}

describe("atomic write + snapshot (2.3)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("writes a new page atomically (the file appears with the content)", () => {
    atomicWrite(root, join("wiki", "page.md"), "# Page\n");
    expect(readFileSync(join(root, "wiki", "page.md"), "utf8")).toBe("# Page\n");
  });

  it("overwrites an existing page", () => {
    atomicWrite(root, join("wiki", "page.md"), "old");
    atomicWrite(root, join("wiki", "page.md"), "new");
    expect(readFileSync(join(root, "wiki", "page.md"), "utf8")).toBe("new");
  });

  it("snapshot is callable on its own and does not write the page", () => {
    writeFileSync(join(root, "wiki", "page.md"), "before");
    const snap = snapshot(root, [join("wiki", "page.md")]);
    expect(snap.pages).toHaveLength(1);
    expect(snap.pages[0]!.existed).toBe(true);
    // The snapshot copy holds the pre-write content.
    expect(readFileSync(join(snap.dir, "wiki", "page.md"), "utf8")).toBe("before");
    // And the live page is untouched.
    expect(readFileSync(join(root, "wiki", "page.md"), "utf8")).toBe("before");
  });

  it("snapshot records a not-yet-existing page as existed:false with no copy", () => {
    const snap = snapshot(root, [join("wiki", "new.md")]);
    expect(snap.pages[0]!.existed).toBe(false);
    expect(existsSync(join(snap.dir, "wiki", "new.md"))).toBe(false);
  });

  it("the snapshot reflects the page as it was before the write", () => {
    writeFileSync(join(root, "wiki", "page.md"), "before");
    const snap = snapshot(root, [join("wiki", "page.md")]);
    atomicWrite(root, join("wiki", "page.md"), "after");
    expect(readFileSync(join(root, "wiki", "page.md"), "utf8")).toBe("after");
    expect(readFileSync(join(snap.dir, "wiki", "page.md"), "utf8")).toBe("before");
  });

  it("writePage snapshots, writes, and records the operation in one call", () => {
    const op = writePage(root, join("wiki", "page.md"), "hello", "editor");
    expect(readFileSync(join(root, "wiki", "page.md"), "utf8")).toBe("hello");
    const ops = listOperations(root);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.id).toBe(op.id);
    expect(ops[0]!.origin).toBe("editor");
    expect(ops[0]!.pages[0]!.path).toBe(join("wiki", "page.md"));
    expect(ops[0]!.pages[0]!.existed).toBe(false);
  });
});

describe("operation log (2.4)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("records what was observed — created vs modified — with time and origin", () => {
    writePage(root, join("wiki", "a.md"), "a", "cli");
    writeFileSync(join(root, "wiki", "b.md"), "b0");
    writePage(root, join("wiki", "b.md"), "b1", "hook");
    const ops = listOperations(root);
    expect(ops).toHaveLength(2);
    expect(ops[0]!.pages[0]!.existed).toBe(false); // a created
    expect(ops[1]!.pages[0]!.existed).toBe(true); // b modified
    expect(ops[1]!.origin).toBe("hook");
    expect(typeof ops[0]!.time).toBe("string");
    expect(ops[0]!.time.length).toBeGreaterThan(0);
  });

  it("records an agent write with origin 'agent' — R4.5", () => {
    // The embedded agent's writes carry origin "agent" so a bad run is one undo
    // rather than an archaeology. The variant exists on the union; the log
    // round-trips it like any other origin.
    const op = writePage(root, join("wiki", "agent-page.md"), "agent wrote this", "agent");
    expect(op.origin).toBe("agent");
    expect(listOperations(root)[0]!.origin).toBe("agent");
  });

  it("getOperation retrieves an operation by id", () => {
    const op = writePage(root, join("wiki", "a.md"), "a", "editor");
    expect(getOperation(root, op.id)?.id).toBe(op.id);
    expect(getOperation(root, "nope")).toBeUndefined();
  });
});

describe("undo (2.5)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("undoes a create by removing the page", () => {
    const op = writePage(root, join("wiki", "page.md"), "new", "editor");
    expect(existsSync(join(root, "wiki", "page.md"))).toBe(true);
    undo(root, op.id);
    expect(existsSync(join(root, "wiki", "page.md"))).toBe(false);
  });

  it("undoes a modify by restoring the previous content", () => {
    writeFileSync(join(root, "wiki", "page.md"), "before");
    const op = writePage(root, join("wiki", "page.md"), "after", "editor");
    undo(root, op.id);
    expect(readFileSync(join(root, "wiki", "page.md"), "utf8")).toBe("before");
  });

  it("refuses an unknown operation id", () => {
    expect(() => undo(root, "nope")).toThrow(UnknownOperationError);
  });

  it("undo is by id — undoes only the named operation", () => {
    writeFileSync(join(root, "wiki", "a.md"), "a0");
    writeFileSync(join(root, "wiki", "b.md"), "b0");
    const opA = writePage(root, join("wiki", "a.md"), "a1", "editor");
    writePage(root, join("wiki", "b.md"), "b1", "editor");
    undo(root, opA.id);
    expect(readFileSync(join(root, "wiki", "a.md"), "utf8")).toBe("a0");
    expect(readFileSync(join(root, "wiki", "b.md"), "utf8")).toBe("b1");
  });
});

describe("the write path confines its own paths (2.6)", () => {
  let root: string;
  let outside: string;
  beforeEach(() => {
    root = tempProject();
    outside = mkdtempSync(join(tmpdir(), "ow-write-outside-"));
    writeFileSync(join(outside, "victim.md"), "not the project's\n", "utf8");
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  /** The project-relative path that reaches `outside/victim.md` by climbing out. */
  function escapingRel(): string {
    return join("..", relative(dirname(root), join(outside, "victim.md")));
  }

  it("snapshot refuses a page path that climbs out of the project", () => {
    expect(() => snapshot(root, [escapingRel()])).toThrow(OutsideProjectError);
    expect(readFileSync(join(outside, "victim.md"), "utf8")).toBe("not the project's\n");
  });

  it("undo refuses a logged path that climbs out — the log is input, not fact", () => {
    // The operation log lives on disk inside the project, so its paths are data
    // by the time undo reads them. Undo is the one operation that deletes, and
    // a tampered entry must not turn it into a delete of something the project
    // never owned.
    const op = writePage(root, join("wiki", "page.md"), "# Page\n", "cli");
    const log = join(root, ".state", "log.jsonl");
    const lines = readFileSync(log, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as { id: string; pages: unknown });
    const entry = lines.find((o) => o.id === op.id)!;
    entry.pages = [{ path: escapingRel(), existed: false }];
    writeFileSync(log, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");

    expect(() => undo(root, op.id)).toThrow(OutsideProjectError);
    expect(existsSync(join(outside, "victim.md"))).toBe(true);
  });
});
