import { registerSource } from "./register.js";
import { writeSourceText } from "./ingest.js";

/**
 * Upload a DOCX (plan 3.4): extract the text and the heading hierarchy to
 * `text.md`.
 *
 * **The hierarchy is what a DOCX has instead of pages.** A PDF is laid out, so
 * a passage has a page number and 3.3 makes that the provenance anchor. A DOCX
 * is not: pagination happens when Word renders it, and nothing in the file says
 * where page 7 begins. So this path preserves the structure the file *does*
 * carry — the heading levels — and writes no page anchor rather than inventing
 * one. A synthetic `p<N>` would be a number that looks like provenance and
 * points nowhere, which is the failure the plan calls worse than not existing.
 *
 * mammoth does the reading, because a DOCX is a zip of XML with a style system,
 * and the mapping from a named paragraph style to a heading level is the part
 * that is not worth re-deriving. Its own markdown writer is deprecated and
 * escapes ordinary prose (`split in two\.`), so this converts mammoth's HTML —
 * a small, predictable subset — itself.
 *
 * Loaded through a dynamic import for the same reason as the PDF path: a hook
 * fires this package on every page write and must not pay for a DOCX reader.
 */

/** Decode the entities mammoth emits in text; it escapes nothing else. */
function decodeEntities(text: string): string {
  return (
    text
      .replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      // Ampersand last: decoding it first would turn `&amp;lt;` into `<`.
      .replace(/&amp;/g, "&")
  );
}

