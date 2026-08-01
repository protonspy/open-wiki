import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_DOCX_UNCOMPRESSED_BYTES,
  declaredUncompressedSize,
  extractDocxMarkdown,
  htmlToMarkdown,
  uploadDocxSource,
} from "../src/sources/docx.js";
import { readManifest } from "../src/sources/manifest.js";
import { buildBombDocx, buildDocx } from "./fixtures/documents.js";

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "ow-docx-"));
  mkdirSync(join(root, "raw"), { recursive: true });
  return root;
}

describe("DOCX upload (3.4)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  describe("htmlToMarkdown", () => {
    it("maps every heading level to its own depth of hash", () => {
      const md = htmlToMarkdown("<h1>One</h1><h2>Two</h2><h3>Three</h3><h6>Six</h6>");
      expect(md).toBe("# One\n\n## Two\n\n### Three\n\n###### Six");
    });

    it("separates paragraphs with a blank line", () => {
      expect(htmlToMarkdown("<p>first</p><p>second</p>")).toBe("first\n\nsecond");
    });

    it("keeps a heading and the text under it in order", () => {
      expect(htmlToMarkdown("<h2>Storage</h2><p>Postgres.</p>")).toBe("## Storage\n\nPostgres.");
    });

    it("renders an unordered list as tight bullets", () => {
      expect(htmlToMarkdown("<ul><li>a</li><li>b</li></ul>")).toBe("- a\n- b");
    });

    it("numbers an ordered list from one", () => {
      expect(htmlToMarkdown("<ol><li>a</li><li>b</li><li>c</li></ol>")).toBe("1. a\n2. b\n3. c");
    });

    it("indents a nested list under its parent item", () => {
      expect(htmlToMarkdown("<ul><li>outer<ul><li>inner</li></ul></li></ul>")).toBe(
        "- outer\n  - inner",
      );
    });

    it("indents a nested ordered list past its parent's marker, not by a fixed two", () => {
      // Under `1. ` the content column is 3. Two spaces would make the child a
      // sibling of its parent, which is the nesting the requirement asks for
      // being silently lost.
      expect(htmlToMarkdown("<ol><li>a<ol><li>x</li></ol></li></ol>")).toBe("1. a\n   1. x");
    });

    it("keeps a multi-paragraph list item as one item", () => {
      // mammoth emits this whenever a Word list item holds more than one
      // paragraph; splitting it reports content the document does not contain.
      expect(htmlToMarkdown("<ul><li>a<p>second para</p></li></ul>")).toBe("- a\n\n  second para");
    });

    it("carries bold and italic through as markdown emphasis", () => {
      expect(htmlToMarkdown("<p>a <strong>bold</strong> and <em>soft</em> word</p>")).toBe(
        "a **bold** and _soft_ word",
      );
    });

    it("moves an emphasis run's edge space outside the delimiters", () => {
      // Word records "bold the word and the space after it" constantly, and
      // `**bold **tail` is not emphasis in CommonMark — the reader would see
      // the asterisks themselves.
      expect(htmlToMarkdown("<p><strong>bold </strong>tail</p>")).toBe("**bold** tail");
      expect(htmlToMarkdown("<p>lead<strong> in</strong>side</p>")).toBe("lead **in**side");
      expect(htmlToMarkdown("<p>a<em> soft </em>b</p>")).toBe("a _soft_ b");
    });

    it("keeps the spacing of an emphasis run that is only whitespace", () => {
      expect(htmlToMarkdown("<p>a<strong> </strong>b</p>")).toBe("a b");
    });

    it("keeps a link's text and its target", () => {
      expect(htmlToMarkdown('<p>see <a href="https://x.test/a">the note</a></p>')).toBe(
        "see [the note](https://x.test/a)",
      );
    });

    it("decodes entities, and decodes an escaped ampersand only once", () => {
      // `&amp;lt;` is a literal "&lt;", not a "<": decoding the ampersand first
      // would produce the wrong character.
      expect(htmlToMarkdown("<p>Tom &amp; Jerry &lt;one&gt; &amp;lt;</p>")).toBe(
        "Tom & Jerry <one> &lt;",
      );
    });

    it("breaks a line where the document broke it", () => {
      expect(htmlToMarkdown("<p>one<br />two</p>")).toBe("one\ntwo");
    });

    it("prefixes a quoted block, including its continuation lines", () => {
      expect(htmlToMarkdown("<blockquote><p>a<br />b</p></blockquote>")).toBe("> a\n> b");
    });

    it("keeps the text of a tag it does not model, and loses only the tag", () => {
      expect(htmlToMarkdown("<p>a <sup>note</sup> here</p>")).toBe("a note here");
    });

    it("drops an image, which carries no text", () => {
      expect(htmlToMarkdown('<p>before<img src="data:image/png;base64,AAAA" />after</p>')).toBe(
        "beforeafter",
      );
    });

    it("renders a table row as its cells, in the shape mammoth actually emits", () => {
      // mammoth wraps every cell's text in a paragraph. Asserting against bare
      // <td>a</td> passed on a path production never takes, while the real one
      // dropped the row structure entirely.
      expect(
        htmlToMarkdown(
          "<table><tr><td><p>a</p></td><td><p>b</p></td></tr>" +
            "<tr><td><p>c</p></td><td><p>d</p></td></tr></table>",
        ),
      ).toBe("a | b\n\nc | d");
    });

    it("keeps an empty cell, so the columns after it do not shift left", () => {
      expect(htmlToMarkdown("<table><tr><td><p></p></td><td><p>b</p></td></tr></table>")).toBe(
        " | b",
      );
      expect(htmlToMarkdown("<table><tr><td><p>c</p></td><td><p></p></td></tr></table>")).toBe(
        "c | ",
      );
    });

    it("returns nothing for an empty document", () => {
      expect(htmlToMarkdown("")).toBe("");
    });
  });

  describe("extractDocxMarkdown", () => {
    it("preserves the heading hierarchy of the document", async () => {
      const docx = buildDocx([
        { text: "Fenix architecture", style: "Heading1" },
        { text: "The service is split in two.", style: undefined },
        { text: "Storage", style: "Heading2" },
        { text: "Postgres, one schema per tenant.", style: undefined },
      ]);
      const md = await extractDocxMarkdown(docx);
      expect(md).toBe(
        "# Fenix architecture\n\nThe service is split in two.\n\n" +
          "## Storage\n\nPostgres, one schema per tenant.",
      );
    });

    it("leaves ordinary prose unescaped", async () => {
      // The deprecated writer emits `two\.`; a backslash in stored text is a
      // defect the reader sees, so this path must not produce one.
      const md = await extractDocxMarkdown(buildDocx([{ text: "Split in two." }]));
      expect(md).toBe("Split in two.");
      expect(md).not.toContain("\\");
    });

    it("starts at the document's own first heading, with nothing prepended", async () => {
      // A DOCX has no pages, so nothing synthesises an anchor above the body.
      // Asserting the absence of `## p<N>` proved nothing — no path could emit
      // one — so assert what is actually there instead.
      const md = await extractDocxMarkdown(
        buildDocx([{ text: "Requisitos", style: "Heading1" }, { text: "Body" }]),
      );
      expect(md.startsWith("# Requisitos")).toBe(true);
    });

    it("refuses a document that declares more content than it will inflate", async () => {
      await expect(
        extractDocxMarkdown(buildBombDocx(MAX_DOCX_UNCOMPRESSED_BYTES + 1)),
      ).rejects.toThrow(/over the \d+-byte limit/);
    });
  });

  describe("declaredUncompressedSize", () => {
    it("sums what the central directory declares, without inflating anything", () => {
      const docx = buildDocx([{ text: "Body" }]);
      const declared = declaredUncompressedSize(docx);
      expect(declared).toBeGreaterThan(0);
      // Everything is stored uncompressed here, so the declaration is the truth
      // and is necessarily smaller than the container.
      expect(declared!).toBeLessThan(docx.length);
    });

    it("reads the size a bomb declares rather than the bytes it holds", () => {
      const bomb = buildBombDocx(200 * 1024 * 1024);
      expect(bomb.length).toBeLessThan(4096);
      expect(declaredUncompressedSize(bomb)).toBeGreaterThan(200 * 1024 * 1024 - 1);
    });

    it("returns null for something that is not a zip, leaving the reader to say so", () => {
      expect(declaredUncompressedSize(Buffer.from("not a zip at all"))).toBeNull();
    });
  });

  describe("uploadDocxSource", () => {
    it("preserves the original and writes the extracted text.md", async () => {
      const docx = buildDocx([
        { text: "Requisitos", style: "Heading1" },
        { text: "O sistema deve responder em 200ms." },
      ]);
      const { id } = await uploadDocxSource(root, "Requisitos Fenix.docx", docx);

      expect(id).toBe("requisitos-fenix.docx");
      const dir = join(root, "raw", id);
      expect(existsSync(join(dir, "source.docx"))).toBe(true);
      expect(readFileSync(join(dir, "source.docx")).equals(docx)).toBe(true);

      const text = readFileSync(join(dir, "text.md"), "utf8");
      expect(text).toBe("# Requisitos\n\nO sistema deve responder em 200ms.\n");

      expect(readManifest(root, id).original).toBe("Requisitos Fenix.docx");
    });

    it("refuses a filename already taken rather than inventing a suffix", async () => {
      const docx = buildDocx([{ text: "x" }]);
      await uploadDocxSource(root, "spec.docx", docx);
      await expect(uploadDocxSource(root, "spec.docx", docx)).rejects.toThrow(/already exists/);
    });
  });
});
