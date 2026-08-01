import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractPdfPages,
  joinTextItems,
  pageAnchor,
  renderPdfText,
  uploadPdfSource,
} from "../src/sources/pdf.js";
import { readManifest } from "../src/sources/manifest.js";
import { buildPdf } from "./fixtures/documents.js";

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "ow-pdf-"));
  mkdirSync(join(root, "raw"), { recursive: true });
  return root;
}

describe("PDF upload (3.3)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  describe("pageAnchor", () => {
    it("is the heading whose markdown anchor equals the citation fragment", () => {
      // A citation reads src://<id>#p12; the anchor of `## p12` is #p12, so the
      // link the agent writes also points at the right place inside text.md.
      expect(pageAnchor(12)).toBe("## p12");
      expect(pageAnchor(1)).toBe("## p1");
    });
  });

  describe("joinTextItems", () => {
    it("breaks a line where the item says the line ended", () => {
      const joined = joinTextItems([
        { str: "first line", hasEOL: true },
        { str: "second line", hasEOL: true },
      ]);
      expect(joined).toBe("first line\nsecond line");
    });

    it("keeps items on one line when no item ends it", () => {
      expect(joinTextItems([{ str: "one " }, { str: "line" }])).toBe("one line");
    });

    it("ignores marked-content items, which carry no text", () => {
      expect(joinTextItems([{ type: "beginMarkedContent" }, { str: "text" }])).toBe("text");
    });

    it("collapses runs of blank lines, which are visual and mean nothing", () => {
      const joined = joinTextItems([
        { str: "a", hasEOL: true },
        { str: "", hasEOL: true },
        { str: "", hasEOL: true },
        { str: "b", hasEOL: true },
      ]);
      expect(joined).toBe("a\n\nb");
    });
  });

  describe("extractPdfPages", () => {
    it("returns one entry per page, in order, with that page's text", async () => {
      const pdf = buildPdf([
        ["Fenix architecture", "The service is split in two."],
        ["Storage", "Postgres, one schema per tenant."],
      ]);
      const pages = await extractPdfPages(new Uint8Array(pdf));

      expect(pages.map((p) => p.page)).toEqual([1, 2]);
      expect(pages[0]!.text).toContain("Fenix architecture");
      expect(pages[0]!.text).toContain("The service is split in two.");
      expect(pages[1]!.text).toContain("Postgres, one schema per tenant.");
      // Page two's text must not have leaked into page one, or every citation
      // after the first page points at the wrong place.
      expect(pages[0]!.text).not.toContain("Postgres");
    });

    it("keeps a page with no extractable text, so later anchors do not shift", async () => {
      const pages = await extractPdfPages(new Uint8Array(buildPdf([["one"], [], ["three"]])));
      expect(pages.map((p) => p.page)).toEqual([1, 2, 3]);
      expect(pages[1]!.text).toBe("");
      expect(pages[2]!.text).toContain("three");
    });

    it("leaves the caller's buffer readable after extraction", async () => {
      // pdfjs transfers the buffer it is handed; uploadPdfSource still needs the
      // bytes afterwards to preserve the original.
      const pdf = buildPdf([["only page"]]);
      const bytes = new Uint8Array(pdf);
      await extractPdfPages(bytes);
      expect(bytes.byteLength).toBeGreaterThan(0);
      expect(Buffer.from(bytes).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    });
  });

  describe("renderPdfText", () => {
    it("puts every page under its own anchor, in order", () => {
      const md = renderPdfText([
        { page: 1, text: "first" },
        { page: 2, text: "second" },
      ]);
      expect(md).toBe("## p1\n\nfirst\n\n## p2\n\nsecond");
    });

    it("still emits the anchor of a page with no text", () => {
      expect(
        renderPdfText([
          { page: 1, text: "" },
          { page: 2, text: "b" },
        ]),
      ).toBe("## p1\n\n## p2\n\nb");
    });
  });

  describe("uploadPdfSource", () => {
    it("preserves the original and writes text.md with the page anchors", async () => {
      const pdf = buildPdf([["Fenix architecture"], ["Storage notes"]]);
      const { id, pages } = await uploadPdfSource(root, "Arquitetura Fenix.pdf", pdf);

      expect(id).toBe("arquitetura-fenix.pdf");
      expect(pages).toBe(2);

      const dir = join(root, "raw", id);
      expect(existsSync(join(dir, "source.pdf"))).toBe(true);
      // The preserved original is the bytes that came in, not a re-encoding.
      expect(readFileSync(join(dir, "source.pdf")).equals(pdf)).toBe(true);

      const text = readFileSync(join(dir, "text.md"), "utf8");
      expect(text).toContain("## p1");
      expect(text).toContain("Fenix architecture");
      expect(text).toContain("## p2");
      expect(text).toContain("Storage notes");
      expect(text.endsWith("\n")).toBe(true);

      const manifest = readManifest(root, id);
      expect(manifest.kind).toBe("file");
      expect(manifest.title).toBe("Arquitetura Fenix.pdf");
      expect(manifest.original).toBe("Arquitetura Fenix.pdf");
    });

    it("refuses a filename already taken rather than inventing a suffix", async () => {
      const pdf = buildPdf([["x"]]);
      await uploadPdfSource(root, "report.pdf", pdf);
      await expect(uploadPdfSource(root, "report.pdf", pdf)).rejects.toThrow(/already exists/);
    });
  });
});
