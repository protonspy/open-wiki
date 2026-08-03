import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  unpackArchive,
  CONTENTS,
  UNPACKING,
  isUnpacking,
} from "../src/sources/archive.js";
import { registerSource } from "../src/sources/register.js";
import { ingestSource } from "../src/sources/upload.js";
import { buildZip, zipBomb } from "./zip-fixture.js";

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "ow-attack-"));
  mkdirSync(join(root, "raw"), { recursive: true });
  return root;
}
function stored(root: string, bytes: Buffer, name = "acme.zip"): string {
  return registerSource(root, { name, kind: "file", content: bytes }).id;
}
function contentsOf(root: string, id: string): string[] {
  const dir = join(root, "raw", id, CONTENTS);
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string, prefix: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
      if (e.isDirectory()) walk(join(d, e.name), rel);
      else out.push(rel);
    }
  };
  walk(dir, "");
  return out.sort();
}

describe("ATTACK: windows reserved device names", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("entry named nul.txt / con / prn.md — does it become a phantom landed file?", async () => {
    const id = stored(
      root,
      buildZip([
        { path: "nul.txt", content: "reserved device name payload\n" },
        { path: "con", content: "x" },
        { path: "docs/prn.md", content: "y" },
        { path: "ok.txt", content: "fine" },
      ]),
    );
    const result = await unpackArchive(root, id);
    console.log("RESULT", JSON.stringify(result, null, 2));
    console.log("CONTENTS ON DISK:", contentsOf(root, id));
    for (const f of contentsOf(root, id)) {
      const p = join(root, "raw", id, CONTENTS, ...f.split("/"));
      console.log(f, "size=", statSync(p).size);
    }
  });
});

describe("ATTACK: ExpansionError interleaved with per-entry ENOTDIR error", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("does not get swallowed as a per-entry refusal, and discards everything", async () => {
    const each = Buffer.alloc(50_000, 0x41);
    const id = stored(
      root,
      buildZip([
        { path: "src", content: "a file, not a dir\n" },
        { path: "src/x.txt", content: "cannot land (ENOTDIR)\n" },
        { path: "ok1.txt", content: "landed fine" },
        { path: "bomb.bin", content: each, deflate: true },
      ]),
    );
    let threw: unknown = undefined;
    try {
      await unpackArchive(root, id, { maxBytes: 10_000, maxRatio: 1_000_000 });
    } catch (err) {
      threw = err;
    }
    console.log("THREW:", threw, threw instanceof Error ? threw.constructor.name : typeof threw);
    console.log("CONTENTS AFTER:", contentsOf(root, id));
    console.log("MARKER PRESENT:", isUnpacking(join(root, "raw", id)));
  });
});

describe("ATTACK: partial file left behind on non-Expansion write failure", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("very long path component beyond MAX_PATH", async () => {
    const longName = "a".repeat(2000) + ".txt";
    const id = stored(
      root,
      buildZip([
        { path: longName, content: "payload that might partially write\n" },
        { path: "ok.txt", content: "fine" },
      ]),
    );
    const result = await unpackArchive(root, id);
    console.log("RESULT", JSON.stringify(result, null, 2));
    console.log("CONTENTS:", contentsOf(root, id));
  });
});
