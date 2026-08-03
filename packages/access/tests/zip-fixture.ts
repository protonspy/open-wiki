import { crc32, deflateRawSync } from "node:zlib";

/**
 * A ZIP writer for the archives an attacker sends and no library will build.
 *
 * `yazl` — the writer this project already adopted — validates the path of
 * every entry it is given, so it cannot produce `../../escape.txt`, and it
 * exposes nothing for the unix mode that marks an entry a symbolic link. Both
 * are exactly what group 6 has to refuse, so the fixtures are written here at
 * the byte level instead.
 *
 * Stored, never deflated: the point is the headers, and a fixture whose
 * compression could itself fail is a fixture that fails for the wrong reason.
 * `zipBomb` below is the one place a ratio matters, and it says so.
 */

export interface ZipEntry {
  /** The name exactly as it goes into the archive, separators and all. */
  path: string;
  content: Buffer | string;
  /**
   * The unix mode for the entry, which lands in the high sixteen bits of
   * `externalFileAttributes`. `0o120777` is a symbolic link — the value a real
   * `zip -y` writes, and the one nothing in yauzl looks at.
   */
  mode?: number;
  /** Compressed size to declare, when it should differ from the real one. */
  declaredCompressedSize?: number;
  /** Uncompressed size to declare, when it should lie. */
  declaredUncompressedSize?: number;
  /**
   * Deflate this entry instead of storing it. Only the ratio tests need it —
   * everywhere else the headers are the subject and compression would only add
   * a way for a fixture to fail for the wrong reason.
   */
  deflate?: boolean;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** Made by unix, version 2.0 — what puts the mode in the high bits. */
const VERSION_MADE_BY = (3 << 8) | 20;

/** A stored-entry zip carrying exactly these entries, in this order. */
export function buildZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const raw = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, "utf8");
    const data = entry.deflate ? deflateRawSync(raw) : raw;
    const method = entry.deflate ? 8 : 0;
    const sum = crc32(raw);
    const csize = entry.declaredCompressedSize ?? data.byteLength;
    const usize = entry.declaredUncompressedSize ?? raw.byteLength;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date — 1980-01-01, a valid one
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(csize, 18);
    local.writeUInt32LE(usize, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28); // extra field length
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(VERSION_MADE_BY, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(csize, 20);
    central.writeUInt32LE(usize, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.byteLength + name.byteLength + data.byteLength;
  }

  const centralBlock = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBlock.byteLength, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBlock, eocd]);
}

/**
 * An archive whose entries expand to `totalBytes` from almost nothing.
 *
 * Deflated rather than stored, because the ratio *is* the test: a run of one
 * repeated byte compresses about a thousand to one, which is what turns a
 * small upload into a full disk.
 */
export function zipBomb(totalBytes: number, entries = 1): Buffer {
  const each = Buffer.alloc(Math.ceil(totalBytes / entries), 0x41);
  return buildZip(
    Array.from({ length: entries }, (_, i) => ({
      path: `bomb-${i}.txt`,
      content: each,
      deflate: true,
    })),
  );
}
