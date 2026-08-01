import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeIgnore, OPEN_BLOCK, CLOSE_BLOCK } from "../src/ignore.js";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "ow-ignore-"));
}

describe("ignore entries (2.8)", () => {
  let root: string;
  beforeEach(() => (root = tempDir()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("writes .gitignore with .state/ and recorded audio out by default", () => {
    writeIgnore(root);
    const body = readFileSync(join(root, ".gitignore"), "utf8");
    expect(body).toContain(".state/");
    expect(body).toContain("audio");
    // Committing is opt-in: the entries are present, the user removes them to opt in.
    expect(body).toContain(OPEN_BLOCK);
    expect(body).toContain(CLOSE_BLOCK);
  });

  it("is idempotent — running twice does not duplicate the block", () => {
    writeIgnore(root);
    writeIgnore(root);
    const body = readFileSync(join(root, ".gitignore"), "utf8");
    expect(body.split(OPEN_BLOCK).length).toBe(2); // exactly one block
  });

  it("preserves existing .gitignore content, appending the block", () => {
    writeFileSync(join(root, ".gitignore"), "node_modules/\n");
    writeIgnore(root);
    const body = readFileSync(join(root, ".gitignore"), "utf8");
    expect(body.startsWith("node_modules/\n")).toBe(true);
    expect(body).toContain(OPEN_BLOCK);
    expect(body).toContain(".state/");
  });

  it("does not clobber a block the user has edited (still recognised as present)", () => {
    writeIgnore(root);
    // Simulate the user opting in to committing opus by editing inside the block.
    const body = readFileSync(join(root, ".gitignore"), "utf8");
    const edited = body.replace("raw/**/*.opus\n", "");
    writeFileSync(join(root, ".gitignore"), edited);
    writeIgnore(root); // should not re-add opus or duplicate
    const after = readFileSync(join(root, ".gitignore"), "utf8");
    expect(after.split(OPEN_BLOCK).length).toBe(2);
    expect(after).not.toContain("raw/**/*.opus");
  });
});
