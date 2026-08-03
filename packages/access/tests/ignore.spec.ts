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

  it("ignores raw/_inbox/, which holds material nobody has read yet", () => {
    writeIgnore(root);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain("raw/_inbox/");
  });

  it("ignores an unpacked archive, which is thousands of files nobody chose (6.5)", () => {
    // The archive beside it is committed and is the thing that arrived; the
    // tree is a reading convenience `ow` can produce again from it. Committing
    // it is the opt-in, for the project whose codewiki pages cite into it.
    writeIgnore(root);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain("raw/**/contents/");
  });

  it("brings a project scaffolded by an earlier version up to date", () => {
    // The block used to be skipped whenever it was already present, so a rule
    // added later never reached a project created earlier — while `scaffold`
    // still created the new *directory* in it. For `raw/_inbox/` that is
    // exactly backwards: the doorway appears, and the unreviewed material an
    // agent drops in it is committed by anyone running `git add -A`.
    const old = [OPEN_BLOCK, ".state/", "raw/**/*.wav", CLOSE_BLOCK].join("\n");
    writeFileSync(join(root, ".gitignore"), `node_modules/\n\n${old}\n`);

    writeIgnore(root);

    const after = readFileSync(join(root, ".gitignore"), "utf8");
    expect(after).toContain("raw/_inbox/");
    expect(after.split(OPEN_BLOCK).length).toBe(2); // still exactly one block
    expect(after.startsWith("node_modules/\n")).toBe(true); // the user's lines survive
  });

  it("leaves everything outside the markers alone, above and below", () => {
    const above = "node_modules/\n";
    const below = "!raw/_inbox/keep-this.md\n";
    writeIgnore(root);
    writeFileSync(
      join(root, ".gitignore"),
      `${above}${readFileSync(join(root, ".gitignore"), "utf8")}${below}`,
    );

    writeIgnore(root);

    const body = readFileSync(join(root, ".gitignore"), "utf8");
    expect(body.startsWith(above)).toBe(true);
    // A negation below the block is how opting in is expressed now: git takes
    // the last matching pattern, and a line outside the markers is never
    // rewritten. That is a thing the file can state, unlike an edit inside the
    // block, which the tool could not tell from a mistake.
    expect(body.trimEnd().endsWith("!raw/_inbox/keep-this.md")).toBe(true);
    expect(body.split(OPEN_BLOCK).length).toBe(2);
  });

  it("appends a whole block when only half a marker is present", () => {
    // A truncated block is not something to guess at: append a real one and
    // leave the damaged text where it is for the user to see.
    writeFileSync(join(root, ".gitignore"), `${OPEN_BLOCK}\n.state/\n`);
    writeIgnore(root);
    const body = readFileSync(join(root, ".gitignore"), "utf8");
    expect(body).toContain(CLOSE_BLOCK);
    expect(body).toContain("raw/_inbox/");
  });
});