/** Squeeze the whitespace HTML treats as insignificant, keeping `<br>` breaks. */
function collapse(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface Block {
  /** List items pack tight; every other block gets a blank line around it. */
  list: boolean;
  text: string;
}

/** One open list, and the marker width its children have to indent past. */
interface ListLevel {
  ordered: boolean;
  n: number;
  /** Columns the parent item's content starts at — `- ` is 2, `10. ` is 4. */
  indent: number;
}

const TAG = /<(\/?)([a-z][a-z0-9]*)((?:\s[^>]*?)?)\/?>/gi;

/**
 * Move an emphasis run's edge whitespace outside its delimiters.
 *
 * Word records "bold this word and the space after it" constantly, and mammoth
 * reports it faithfully as `<strong>bold </strong>`. Emitting `**bold **` is not
 * emphasis in CommonMark — a closing `**` preceded by whitespace is not
 * right-flanking — so the reader sees the literal asterisks. The delimiters
 * belong around the trimmed text, with the spaces left where they were.
 */
function emphasise(run: string, delimiter: string): string {
  const core = run.trim();
  if (core === "") return run; // nothing to emphasise; keep the spacing
  const lead = run.slice(0, run.indexOf(core[0]!));
  const trail = run.slice(lead.length + core.length);
  return `${lead}${delimiter}${core}${delimiter}${trail}`;
}

/**
 * Convert the HTML subset mammoth emits into markdown, preserving the heading
 * hierarchy. Unknown tags are unwrapped rather than dropped, so a construct
 * this does not model loses its formatting and never its text.
 *
 * Nothing here escapes markdown punctuation. Escaping is what made mammoth's
 * own writer unusable, and `text.md` is read — by a person and by the agent —
 * not round-tripped back into a document.
 */
export function htmlToMarkdown(html: string): string {
  const blocks: Block[] = [];
  const lists: ListLevel[] = [];
  let buffer = "";
  let heading = 0;
  let quoted = false;
  let href: string | null = null;
  // A cell's text is collected, not flushed: `<p>` inside `<td>` must not end
  // the row. `null` means "not inside a table row".
  let cells: string[] | null = null;
  let inCell = false;
  // A list item's own paragraphs belong to that item; only `</li>` ends it.
  let inItem = false;
  // Where each open emphasis run started in `buffer`, so its delimiters can be
  // placed around the trimmed text when it closes.
  const runs: Array<{ at: number; delimiter: string }> = [];

  const flush = (): void => {
    const text = collapse(buffer);
    buffer = "";
    runs.length = 0;
    if (text === "") return;
    if (heading > 0) {
      blocks.push({ list: false, text: `${"#".repeat(heading)} ${text}` });
      return;
    }
    const top = lists[lists.length - 1];
    if (top) {
      const indent = " ".repeat(top.indent);
      const marker = top.ordered ? `${top.n}. ` : "- ";
      // Continuation lines line up under the item's content, or CommonMark
      // reads them as a new block rather than as part of this item. A blank
      // line stays blank — padding it would leave trailing whitespace, which
      // every linter and diff flags.
      const pad = " ".repeat(indent.length + marker.length);
      const body = text
        .split("\n")
        .map((line, i) => (i === 0 || line === "" ? line : pad + line))
        .join("\n");
      blocks.push({ list: true, text: `${indent}${marker}${body}` });
      return;
    }
    blocks.push({ list: false, text: quoted ? `> ${text.replace(/\n/g, "\n> ")}` : text });
  };

  /** End a paragraph. Inside a cell or a list item it is a break, not a block. */
  const endParagraph = (): void => {
    if (inCell || inItem) {
      if (buffer.trim() !== "") buffer += "\n\n";
      return;
    }
    flush();
  };

  const openEmphasis = (delimiter: string): void => {
    runs.push({ at: buffer.length, delimiter });
  };

  const closeEmphasis = (delimiter: string): void => {
    // Match the innermost open run with this delimiter; an unmatched close is
    // dropped rather than emitting a stray `**`.
    for (let i = runs.length - 1; i >= 0; i--) {
      if (runs[i]!.delimiter !== delimiter) continue;
      const { at } = runs[i]!;
      runs.splice(i, 1);
      buffer = buffer.slice(0, at) + emphasise(buffer.slice(at), delimiter);
      return;
    }
  };

  let cursor = 0;
  for (const match of html.matchAll(TAG)) {
    buffer += decodeEntities(html.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    const closing = match[1] === "/";
    const tag = match[2]!.toLowerCase();
    const attrs = match[3] ?? "";

    const level = /^h([1-6])$/.exec(tag);
    if (level) {
      flush();
      heading = closing ? 0 : Number(level[1]);
      continue;
    }

    switch (tag) {
      case "p":
        endParagraph();
        break;
      case "table":
      case "thead":
      case "tbody":
        flush();
        break;
      case "tr":
        if (closing) {
          // The row is one block; an empty cell keeps its column, or every
          // cell after it shifts left and the table says something else.
          if (cells !== null && cells.length > 0) {
            blocks.push({ list: false, text: cells.join(" | ") });
          }
          cells = null;
        } else {
          flush();
          cells = [];
        }
        break;
      case "td":
      case "th":
        if (closing) {
          cells?.push(collapse(buffer).replace(/\n+/g, " "));
          buffer = "";
          runs.length = 0;
          inCell = false;
        } else {
          if (cells === null) cells = []; // a cell outside any row
          buffer = "";
          runs.length = 0;
          inCell = true;
        }
        break;
      case "ul":
      case "ol":
        flush();
        if (closing) {
          lists.pop();
        } else {
          const parent = lists[lists.length - 1];
          // Indent past the parent item's marker, not by a fixed two spaces:
          // under `1. ` the content column is 3, and two spaces would make the
          // child a sibling instead of a child.
          const indent = parent ? parent.indent + (parent.ordered ? `${parent.n}. `.length : 2) : 0;
          lists.push({ ordered: tag === "ol", n: 0, indent });
        }
        break;
      case "li": {
        flush();
        inItem = !closing;
        const top = lists[lists.length - 1];
        if (!closing && top) top.n += 1;
        break;
      }
      case "blockquote":
        flush();
        quoted = !closing;
        break;
      case "br":
        buffer += "\n";
        break;
      case "strong":
      case "b":
        if (closing) closeEmphasis("**");
        else openEmphasis("**");
        break;
      case "em":
      case "i":
        if (closing) closeEmphasis("_");
        else openEmphasis("_");
        break;
      case "a":
        if (closing) {
          buffer += href === null ? "" : `](${href})`;
          href = null;
        } else {
          const url = /\bhref\s*=\s*"([^"]*)"/i.exec(attrs);
          href = url ? decodeEntities(url[1]!) : null;
          if (href !== null) buffer += "[";
        }
        break;
      case "img":
        // A picture carries no text, and its data URI would swamp the page.
        break;
      default:
        break; // unwrap: keep the text, lose the tag
    }
  }
  buffer += decodeEntities(html.slice(cursor));
  flush();

  let out = "";
  blocks.forEach((block, i) => {
    if (i > 0) out += block.list && blocks[i - 1]!.list ? "\n" : "\n\n";
    out += block.text;
  });
  return out;
}

