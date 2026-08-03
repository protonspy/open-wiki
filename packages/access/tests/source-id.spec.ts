import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveId, isDerivedId, isIdTaken, slugify, EmptyNameError } from "../src/sources/id.js";

function tempProject() {
  const root = mkdtempSync(join(tmpdir(), "ow-id-"));
  mkdirSync(join(root, "raw"), { recursive: true });
  return root;
}

describe("isDerivedId — the shape, for anywhere an id would be read as syntax", () => {
  it("accepts everything deriveId and slugify can produce", () => {
    for (const name of [
      "Arquitetura Fenix.pdf",
      "Fenix weekly 2026-07-31",
      "São Paulo — relatório.DOCX",
      "README",
      "a.b.c.txt",
      "Report.PDF",
    ]) {
      expect(isDerivedId(deriveId(name)), name).toBe(true);
    }
    expect(isDerivedId(slugify("Vendor call re. arch"))).toBe(true);
  });

  it("rejects a directory name that could not have been derived", () => {
    // `listSources` reads directory names verbatim, and a directory under
    // `raw/` arrives with a clone, is created by an agent's own tools, or is
    // unpacked from an archive. Every one of these is a legal directory name
    // on Windows, which is the platform the MVP ships for.
    for (const hostile of [
      "a;rm -rf .",
      "b`curl evil`",
      "c$(id)",
      "d e",
      "x&calc",
      "É.pdf",
      "UPPER",
      "-leading",
      "trailing-",
      "double--dash",
      "",
      "..",
      "a/b",
      "a\\b",
      "a\nb",
    ]) {
      expect(isDerivedId(hostile), JSON.stringify(hostile)).toBe(false);
    }
  });
});

describe("deriveId (3.6)", () => {
  it("slugs the base, keeps the extension, collapses non-[a-z0-9] to one dash", () => {
    // adr:0011: a file source keeps its format in the id — the directory is
    // raw/arquitetura-fenix.pdf/ and the citation is src://arquitetura-fenix.pdf#p12.
    expect(deriveId("Arquitetura Fenix.pdf")).toBe("arquitetura-fenix.pdf");
    // A recording name carries a date, not an extension: .31 is digits, so the
    // whole name is slugged and nothing is reattached.
    expect(deriveId("Fenix weekly 2026-07-31")).toBe("fenix-weekly-2026-07-31");
  });

  it("folds accents to ASCII, keeping the extension", () => {
    expect(deriveId("São Paulo.txt")).toBe("sao-paulo.txt");
    expect(deriveId("João — relatório.docx")).toBe("joao-relatorio.docx");
  });

  it("collapses runs of separators and strips leading/trailing dashes", () => {
    expect(deriveId("  --a  b--  ")).toBe("a-b");
    // a name that is only separators derives to empty, which is an error —
    // see the next test. There is no non-throwing path to an empty id.
  });

  it("throws on a name that derives to empty", () => {
    expect(() => deriveId("!!!")).toThrow(EmptyNameError);
    expect(() => deriveId("   ")).toThrow(EmptyNameError);
    expect(() => deriveId("---")).toThrow(EmptyNameError);
  });
});

describe("isIdTaken (3.6)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("is false when the id is free, true when a source dir already exists", () => {
    expect(isIdTaken(root, "fenix-weekly")).toBe(false);
    mkdirSync(join(root, "raw", "fenix-weekly"));
    expect(isIdTaken(root, "fenix-weekly")).toBe(true);
  });

  it("ignores the _inbox doorway", () => {
    mkdirSync(join(root, "raw", "_inbox"));
    expect(isIdTaken(root, "_inbox")).toBe(false);
  });
});
