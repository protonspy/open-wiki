import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  registerSource,
  readManifest,
  listSources,
  sourceExists,
  TakenIdError,
  type SourceManifest,
} from "../src/sources/manifest.js";
import { EmptyNameError } from "../src/sources/id.js";

function tempProject() {
  const root = mkdtempSync(join(tmpdir(), "ow-src-"));
  mkdirSync(join(root, "raw"), { recursive: true });
  return root;
}

describe("registerSource (3.1)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("creates raw/<id>/ with the preserved original and a manifest, and returns the id", () => {
    const { id } = registerSource(root, {
      name: "Arquitetura Fenix.pdf",
      kind: "file",
      content: Buffer.from("%PDF-1.4 fake"),
    });
    expect(id).toBe("arquitetura-fenix.pdf");
    const dir = join(root, "raw", id);
    // The original is preserved as source.<ext> (adr:0011).
    expect(readFileSync(join(dir, "source.pdf"), "utf8")).toBe("%PDF-1.4 fake");
    // The manifest carries the frozen id, the readable title, the kind, the original name.
    const manifest: SourceManifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(manifest.id).toBe("arquitetura-fenix.pdf");
    expect(manifest.title).toBe("Arquitetura Fenix.pdf");
    expect(manifest.kind).toBe("file");
    expect(manifest.original).toBe("Arquitetura Fenix.pdf");
  });

  it("preserves the original extension when there is one, and a name without one", () => {
    const a = registerSource(root, { name: "notes.txt", kind: "file", content: Buffer.from("hi") });
    expect(existsSync(join(root, "raw", a.id, "source.txt"))).toBe(true);
    const b = registerSource(root, { name: "README", kind: "file", content: Buffer.from("x") });
    expect(b.id).toBe("readme");
    expect(existsSync(join(root, "raw", b.id, "source"))).toBe(true);
  });

  it("refuses a name that derives to an empty id", () => {
    expect(() =>
      registerSource(root, { name: "!!!", kind: "file", content: Buffer.from("x") }),
    ).toThrow(EmptyNameError);
  });

  it("refuses to register an id that is already taken — the freeze in adr:0011", () => {
    registerSource(root, {
      name: "Arquitetura Fenix.pdf",
      kind: "file",
      content: Buffer.from("a"),
    });
    expect(() =>
      registerSource(root, {
        name: "Arquitetura Fenix.pdf",
        kind: "file",
        content: Buffer.from("b"),
      }),
    ).toThrow(TakenIdError);
  });

  it("lets two genuinely different names coexist", () => {
    registerSource(root, {
      name: "Arquitetura Fenix.pdf",
      kind: "file",
      content: Buffer.from("a"),
    });
    const { id } = registerSource(root, {
      name: "Fenix weekly 2026-07-31.txt",
      kind: "file",
      content: Buffer.from("b"),
    });
    expect(id).toBe("fenix-weekly-2026-07-31.txt");
    expect(sourceExists(root, "arquitetura-fenix.pdf")).toBe(true);
    expect(sourceExists(root, "fenix-weekly-2026-07-31.txt")).toBe(true);
  });
});

describe("readManifest / listSources / sourceExists (3.1 read side)", () => {
  let root: string;
  beforeEach(() => {
    root = tempProject();
    registerSource(root, {
      name: "Arquitetura Fenix.pdf",
      kind: "file",
      content: Buffer.from("a"),
    });
    registerSource(root, { name: "Notes.txt", kind: "file", content: Buffer.from("b") });
    mkdirSync(join(root, "raw", "_inbox"), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("reads the manifest back by id", () => {
    const m = readManifest(root, "arquitetura-fenix.pdf");
    expect(m.id).toBe("arquitetura-fenix.pdf");
    expect(m.kind).toBe("file");
  });

  it("lists source ids and excludes the _inbox doorway", () => {
    const ids = listSources(root).sort();
    expect(ids).toEqual(["arquitetura-fenix.pdf", "notes.txt"]);
  });

  it("sourceExists is false for an unknown id", () => {
    expect(sourceExists(root, "nope")).toBe(false);
  });

  it("listSources ignores a stray file dropped in raw/ that is not a source dir", () => {
    writeFileSync(join(root, "raw", "loose.txt"), "junk");
    const ids = listSources(root);
    expect(ids).not.toContain("loose.txt");
  });
});
