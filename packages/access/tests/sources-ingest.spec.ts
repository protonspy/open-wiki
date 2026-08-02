import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uploadTextSource, writeSourceText, normaliseText } from "../src/sources/ingest.js";
import { readManifest } from "../src/sources/manifest.js";

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

describe("writeSourceText withdraws a declaration the material outran (R3.1)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function source(id: string, extra: Record<string, unknown> = {}): string {
    const dir = join(root, "raw", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({ id, title: id, kind: "recording", original: "", ...extra }),
      "utf8",
    );
    return dir;
  }

  it("withdraws it when text.md lands on a source already declared processed", () => {
    // The case is a recording: somebody marked it before its transcription
    // finished, so the declaration was made about a source that did not yet
    // say any of this.
    source("fenix-weekly-2026-07-31", { processed: "2026-08-01" });
    writeSourceText(root, "fenix-weekly-2026-07-31", "## 14:32\n\n**me** — we ship Friday.");
    expect(readManifest(root, "fenix-weekly-2026-07-31").processed).toBeUndefined();
  });

  it("leaves a manifest with nothing declared byte-for-byte alone", () => {
    const dir = source("notes.txt");
    const before = readFileSync(join(dir, "manifest.json"), "utf8");
    writeSourceText(root, "notes.txt", "body");
    expect(readFileSync(join(dir, "manifest.json"), "utf8")).toBe(before);
  });

  it("still writes text.md when the manifest is unreadable or absent", () => {
    // `writeSourceText` also runs mid-registration and over directories the
    // audio pipeline assembles. A text.md that failed to land because of a
    // malformed manifest is worse than a stale declaration.
    mkdirSync(join(root, "raw", "no-manifest"), { recursive: true });
    writeSourceText(root, "no-manifest", "body");
    expect(readFileSync(join(root, "raw", "no-manifest", "text.md"), "utf8")).toBe("body\n");

    const dir = source("broken");
    writeFileSync(join(dir, "manifest.json"), "{ not json", "utf8");
    writeSourceText(root, "broken", "body");
    expect(readFileSync(join(dir, "text.md"), "utf8")).toBe("body\n");
  });
});
