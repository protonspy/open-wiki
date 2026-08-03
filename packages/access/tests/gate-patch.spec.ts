import { describe, expect, it } from "vitest";
import { looksLikePatch, patchPaths, patchTargets } from "../src/gate/patch.js";

/**
 * Reading a Codex `apply_patch` for the paths it touches (3.1).
 *
 * The assertions come from Codex's patch envelope as its own source describes
 * it, and from what the gate needs to be true — never from what the parser
 * happens to do with a given string.
 */

const patch = (body: string) => `*** Begin Patch\n${body}\n*** End Patch\n`;

describe("looksLikePatch", () => {
  it("tells a patch from a shell command, since both arrive as { command }", () => {
    expect(looksLikePatch(patch("*** Add File: a.md\n+x"))).toBe(true);
    expect(looksLikePatch("echo hello > wiki/fenix.md")).toBe(false);
    expect(looksLikePatch("")).toBe(false);
  });

  it("is not fooled by the words appearing in a command", () => {
    expect(looksLikePatch("echo '*** Begin Patch is a phrase' > notes.txt")).toBe(false);
  });
});

describe("patchTargets", () => {
  it("reads an added file", () => {
    expect(patchTargets(patch("*** Add File: wiki/fenix.md\n+# Fenix"))).toEqual([
      { path: "wiki/fenix.md", op: "add" },
    ]);
  });

  it("reads an updated and a deleted file", () => {
    const body = "*** Update File: wiki/a.md\n@@\n-old\n+new\n*** Delete File: wiki/b.md";
    expect(patchTargets(patch(body))).toEqual([
      { path: "wiki/a.md", op: "update" },
      { path: "wiki/b.md", op: "delete" },
    ]);
  });

  it("reads both ends of a move, because a move reaches two paths", () => {
    // A gate that read only the first would let a page be moved *into* `wiki/`
    // without validation, or a guarded file be replaced by moving another over
    // it. Both ends are targets.
    const body = "*** Update File: notes/draft.md\n*** Move to: wiki/fenix.md\n@@\n+x";
    const targets = patchTargets(patch(body));
    expect(targets[0]).toEqual({
      path: "notes/draft.md",
      op: "update",
      movedTo: "wiki/fenix.md",
    });
    expect(targets).toContainEqual({ path: "wiki/fenix.md", op: "add" });
  });

  it("reads several files in one patch", () => {
    const body = "*** Add File: wiki/a.md\n+x\n*** Add File: wiki/b.md\n+y";
    expect(patchPaths(patch(body))).toEqual(["wiki/a.md", "wiki/b.md"]);
  });

  it("normalises separators and a leading ./, so one file is one path", () => {
    expect(patchPaths(patch("*** Add File: .\\wiki\\fenix.md\n+x"))).toEqual(["wiki/fenix.md"]);
    expect(patchPaths(patch("*** Add File: ./wiki/fenix.md\n+x"))).toEqual(["wiki/fenix.md"]);
  });

  it("keeps a path with spaces in it whole", () => {
    expect(patchPaths(patch("*** Add File: wiki/my page.md\n+x"))).toEqual(["wiki/my page.md"]);
  });

  it("finds nothing in a patch it cannot read, which callers must not read as 'touches nothing'", () => {
    // Stated as a test because the distinction is the whole safety property:
    // an unparsable patch is *unknown*, and `hooks.ts` refuses on unknown.
    expect(patchTargets("*** Begin Patch\ngarbage\n*** End Patch")).toEqual([]);
    expect(patchTargets("")).toEqual([]);
  });

  it("is not stopped by a line it does not recognise", () => {
    // A guard that only recognises well-formed input is stepped around with
    // malformed input.
    const body = "@@ stray\n*** Add File: wiki/a.md\n+x\nnonsense\n*** Delete File: wiki/b.md";
    expect(patchPaths(patch(body))).toEqual(["wiki/a.md", "wiki/b.md"]);
  });
});