/**
 * The most a DOCX may inflate to. A zip entry can expand by a factor of a
 * thousand, and mammoth holds the whole of `word/document.xml` as one string
 * and then as a DOM — so a 550 KB file that declares 166 MB of XML exhausts the
 * heap. That is not a catchable exception: V8 aborts the process, so no
 * `try/catch` downstream contains it, and because a file is only removed from
 * the inbox on success the same file is re-read on every start.
 */
export const MAX_DOCX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;

/** The end-of-central-directory record can sit behind a comment up to 64 KiB. */
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const ZIP64_SENTINEL = 0xffffffff;

/**
 * Sum the uncompressed sizes a zip's central directory **declares**, without
 * inflating anything. Returns `null` when the structure cannot be read — a
 * malformed archive is mammoth's to report, not this guard's to guess at.
 */
export function declaredUncompressedSize(zip: Buffer): number | null {
  const start = Math.max(0, zip.length - (22 + 0xffff));
  let eocd = -1;
  for (let i = zip.length - 22; i >= start; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return null;

  const entries = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  if (offset === ZIP64_SENTINEL) return Number.POSITIVE_INFINITY; // ZIP64: refuse

  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > zip.length) return null;
    if (zip.readUInt32LE(offset) !== CENTRAL_SIGNATURE) return null;
    const size = zip.readUInt32LE(offset + 24);
    // A ZIP64 entry hides its real size in an extra field. Rather than parse
    // that, treat it as over any ceiling: a document that needs ZIP64 is not a
    // document this reads.
    if (size === ZIP64_SENTINEL) return Number.POSITIVE_INFINITY;
    total += size;
    offset +=
      46 +
      zip.readUInt16LE(offset + 28) +
      zip.readUInt16LE(offset + 30) +
      zip.readUInt16LE(offset + 32);
  }
  return total;
}

/**
 * Read a DOCX and return its body as markdown, headings and all. Refuses a
 * document that declares more inflated bytes than the ceiling above, before
 * handing anything to the reader.
 */
export async function extractDocxMarkdown(content: Buffer): Promise<string> {
  const declared = declaredUncompressedSize(content);
  if (declared !== null && declared > MAX_DOCX_UNCOMPRESSED_BYTES) {
    throw new Error(
      `this DOCX declares ${declared} bytes of content, over the ${MAX_DOCX_UNCOMPRESSED_BYTES}-byte limit — ` +
        "a document that large is not one this reads",
    );
  }
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.convertToHtml({ buffer: content });
  return htmlToMarkdown(value);
}

/**
 * Register a DOCX under `raw/<id>/` — the original preserved as `source.docx` —
 * and write its extracted `text.md`. Returns the frozen id.
 */
export async function uploadDocxSource(
  projectRoot: string,
  name: string,
  content: Buffer,
): Promise<{ id: string }> {
  const markdown = await extractDocxMarkdown(content);
  const { id } = registerSource(projectRoot, { name, kind: "file", content });
  writeSourceText(projectRoot, id, markdown);
  return { id };
}
