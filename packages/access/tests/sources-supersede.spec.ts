import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { supersedeSource, updateManifest } from "../src/sources/update.js";
import { parseManifest, readManifest, MissingSourceError } from "../src/sources/manifest.js";
import { sourceState } from "../src/sources/state.js";
import { registerSource } from "../src/sources/register.js";
import { OutsideProjectError } from "../src/paths.js";

/**
 * Plan task 8.5 — supersession for a source, in the vocabulary task 5.2 gave a
 * page: `status`, `superseded-by`, and the date it happened.
 *
 * The failure this is test-first for is silence. A correction is a new source
 * that supersedes the old, and every citation into the old one keeps resolving
 * — at something that now says it was replaced, and by what. If the record does
 * not land, the citation resolves to the old bytes and reads perfectly while
 * pointing at evidence somebody already withdrew.
 */

const OLD = "arquitetura-fenix.pdf";
const NEW = "arquitetura-fenix-v2.pdf";

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "ow-sup-"));
  mkdirSync(join(root, "raw"), { recursive: true });
  registerSource(root, {
    name: "Arquitetura Fenix.pdf",
    kind: "file",
    content: Buffer.from("%PDF-1.4"),
  });
  registerSource(root, {
    name: "Arquitetura Fenix v2.pdf",
    kind: "file",
    content: Buffer.from("%PDF-1.4 corrected"),
  });
  return root;
}

function rawManifest(
  root: string,
  id: string,
  dir = join(root, "raw", id),
): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Record<string, unknown>;
}

describe("supersedeSource — the record on the source that was replaced", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("writes the status, the replacement and the date, in the page's own vocabulary", () => {
    supersedeSource(root, OLD, NEW, "2026-08-03");
    const raw = rawManifest(root, OLD);
    expect(raw["status"]).toBe("superseded");
    expect(raw["superseded-by"]).toBe(NEW);
    expect(raw["superseded"]).toBe("2026-08-03");
  });

  it("reads back as one fact rather than three that can disagree", () => {
    supersedeSource(root, OLD, NEW, "2026-08-03");
    const m = readManifest(root, OLD);
    expect(m.status).toBe("superseded");
    expect(m["superseded-by"]).toBe(NEW);
    expect(m.superseded).toBe("2026-08-03");
  });

  it("touches nothing else the manifest holds", () => {
    updateManifest(root, OLD, { processed: "2026-08-01", description: "The Q3 review." });
    const before = readManifest(root, OLD);
    supersedeSource(root, OLD, NEW, "2026-08-03");
    const after = readManifest(root, OLD);
    expect(after.title).toBe(before.title);
    expect(after.kind).toBe(before.kind);
    expect(after.original).toBe(before.original);
    // A processed declaration survives being superseded: somebody did read this
    // source, and replacing it does not un-read it.
    expect(after.processed).toBe("2026-08-01");
    expect(after.description).toBe("The Q3 review.");
  });

  it("leaves the replacement's own manifest untouched — the record lives on the one replaced", () => {
    const before = readFileSync(join(root, "raw", NEW, "manifest.json"), "utf8");
    supersedeSource(root, OLD, NEW, "2026-08-03");
    expect(readFileSync(join(root, "raw", NEW, "manifest.json"), "utf8")).toBe(before);
  });

  it("re-superseding replaces the pointer rather than accumulating a second one", () => {
    registerSource(root, {
      name: "Arquitetura Fenix v3.pdf",
      kind: "file",
      content: Buffer.from("%PDF"),
    });
    supersedeSource(root, OLD, NEW, "2026-08-03");
    supersedeSource(root, OLD, "arquitetura-fenix-v3.pdf", "2026-08-04");
    const m = readManifest(root, OLD);
    expect(m["superseded-by"]).toBe("arquitetura-fenix-v3.pdf");
    expect(m.superseded).toBe("2026-08-04");
  });

  it("works for a source filed into a folder, on both sides of the pointer", () => {
    // Task 8.3: a source is its id wherever it sits. A supersession that wrote
    // to `raw/<id>/` would create a second directory carrying that id — the one
    // failure the addressing model must report rather than manufacture.
    mkdirSync(join(root, "raw", "2026", "q3"), { recursive: true });
    renameSync(join(root, "raw", OLD), join(root, "raw", "2026", "q3", OLD));
    renameSync(join(root, "raw", NEW), join(root, "raw", "2026", NEW));

    supersedeSource(root, OLD, NEW, "2026-08-03");

    const raw = rawManifest(root, OLD, join(root, "raw", "2026", "q3", OLD));
    expect(raw["superseded-by"]).toBe(NEW);
    expect(readManifest(root, OLD).superseded).toBe("2026-08-03");
  });
});

