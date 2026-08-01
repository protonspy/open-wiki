import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_SOURCE_BYTES,
  ingestSource,
  recogniseSource,
  recognisedExtensions,
} from "../src/sources/upload.js";
import { listSources } from "../src/sources/manifest.js";
import { buildPdf, buildDocx } from "./fixtures/documents.js";

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "ow-upload-"));
  mkdirSync(join(root, "raw"), { recursive: true });
  return root;
}

describe("the upload door (3.5, 3.7)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  describe("recogniseSource", () => {
    it("recognises the three source formats by extension", () => {
      expect(recogniseSource("notes.md")).toBe("text");
      expect(recogniseSource("notes.markdown")).toBe("text");
      expect(recogniseSource("notes.txt")).toBe("text");
      expect(recogniseSource("architecture.pdf")).toBe("pdf");
      expect(recogniseSource("requisitos.docx")).toBe("docx");
    });

    it("ignores the case of the extension", () => {
      expect(recogniseSource("ARCHITECTURE.PDF")).toBe("pdf");
      expect(recogniseSource("Notes.Md")).toBe("text");
    });

    it("recognises nothing else, including a file with no extension", () => {
      expect(recogniseSource("recording.mp3")).toBeNull();
      expect(recogniseSource("archive.zip")).toBeNull();
      expect(recogniseSource("legacy.doc")).toBeNull();
      expect(recogniseSource("README")).toBeNull();
    });

    it("does not read a leading dot as an extension", () => {
      // `.gitignore` is a name, not an extension.
      expect(recogniseSource(".gitignore")).toBeNull();
    });

    it("lists what it accepts, so a caller can advertise it", () => {
      expect(recognisedExtensions()).toContain(".pdf");
      expect(recognisedExtensions()).toContain(".docx");
      expect(recognisedExtensions()).toContain(".md");
    });
  });

  describe("ingestSource", () => {
    it("ingests markdown through the text adapter", async () => {
      const outcome = await ingestSource(root, "Notas da reunião.md", Buffer.from("# Notas\n"));
      expect(outcome).toMatchObject({ ok: true, format: "text", id: "notas-da-reuniao.md" });
      if (!outcome.ok) throw new Error("expected the upload to land");
      expect(readFileSync(join(root, "raw", outcome.id, "text.md"), "utf8")).toBe("# Notas\n");
    });

    it("ingests a PDF through the PDF adapter, anchors and all", async () => {
      const outcome = await ingestSource(root, "arch.pdf", buildPdf([["one"], ["two"]]));
      expect(outcome).toMatchObject({ ok: true, format: "pdf", id: "arch.pdf" });
      if (!outcome.ok) throw new Error("expected the upload to land");
      const text = readFileSync(join(root, "raw", outcome.id, "text.md"), "utf8");
      expect(text).toContain("## p1");
      expect(text).toContain("## p2");
    });

    it("ingests a DOCX through the DOCX adapter, hierarchy and all", async () => {
      const docx = buildDocx([{ text: "Title", style: "Heading1" }, { text: "Body" }]);
      const outcome = await ingestSource(root, "spec.docx", docx);
      expect(outcome).toMatchObject({ ok: true, format: "docx", id: "spec.docx" });
      if (!outcome.ok) throw new Error("expected the upload to land");
      expect(readFileSync(join(root, "raw", outcome.id, "text.md"), "utf8")).toBe(
        "# Title\n\nBody\n",
      );
    });

    it("reports an unrecognised format instead of throwing, and lists what it knows", async () => {
      const outcome = await ingestSource(root, "meeting.mp3", Buffer.from("ID3"));
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("expected a refusal");
      expect(outcome.format).toBeNull();
      expect(outcome.reason).toContain(".mp3");
      expect(outcome.reason).toContain(".pdf");
    });

    it("says what to do about a legacy .doc rather than only refusing it", async () => {
      const outcome = await ingestSource(root, "old.doc", Buffer.from("\xd0\xcf"));
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("expected a refusal");
      expect(outcome.reason).toContain("save it as .docx");
    });

    it("reports a name already taken as this file's reason, not as a throw", async () => {
      await ingestSource(root, "notes.md", Buffer.from("first"));
      const outcome = await ingestSource(root, "notes.md", Buffer.from("second"));
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("expected a refusal");
      expect(outcome.reason).toMatch(/already exists/);
      // The first upload is untouched: a refusal never overwrites a source.
      expect(readFileSync(join(root, "raw", "notes.md", "text.md"), "utf8")).toBe("first\n");
    });

    it("refuses a file over the size ceiling before any reader sees it", async () => {
      const huge = Buffer.alloc(MAX_SOURCE_BYTES + 1);
      const outcome = await ingestSource(root, "huge.pdf", huge);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("expected a refusal");
      expect(outcome.reason).toMatch(/over the \d+-byte limit/);
      expect(listSources(root)).toEqual([]);
    });

    it("registers under the basename when handed a whole path", async () => {
      // The drag-and-drop surface of 3.5 naturally has a full path. Recognition
      // looked past the directories and id derivation did not, so this used to
      // land as `home-u-documents-report-pdf`.
      const outcome = await ingestSource(root, "/home/u/Documents/Report.pdf", buildPdf([["x"]]));
      expect(outcome).toMatchObject({ ok: true, id: "report.pdf" });
    });

    it("reports a document the reader will not open as this file's reason", async () => {
      const outcome = await ingestSource(root, "broken.pdf", Buffer.from("not a pdf at all"));
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("expected a refusal");
      expect(outcome.format).toBe("pdf");
      expect(outcome.reason.length).toBeGreaterThan(0);
    });

    it("registers no source when the document could not be read", async () => {
      await ingestSource(root, "broken.pdf", Buffer.from("not a pdf at all"));
      // A half-registered source — a directory with a manifest and no text —
      // would be a permanent, immutable mistake under raw/, so extraction runs
      // before registration rather than after it.
      expect(listSources(root)).toEqual([]);
    });
  });
});
