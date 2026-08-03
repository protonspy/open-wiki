import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readManifest,
  parseManifest,
  listSources,
  sourceExists,
  TakenIdError,
  InvalidManifestError,
  type SourceManifest,
} from "../src/sources/manifest.js";
import { registerSource } from "../src/sources/register.js";
import { EmptyNameError } from "../src/sources/id.js";
import { OutsideProjectError } from "../src/paths.js";

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

  it("an id that escapes raw/ names no source — a citation is not a path", () => {
    // The id arrives out of a page's prose: `src://../../elsewhere#p1` parses
    // as the id `../../elsewhere`. Answering "yes, that exists" would make the
    // gate an existence oracle for any manifest.json on the machine, and would
    // let a page cite something that is not a source at all.
    writeFileSync(
      join(root, "manifest.json"),
      JSON.stringify({ id: "x", title: "outside raw" }),
      "utf8",
    );
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ".claude", "manifest.json"), JSON.stringify({ id: "y" }), "utf8");

    for (const id of ["..", "../.claude", "../../..", join("..", "..")]) {
      expect(sourceExists(root, id), id).toBe(false);
      expect(() => readManifest(root, id), id).toThrow(OutsideProjectError);
    }
  });

  it("listSources ignores a stray file dropped in raw/ that is not a source dir", () => {
    writeFileSync(join(root, "raw", "loose.txt"), "junk");
    const ids = listSources(root);
    expect(ids).not.toContain("loose.txt");
  });
});

describe("parseManifest — a manifest arrives with a clone, so its shape is checked", () => {
  it("accepts a well-formed manifest", () => {
    expect(
      parseManifest("a.pdf", '{"id":"a.pdf","title":"A","kind":"file","original":"a.pdf"}'),
    ).toEqual({ id: "a.pdf", title: "A", kind: "file", original: "a.pdf" });
  });

  it("refuses a title that is not a string, rather than passing it on", () => {
    // This is the one that mattered: `JSON.parse` returns `any`, the cast
    // checked nothing, and an object title reached the screen as a React child
    // and blanked the whole window — taking every page citing that source.
    expect(() => parseManifest("a.pdf", '{"title":{},"kind":"file"}')).toThrow(
      InvalidManifestError,
    );
    expect(() => parseManifest("a.pdf", '{"kind":"file"}')).toThrow(InvalidManifestError);
  });

  it("refuses a kind that is neither of the two", () => {
    expect(() => parseManifest("a.pdf", '{"title":"A","kind":"video"}')).toThrow(
      InvalidManifestError,
    );
  });

  it("refuses what does not parse, and what parses to the wrong thing", () => {
    for (const text of ["not json", "[]", "null", '"a string"']) {
      expect(() => parseManifest("a.pdf", text), text).toThrow(InvalidManifestError);
    }
  });

  it("takes the id from the directory and never from the file", () => {
    // `adr:0011` freezes an id as the directory name, so a manifest claiming a
    // different one is claiming something it does not get to decide.
    expect(parseManifest("a.pdf", '{"id":"../elsewhere","title":"A","kind":"file"}').id) //
      .toBe("a.pdf");
  });

  it("defaults a missing original rather than refusing — a recording has none", () => {
    expect(parseManifest("weekly", '{"title":"W","kind":"recording"}').original).toBe("");
  });
});

describe("parseManifest — what the agent learned about a source (plan 8.1)", () => {
  it("reads a description", () => {
    // `fnd348r34nr483r.txt` is a real filename that says nothing, and `adr:0011`
    // freezes the id from it permanently. The agent is the only party that can
    // say what the file is about, because saying so requires having read it.
    const m = parseManifest(
      "fnd348r34nr483r.txt",
      '{"title":"A","kind":"file","description":"The Q3 incident timeline."}',
    );
    expect(m.description).toBe("The Q3 incident timeline.");
  });

  it("leaves it absent when nobody has said anything", () => {
    expect(parseManifest("a.pdf", '{"title":"A","kind":"file"}').description).toBeUndefined();
  });

  it("degrades a description that is not a string rather than refusing the source", () => {
    for (const value of ["{}", "42", "true", "[]", "null"]) {
      const m = parseManifest("a.pdf", `{"title":"A","kind":"file","description":${value}}`);
      expect(m.description, value).toBeUndefined();
      expect(m.title, value).toBe("A");
    }
  });

  it("keeps a long description a clone brought, rather than truncating somebody's data", () => {
    // The bound is a rule about what *this* application writes — see
    // `updateManifest` — not a licence to silently discard what it finds.
    const long = "x".repeat(5000);
    expect(
      parseManifest("a.pdf", JSON.stringify({ title: "A", kind: "file", description: long }))
        .description,
    ).toBe(long);
  });
});

describe("parseManifest — the one declared fact (source-status R1)", () => {
  it("reads the declaration, which is the date it was made", () => {
    const m = parseManifest("a.pdf", '{"title":"A","kind":"file","processed":"2026-08-02"}');
    expect(m.processed).toBe("2026-08-02");
  });

  it("reports a manifest carrying no declaration as unprocessed", () => {
    // Absent *is* unprocessed, so there is no state where the declaration and
    // its date disagree, and every manifest written before this change is a
    // valid manifest of an unprocessed source.
    expect(parseManifest("a.pdf", '{"title":"A","kind":"file"}').processed).toBeUndefined();
  });

  it("degrades a declaration that is not a date, rather than refusing the manifest", () => {
    // The direction is chosen. An unreadable declaration that reads as
    // *unprocessed* costs a re-read; one that reads as *processed* drops the
    // source out of the queue and out of the uncited check at once, which is a
    // source silently never read again.
    for (const value of [
      "true",
      '"yesterday"',
      '"2026-13-40"',
      "{}",
      '"2026-08-02T10:00:00Z"',
      "1",
    ]) {
      const m = parseManifest("a.pdf", `{"title":"A","kind":"file","processed":${value}}`);
      expect(m.processed, value).toBeUndefined();
      expect(m.title, value).toBe("A");
    }
  });
});
