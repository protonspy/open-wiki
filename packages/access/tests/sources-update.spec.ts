import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateManifest, withdrawProcessed } from "../src/sources/update.js";
import { readManifest, InvalidManifestError, MissingSourceError } from "../src/sources/manifest.js";
import { registerSource } from "../src/sources/register.js";
import { OutsideProjectError } from "../src/paths.js";

/**
 * `updateManifest` is the **one** thing in the product that writes a
 * `manifest.json` after registration (source-status R2.1). Before it, the only
 * mutator was `retitleSource` inside the Electron main process — so the CLI
 * could not correct a title, and a status verb built beside it would have been
 * the second manifest mutator that 9.1's one-implementation rule exists to
 * prevent.
 */
function tempProject() {
  const root = mkdtempSync(join(tmpdir(), "ow-upd-"));
  mkdirSync(join(root, "raw"), { recursive: true });
  registerSource(root, {
    name: "Arquitetura Fenix.pdf",
    kind: "file",
    content: Buffer.from("%PDF-1.4"),
  });
  return root;
}

const ID = "arquitetura-fenix.pdf";

describe("updateManifest — declaring a source processed (R2.2)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("writes the declaration as the date it was made", () => {
    updateManifest(root, ID, { processed: "2026-08-02" });
    expect(readManifest(root, ID).processed).toBe("2026-08-02");
  });

  it("leaves every other field exactly as it was", () => {
    const before = readManifest(root, ID);
    updateManifest(root, ID, { processed: "2026-08-02" });
    const after = readManifest(root, ID);
    expect(after.id).toBe(before.id);
    expect(after.title).toBe(before.title);
    expect(after.kind).toBe(before.kind);
    expect(after.original).toBe(before.original);
  });

  it("refuses a declaration that is not a date, rather than writing one that reads as absent", () => {
    // `parseManifest` degrades a malformed declaration to unprocessed, so a
    // bad date written here would come back as "nobody ever marked it" — the
    // write reporting success and the record saying nothing.
    for (const bad of ["yesterday", "2026-13-40", "2026-08-02T10:00:00Z", ""]) {
      expect(() => updateManifest(root, ID, { processed: bad }), bad).toThrow(/YYYY-MM-DD/);
    }
    expect(readManifest(root, ID).processed).toBeUndefined();
  });
});

describe("updateManifest — withdrawing it (R2.3)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("removes the declaration, leaving no field behind to disagree with itself", () => {
    updateManifest(root, ID, { processed: "2026-08-02" });
    updateManifest(root, ID, { processed: null });
    expect(readManifest(root, ID).processed).toBeUndefined();
    const raw = JSON.parse(readFileSync(join(root, "raw", ID, "manifest.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect("processed" in raw).toBe(false);
  });

  it("withdrawing what was never declared is not an error", () => {
    expect(() => updateManifest(root, ID, { processed: null })).not.toThrow();
    expect(readManifest(root, ID).processed).toBeUndefined();
  });
});

describe("updateManifest — correcting the title (R2.1, plan 6.7)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("corrects the readable title without moving the directory or changing the id", () => {
    updateManifest(root, ID, { title: "Arquitetura do Fenix — v2" });
    const m = readManifest(root, ID);
    expect(m.title).toBe("Arquitetura do Fenix — v2");
    expect(m.id).toBe(ID);
    expect(readdirSync(join(root, "raw"))).toContain(ID);
  });

  it("changes a title and a declaration in one write", () => {
    updateManifest(root, ID, { title: "Q3 incident timeline", processed: "2026-08-02" });
    const m = readManifest(root, ID);
    expect(m.title).toBe("Q3 incident timeline");
    expect(m.processed).toBe("2026-08-02");
  });
});

describe("updateManifest — what it refuses (R2.4)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("refuses an id that names no source, naming the id", () => {
    expect(() => updateManifest(root, "no-such-source", { processed: "2026-08-02" })).toThrow(
      MissingSourceError,
    );
    expect(() => updateManifest(root, "no-such-source", { processed: "2026-08-02" })).toThrow(
      /no-such-source/,
    );
  });

  it("refuses an id that escapes raw/ — an id is not a path", () => {
    // The id reaches a mark verb from an agent's own loop. `../../elsewhere`
    // parses as an id, and this is a *write*: the read side answering "that is
    // not a source" is not enough.
    writeFileSync(
      join(root, "manifest.json"),
      JSON.stringify({ id: "x", title: "outside raw", kind: "file" }),
      "utf8",
    );
    for (const id of ["..", "../..", join("..", "..")]) {
      expect(() => updateManifest(root, id, { title: "x" }), id).toThrow(OutsideProjectError);
    }
    expect(JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).title).toBe("outside raw");
  });

  it("refuses to rewrite a manifest it could not read, rather than replacing it", () => {
    // The manifest arrives with a clone. Overwriting one this module does not
    // understand would destroy whatever it held to write two fields into it.
    const file = join(root, "raw", ID, "manifest.json");
    writeFileSync(file, "{ not json at all", "utf8");
    expect(() => updateManifest(root, ID, { processed: "2026-08-02" })).toThrow(
      InvalidManifestError,
    );
    expect(readFileSync(file, "utf8")).toBe("{ not json at all");
  });

  it("leaves no temporary file behind in the source directory", () => {
    updateManifest(root, ID, { processed: "2026-08-02" });
    expect(readdirSync(join(root, "raw", ID)).sort()).toEqual(["manifest.json", "source.pdf"]);
  });
});

