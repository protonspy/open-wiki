import { registerSource } from "./register.js";
import { writeSourceText } from "./ingest.js";

/**
 * Upload a PDF (plan 3.3): extract the text to `text.md`, keeping the page
 * number as a provenance anchor.
 *
 * **The page number is the point.** A PDF whose text arrives as one undivided
 * blob is a source nothing can cite: `resolveProvenance` requires the fragment
 * `p<N>`, and there is nothing to resolve it against. So the extraction is
 * per-page by construction, and the rendered `text.md` marks each page with a
 * `## p<N>` heading — the same token the citation carries, so the fragment of
 * `src://<id>#p12` is also the markdown anchor of the heading it points at.
 *
 * pdfjs-dist is loaded through a dynamic import rather than at module scope: a
 * `PreToolUse` hook fires this package's process on every page write, and
 * paying for a PDF engine on a path that never opens a PDF is exactly the cold
 * start 9.14 is about.
 */

export interface PdfPage {
  /** 1-based, as printed and as cited. */
  page: number;
  text: string;
}

/**
 * The most pages this will walk. Each page's text content is held in memory
 * until the whole document is rendered, so an unbounded page count is an
 * unbounded allocation driven by an untrusted file.
 */
export const MAX_PDF_PAGES = 5000;

/** The heading that marks where page `n` begins in a rendered `text.md`. */
export function pageAnchor(page: number): string {
  return `## p${page}`;
}

interface TextItemLike {
  str: string;
  hasEOL?: boolean;
}

/** Marked-content items carry no `str`; only text items do. */
function isTextItem(item: unknown): item is TextItemLike {
  return (
    typeof item === "object" && item !== null && typeof (item as TextItemLike).str === "string"
  );
}

/**
 * Join one page's text items back into lines. pdfjs reports a line break as
 * `hasEOL` on the item that ends the line; without honouring it every line of
 * the page runs into the next one and the text is unreadable.
 */
export function joinTextItems(items: readonly unknown[]): string {
  let out = "";
  for (const item of items) {
    if (!isTextItem(item)) continue;
    out += item.str;
    if (item.hasEOL) out += "\n";
  }
  // A PDF's line breaks are visual, so runs of blank lines carry no meaning;
  // collapse them to a paragraph break and drop the trailing whitespace.
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract a PDF's text one page at a time. Returns one entry per page, in
 * order, including pages whose text is empty — a scanned page still occupies a
 * page number, and dropping it would shift every anchor after it.
 */
export async function extractPdfPages(data: Uint8Array): Promise<PdfPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    // pdfjs takes ownership of the buffer it is handed, so give it a copy: the
    // caller still holds `data` to write the preserved original with.
    data: new Uint8Array(data),
    // No system font lookup: this reads text out of the content stream and
    // never renders a glyph, so probing the host's fonts is pure latency.
    useSystemFonts: false,
    // ERRORS only. Text extraction needs no font programme, so the font
    // warnings a headless run emits are noise in every caller's log.
    verbosity: 0,
  });
  try {
    // Inside the `try`: a document the reader rejects must still be destroyed,
    // and `await task.promise` is exactly where that rejection arrives. Leaving
    // it outside skipped the cleanup on the one path that always fails.
    const doc = await task.promise;
    if (doc.numPages > MAX_PDF_PAGES) {
      throw new Error(
        `this PDF has ${doc.numPages} pages, over the ${MAX_PDF_PAGES}-page limit — ` +
          "a document that large is not one this reads",
      );
    }
    const pages: PdfPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push({ page: n, text: joinTextItems(content.items) });
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

/**
 * Render extracted pages as the source's `text.md`: each page under its
 * `## p<N>` anchor, in order. An empty page keeps its heading — the anchor has
 * to exist for the citation to resolve, and "this page has no extractable text"
 * is itself worth seeing.
 */
export function renderPdfText(pages: readonly PdfPage[]): string {
  return pages
    .map(({ page, text }) => (text === "" ? pageAnchor(page) : `${pageAnchor(page)}\n\n${text}`))
    .join("\n\n");
}

/**
 * Register a PDF under `raw/<id>/` — the original preserved as `source.pdf` —
 * and write its extracted `text.md`. Returns the frozen id and the page count.
 */
export async function uploadPdfSource(
  projectRoot: string,
  name: string,
  content: Buffer,
): Promise<{ id: string; pages: number }> {
  const pages = await extractPdfPages(new Uint8Array(content));
  const { id } = registerSource(projectRoot, { name, kind: "file", content });
  writeSourceText(projectRoot, id, renderPdfText(pages));
  return { id, pages: pages.length };
}