describe("supersedeSource — what it refuses", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("refuses a replacement that names no source, because nothing else would ever report it", () => {
    // The deliberate divergence from `supersedePage`, which records a pointer
    // whose target may not be written yet. A source's replacement is bytes that
    // have already been uploaded — superseding *is* pointing at them — and no
    // check walks a manifest for a dangling pointer, so a wrong id here would
    // sit there resolving to nothing for good.
    expect(() => supersedeSource(root, OLD, "no-such-source", "2026-08-03")).toThrow(
      /no-such-source/,
    );
    expect(readManifest(root, OLD).status).toBeUndefined();
  });

  it("refuses a source superseding itself", () => {
    expect(() => supersedeSource(root, OLD, OLD, "2026-08-03")).toThrow(/itself/i);
    expect(readManifest(root, OLD).status).toBeUndefined();
  });

  it("refuses a replacement shaped like a path rather than an id, saying so", () => {
    // Its own message rather than the far vaguer "names no source": a refusal
    // an agent cannot act on becomes an attempt it repeats verbatim (9.13).
    for (const bad of ["../elsewhere", "2026/q3", "..", ".", "  "]) {
      expect(() => supersedeSource(root, OLD, bad, "2026-08-03"), bad).toThrow(
        /is not a source id/,
      );
    }
    expect(readManifest(root, OLD).status).toBeUndefined();
  });

  it("refuses a date that is not the day it happened", () => {
    for (const bad of ["yesterday", "2026-13-40", "2026-08-03T10:00:00Z", ""]) {
      expect(() => supersedeSource(root, OLD, NEW, bad), bad).toThrow(/YYYY-MM-DD/);
    }
    expect(readManifest(root, OLD).status).toBeUndefined();
  });

  it("refuses an id that names no source, and one that escapes raw/", () => {
    expect(() => supersedeSource(root, "no-such-source", NEW, "2026-08-03")).toThrow(
      MissingSourceError,
    );
    writeFileSync(
      join(root, "manifest.json"),
      JSON.stringify({ id: "x", title: "outside raw", kind: "file" }),
      "utf8",
    );
    expect(() => supersedeSource(root, "..", NEW, "2026-08-03")).toThrow(OutsideProjectError);
    expect(
      (JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as { title: string }).title,
    ).toBe("outside raw");
  });
});

describe("withdrawing a supersession", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("removes all three keys together, so none is left to assert on its own", () => {
    supersedeSource(root, OLD, NEW, "2026-08-03");
    updateManifest(root, OLD, { superseded: null });
    const raw = rawManifest(root, OLD);
    expect("status" in raw).toBe(false);
    expect("superseded-by" in raw).toBe(false);
    expect("superseded" in raw).toBe(false);
  });

  it("withdrawing what was never recorded is not an error", () => {
    expect(() => updateManifest(root, OLD, { superseded: null })).not.toThrow();
    expect(readManifest(root, OLD).status).toBeUndefined();
  });
});

describe("parseManifest — reading a supersession this application did not write", () => {
  it("reads a pointer with no status as superseded, never as silently active", () => {
    // A manifest arrives with a `git clone`. The safe direction is the loud one:
    // reading a half-written supersession as active is exactly the silent
    // resolution to withdrawn evidence that this task exists to prevent.
    const m = parseManifest(
      OLD,
      JSON.stringify({ title: "A", kind: "file", "superseded-by": NEW }),
    );
    expect(m.status).toBe("superseded");
    expect(m["superseded-by"]).toBe(NEW);
  });

  it("reads a status with no pointer as superseded by nothing it can name", () => {
    const m = parseManifest(
      OLD,
      JSON.stringify({ title: "A", kind: "file", status: "superseded" }),
    );
    expect(m.status).toBe("superseded");
    expect(m["superseded-by"]).toBe("");
  });

  it("degrades a status it does not recognise to active, rather than refusing the manifest", () => {
    // The direction is chosen: an unknown word is not a claim of supersession,
    // and refusing the manifest would hide the source from the listing, the
    // checks and MCP over a field nobody in this project wrote.
    for (const status of ["draft", "active", "", "42"]) {
      const m = parseManifest(OLD, JSON.stringify({ title: "A", kind: "file", status }));
      expect(m.status, status).toBeUndefined();
    }
  });

  it("drops a date that is not one, the way it drops a malformed declaration", () => {
    const m = parseManifest(
      OLD,
      JSON.stringify({ title: "A", kind: "file", "superseded-by": NEW, superseded: "last week" }),
    );
    expect(m.status).toBe("superseded");
    expect(m.superseded).toBeUndefined();
  });
});

describe("what reads it", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("sourceState carries the supersession, so a reader needs no second read", () => {
    supersedeSource(root, OLD, NEW, "2026-08-03");
    const state = sourceState(root, OLD);
    expect(state.superseded).toEqual({ by: NEW, date: "2026-08-03" });
  });

  it("a source nobody replaced says nothing about supersession", () => {
    expect(sourceState(root, OLD).superseded).toBeUndefined();
  });

  it("bounds a pointer a clone brought, the way it bounds a title", () => {
    // The view is where every free-text field of a manifest is cut, because
    // `parseManifest` keeps whatever length it finds — truncating on the read
    // path would destroy somebody's data on a file nobody asked to write.
    writeFileSync(
      join(root, "raw", OLD, "manifest.json"),
      JSON.stringify({
        title: "t",
        kind: "file",
        status: "superseded",
        "superseded-by": "s".repeat(9000),
      }),
      "utf8",
    );
    const by = sourceState(root, OLD).superseded!.by;
    expect(by.length).toBeLessThan(9000);
    expect(by).toMatch(/9000 characters, truncated/);
  });
});
