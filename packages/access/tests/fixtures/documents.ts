import { crc32 } from "node:zlib";

/**
 * Document fixtures built in-process, so the PDF and DOCX tests assert against
 * a document whose content the test states rather than against a binary blob
 * checked in beside them. Both writers emit the smallest file the format's
 * readers accept.
 */

/**
 * Build a PDF with one page per entry, each entry a list of lines. Objects are
 * uncompressed and the cross-reference table is real, so the file is one any
 * conforming reader opens — not something that happens to work with pdfjs.
 */
export function buildPdf(pages: readonly (readonly string[])[]): Buffer {
  const objects: string[] = [];
  const fontObj = 3 + pages.length * 2;
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;

  pages.forEach((lines, i) => {
    const pageNo = 3 + i * 2;
    const contentNo = pageNo + 1;
    objects[pageNo] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentNo} 0 R ` +
      `/Resources << /Font << /F1 ${fontObj} 0 R >> >> >>`;
    // Each line is placed 16pt below the last; the vertical move is what makes
    // it a new line rather than a continuation of the same one.
    const shown = lines
      .map((line, n) => `${n === 0 ? "72 720 Td" : "0 -16 Td"} (${escapePdfText(line)}) Tj`)
      .join("\n");
    const stream = `BT\n/F1 12 Tf\n${shown}\nET\n`;
    objects[contentNo] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
  });
  objects[fontObj] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) {
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** `(`, `)` and `\` end or escape a PDF string literal. */
function escapePdfText(text: string): string {
  return text.replace(/([\\()])/g, "\\$1");
}

/** One paragraph of a DOCX body, optionally carrying a named paragraph style. */
export interface DocxParagraph {
  text: string;
  /** `Heading1` … `Heading6`; absent for body text. */
  style?: string;
}

/**
 * Build a DOCX carrying the given paragraphs. A DOCX is an OPC zip: the three
 * parts below are the minimum a reader needs to find and read the body.
 */
export function buildDocx(paragraphs: readonly DocxParagraph[]): Buffer {
  const body = paragraphs
    .map(
      ({ text, style }) =>
        `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}` +
        `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`,
    )
    .join("");

  return storedZip([
    ["[Content_Types].xml", CONTENT_TYPES],
    ["_rels/.rels", RELS],
    [
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    ],
  ]);
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/**
 * Build a DOCX whose central directory **declares** `declaredBytes` of
 * uncompressed content while holding almost none — the shape of a zip bomb,
 * which is what the size guard reads before it inflates anything. Lying in the
 * declaration is the point: a fixture that really held 64 MB would test the
 * heap rather than the guard.
 */
export function buildBombDocx(declaredBytes: number): Buffer {
  const body = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body></w:body></w:document>`;
  return storedZip([
    ["[Content_Types].xml", CONTENT_TYPES],
    ["_rels/.rels", RELS],
    ["word/document.xml", body, declaredBytes],
  ]);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A zip entry: its name, its bytes, and optionally a size it lies about. */
type ZipEntry = readonly [name: string, text: string, declaredSize?: number];

/**
 * Write a ZIP with every entry stored uncompressed. Deflate would buy nothing
 * on a fixture and would mean pulling a compression library in to build one.
 *
 * A third element overrides the *declared* uncompressed size without changing
 * the bytes, which is how the bomb fixture is built.
 */
function storedZip(entries: readonly ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const [name, text, declaredSize] of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const sum = crc32(data);
    const declared = declaredSize ?? data.length;

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0); // local file header
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    parts.push(local, data);

    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0); // central directory header
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 10); // method: stored
    cd.writeUInt32LE(sum, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(declared, 24); // uncompressed size — what the guard reads
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42); // offset of the local header
    nameBuf.copy(cd, 46);
    central.push(cd);

    offset += local.length + data.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}