describe("updateManifest keeps what it does not understand", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("preserves fields this module does not model", () => {
    // A manifest arrives with a clone, so "every other field" is not limited to
    // the five this module knows. `parseManifest` narrows to those five, so
    // merging a change onto its result would delete the rest — silently, on a
    // write that returns success, and now on *every* text.md write. Plan task
    // 8.1 adds a description to this same file; a lossy merge would have eaten
    // it the first time anybody corrected a title.
    const file = join(root, "raw", ID, "manifest.json");
    writeFileSync(
      file,
      JSON.stringify({
        id: ID,
        title: "Arquitetura Fenix.pdf",
        kind: "file",
        original: "Arquitetura Fenix.pdf",
        description: "The Q3 architecture review, and what it decided about the cutover.",
        "superseded-by": "arquitetura-fenix-v2.pdf",
      }),
      "utf8",
    );

    updateManifest(root, ID, { processed: "2026-08-02" });

    const after = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(after["description"]).toBe(
      "The Q3 architecture review, and what it decided about the cutover.",
    );
    expect(after["superseded-by"]).toBe("arquitetura-fenix-v2.pdf");
    expect(after["processed"]).toBe("2026-08-02");
  });

  it("scrubs a declaration that is not a date, rather than carrying it through", () => {
    // The passthrough keeps what this module does not model, and `processed` is
    // not that. Writing `"yesterday"` back out of a title correction would
    // preserve a value this same function refuses to accept as an argument —
    // and would leave the file asserting something every reader ignores.
    const file = join(root, "raw", ID, "manifest.json");
    writeFileSync(
      file,
      JSON.stringify({
        id: ID,
        title: "Arquitetura Fenix.pdf",
        kind: "file",
        original: "Arquitetura Fenix.pdf",
        processed: "yesterday",
        description: "kept, because nothing here models it",
      }),
      "utf8",
    );

    updateManifest(root, ID, { title: "Q3 incident timeline" });

    const after = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    expect("processed" in after).toBe(false);
    expect(after["description"]).toBe("kept, because nothing here models it");
  });

  it("does not carry a prototype-pollution key back out into the file", () => {
    // Keeping unmodelled fields must not extend to re-legitimising these. This
    // application is not vulnerable — JSON.parse makes `__proto__` an ordinary
    // own property and spread copies it without invoking the setter — but it
    // used to scrub them on first write simply by narrowing, and manifest.json
    // is documented as read by tools this application did not write.
    const file = join(root, "raw", ID, "manifest.json");
    writeFileSync(
      file,
      `{"id":"${ID}","title":"A","kind":"file","original":"a",` +
        `"__proto__":{"polluted":true},"constructor":{"x":1},"prototype":{"y":2},"keep":"me"}`,
      "utf8",
    );

    updateManifest(root, ID, { processed: "2026-08-02" });

    const written = readFileSync(file, "utf8");
    expect(written).not.toContain("__proto__");
    expect(written).not.toContain("polluted");
    expect(written).not.toContain("prototype");
    expect((JSON.parse(written) as Record<string, unknown>)["keep"]).toBe("me");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("still takes the id from the directory, never from the file", () => {
    // Preserving unknown fields must not become preserving a *known* one the
    // file does not get to decide (`adr:0011`).
    const file = join(root, "raw", ID, "manifest.json");
    writeFileSync(
      file,
      JSON.stringify({ id: "../elsewhere", title: "A", kind: "file", original: "a" }),
      "utf8",
    );
    updateManifest(root, ID, { processed: "2026-08-02" });
    expect((JSON.parse(readFileSync(file, "utf8")) as { id: string }).id).toBe(ID);
  });
});

describe("withdrawProcessed — the one withdrawal both text.md doors use (R3.1)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("removes a standing declaration", () => {
    updateManifest(root, ID, { processed: "2026-08-02" });
    withdrawProcessed(root, ID);
    expect(readManifest(root, ID).processed).toBeUndefined();
  });

  it("writes nothing when there is nothing to withdraw", () => {
    const file = join(root, "raw", ID, "manifest.json");
    const before = readFileSync(file, "utf8");
    withdrawProcessed(root, ID);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("is silent for a source with no readable manifest, or none at all", () => {
    // Both callers run over directories mid-assembly — registration, and the
    // audio pipeline. A text.md that failed to land because of a malformed
    // manifest is a worse outcome than a stale declaration.
    expect(() => withdrawProcessed(root, "no-such-source")).not.toThrow();
    writeFileSync(join(root, "raw", ID, "manifest.json"), "{ not json", "utf8");
    expect(() => withdrawProcessed(root, ID)).not.toThrow();
  });
});
