import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_SOURCE_BYTES, ingestSource, isTextSource } from "../src/sources/upload.js";
import { listSources, readManifest } from "../src/sources/manifest.js";

/**
 * Any file may be a source (plan `sources-stored-not-parsed` 2.2) — **(TDD)**.
 *
 * Test-first because it is the write path where a mistake is silent:
 * `adr:0011` freezes an id the moment it is written and every citation spells
 * it, so a file stored under the wrong name, or outside `raw/`, is not visible
 * until somebody goes looking — and by then pages cite it.
 *
 * What changes is `adr:0021-sources-are-stored-not-parsed`: the application
 * preserves the original and records what happened to it, and reading it is the
 * agent's job. So most of what this suite used to assert — a refusal per
 * unknown extension — inverts.
 */

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "ow-any-"));
  mkdirSync(join(root, "raw"), { recursive: true });
  return root;
}

describe("storing any file (2.2)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("stores a format nothing here has ever read", async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const outcome = await ingestSource(root, "whiteboard.jpg", bytes);
    expect(outcome).toMatchObject({ ok: true, id: "whiteboard.jpg", stored: "stored" });
    if (!outcome.ok) throw new Error("expected the upload to land");
    // The original, byte for byte, under the name the shape of `raw/` gives it
    // — `source.<ext>`, with the real filename kept in the manifest. It is the
    // evidence; nothing else is.
    expect(readFileSync(join(root, "raw", outcome.id, "source.jpg")).equals(bytes)).toBe(true);
  });

  it("stores a file with no extension at all", async () => {
    // `README` was refused as "nothing to recognise it by". There is nothing to
    // recognise any more, and a file with no extension is still a file.
    const outcome = await ingestSource(root, "README", Buffer.from("hello"));
    expect(outcome.ok).toBe(true);
  });

  it("stores a name that is only an extension", async () => {
    // `.gitignore` is a name, not an extension — the old recogniser said so and
    // then refused the file anyway.
    const outcome = await ingestSource(root, ".gitignore", Buffer.from("node_modules\n"));
    expect(outcome.ok).toBe(true);
  });

  it("writes no text.md for a file it did not read", async () => {
    // `adr:0021`: `text.md` becomes an artifact the *agent* may write. An empty
    // or invented one here would be the application claiming to have read
    // something it did not.
    const outcome = await ingestSource(root, "arch.pdf", Buffer.from("%PDF-1.4 not really"));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected the upload to land");
    expect(existsSync(join(root, "raw", outcome.id, "text.md"))).toBe(false);
  });

  it("still copies text into text.md, because copying text is not extraction", async () => {
    const outcome = await ingestSource(root, "Notas da reunião.md", Buffer.from("# Notas\n"));
    expect(outcome).toMatchObject({ ok: true, id: "notas-da-reuniao.md", stored: "text" });
    if (!outcome.ok) throw new Error("expected the upload to land");
    expect(readFileSync(join(root, "raw", outcome.id, "text.md"), "utf8")).toBe("# Notas\n");
  });

  it("does not open a PDF to find out whether it is one", async () => {
    // The old door parsed a stranger's bytes in the privileged process to
    // decide whether to accept them — the risk `adr:0021` removes. A PDF that
    // no reader would open is now simply a file, and it lands.
    const outcome = await ingestSource(root, "broken.pdf", Buffer.from("not a pdf at all"));
    expect(outcome.ok).toBe(true);
    expect(listSources(root)).toHaveLength(1);
  });

  it("derives and freezes the id from the filename, as it always did", async () => {
    // `adr:0011` is untouched by this: the id is what a citation spells.
    const outcome = await ingestSource(
      root,
      "/home/u/Documents/Report Final.PDF",
      Buffer.from("x"),
    );
    expect(outcome).toMatchObject({ ok: true, id: "report-final.pdf" });
  });

  it("refuses a name already taken, as itself", async () => {
    // The one refusal `adr:0011` chose deliberately: the user renames the file
    // rather than the application inventing `arquitetura-fenix (2).pdf`.
    await ingestSource(root, "notes.md", Buffer.from("first"));
    const outcome = await ingestSource(root, "notes.md", Buffer.from("second"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected a refusal");
    expect(outcome.reason).toMatch(/already exists/);
    // The first upload is untouched: a refusal never overwrites a source.
    expect(readFileSync(join(root, "raw", "notes.md", "text.md"), "utf8")).toBe("first\n");
  });

  it("refuses a file over the size ceiling before anything is written", async () => {
    const outcome = await ingestSource(root, "huge.mp4", Buffer.alloc(MAX_SOURCE_BYTES + 1));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected a refusal");
    expect(outcome.reason).toMatch(/over the/);
    expect(listSources(root)).toEqual([]);
  });

  it("records the file as a file, whatever it is", async () => {
    await ingestSource(root, "vendor-call.eml", Buffer.from("From: x"));
    const manifest = readManifest(root, "vendor-call.eml");
    expect(manifest.kind).toBe("file");
    expect(manifest.original).toBe("vendor-call.eml");
  });
});

describe("isTextSource (2.3)", () => {
  it("is true for the formats whose text.md is a copy rather than an extraction", () => {
    for (const name of ["notes.md", "notes.markdown", "notes.txt", "NOTES.TXT"]) {
      expect(isTextSource(name)).toBe(true);
    }
  });

  it("is false for everything the agent opens itself", () => {
    for (const name of ["arch.pdf", "spec.docx", "board.png", "repo.zip", "README"]) {
      expect(isTextSource(name)).toBe(false);
    }
  });
});
