import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uploadTextSource, writeSourceText, normaliseText } from "../src/sources/ingest.js";

function tempProject() {
  const root = mkdtempSync(join(tmpdir(), "ow-ingest-"));
  mkdirSync(join(root, "raw"), { recursive: true });
  return root;
}

describe("normaliseText (3.2)", () => {
  it("forces LF endings", () => {
    expect(normaliseText("a\r\nb\rc")).toBe("a\nb\nc\n");
  });

  it("ensures exactly one trailing newline and strips trailing blanks", () => {
    expect(normaliseText("body\n\n\n")).toBe("body\n");
    expect(normaliseText("no newline")).toBe("no newline\n");
  });
});

describe("uploadTextSource (3.2)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("registers the source, preserves the original, and writes normalised text.md", () => {
    const { id } = uploadTextSource(root, "Fenix notes.md", "# Fenix\n\nBody.\r\n");
    expect(id).toBe("fenix-notes.md");
    const dir = join(root, "raw", id);
    // Original preserved verbatim (CRLF and all) as source.md.
    expect(readFileSync(join(dir, "source.md"), "utf8")).toBe("# Fenix\n\nBody.\r\n");
    // text.md is the normalised form: LF, one trailing newline.
    expect(readFileSync(join(dir, "text.md"), "utf8")).toBe("# Fenix\n\nBody.\n");
  });

  it("treats a .txt upload the same way", () => {
    const { id } = uploadTextSource(root, "readme.txt", "plain text\n\n\n");
    expect(id).toBe("readme.txt");
    expect(readFileSync(join(root, "raw", id, "text.md"), "utf8")).toBe("plain text\n");
  });
});

describe("writeSourceText (3.2)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("writes normalised text into an existing source directory", () => {
    mkdirSync(join(root, "raw", "manual"), { recursive: true });
    writeSourceText(root, "manual", "hello\r\nworld");
    expect(readFileSync(join(root, "raw", "manual", "text.md"), "utf8")).toBe("hello\nworld\n");
  });
});
