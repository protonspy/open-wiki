import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { duplicateSourceIds, listSourceRefs, sourceDirOf } from "../src/sources/locate.js";
import { readManifest, sourceExists } from "../src/sources/manifest.js";
import { sourceState } from "../src/sources/state.js";
import { updateManifest } from "../src/sources/update.js";

/**
 * **A source is its id wherever it sits under `raw/`** — plan task 8.3, and the
 * same decision `adr:0016-a-page-is-its-slug-wherever-it-sits` already made for
 * `wiki/`, applied a second time rather than reasoned about afresh.
 *
 * A folder is organisation, the id is the name, and uniqueness of the id is the
 * one rule the model needs. What it costs is the enumeration: reading one level
 * of `raw/` made every filed source invisible, exactly as reading one level of
 * `wiki/` once made `wiki/topics/` invisible to the index, the checks and MCP —
 * and nothing failed loudly either time.
 */

let root: string;

/** A source directory: what makes one is a `manifest.json` inside it. */
function source(rel: string, id: string, extra: Record<string, unknown> = {}): string {
  const dir = join(root, "raw", ...rel.split("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ id, title: id, kind: "file", original: id, ...extra }),
    "utf8",
  );
  return dir;
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "ow-locate-")));
  mkdirSync(join(root, "raw", "_inbox"), { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const ids = (): string[] =>
  listSourceRefs(root)
    .map((r) => r.id)
    .sort();

describe("listSourceRefs — finding sources at any depth", () => {
  it("finds one at the top level, the way every source has been written so far", () => {
    source("notes.md", "notes.md");
    expect(ids()).toEqual(["notes.md"]);
  });

  it("finds one filed into a folder", () => {
    // The whole point: a folder is organisation. Reading one level of `raw/`
    // made this invisible to the listing, the checks, the CLI and MCP.
    source("2026/fenix-weekly-2026-07-31", "fenix-weekly-2026-07-31");
    expect(ids()).toEqual(["fenix-weekly-2026-07-31"]);
  });

  it("finds one nested several folders deep", () => {
    source("archive/2026/q3/incident.pdf", "incident.pdf");
    expect(ids()).toEqual(["incident.pdf"]);
  });

  it("finds them all, wherever they sit", () => {
    source("notes.md", "notes.md");
    source("2026/weekly", "weekly");
    source("archive/2025/old.pdf", "old.pdf");
    expect(ids()).toEqual(["notes.md", "old.pdf", "weekly"]);
  });

  it("takes the id from the directory name, not from the manifest", () => {
    // `adr:0011` freezes the id as the directory name. A manifest claiming
    // something else is claiming what it does not get to decide, and after 8.3
    // that claim could otherwise be a *path* claim too.
    source("2026/weekly", "something-else-entirely");
    expect(ids()).toEqual(["weekly"]);
  });

  it("never returns the inbox, which is a doorway", () => {
    writeFileSync(join(root, "raw", "_inbox", "dropped.pdf"), "x", "utf8");
    source("notes.md", "notes.md");
    expect(ids()).toEqual(["notes.md"]);
  });

  it("ignores an organising folder that holds no source", () => {
    mkdirSync(join(root, "raw", "2026", "empty"), { recursive: true });
    expect(ids()).toEqual([]);
  });

  it("finds a source at the depth limit, and stops looking past it", () => {
    // `MAX_DEPTH` is a bound on how far organising folders may nest, and an
    // untested one reproduces this task's own failure in miniature: a source
    // past the cutoff goes silently invisible again, at depth 9 instead of
    // depth 1. Pinning both sides makes the cutoff a decision rather than an
    // accident.
    // Counted rather than assumed: `MAX_DEPTH = 8` is the depth of the last
    // *directory the walk enters*, so a source may sit under nine organising
    // folders and not ten. Writing this test off my own first guess had it a
    // level out, which is the argument for the test.
    source("a/b/c/d/e/f/g/h/deep", "deep"); // nine folders: found
    source("a/b/c/d/e/f/g/h/i/deeper", "deeper"); // ten: past the bound
    expect(ids()).toEqual(["deep"]);
  });

  it("returns an empty list when raw/ is not there at all", () => {
    rmSync(join(root, "raw"), { recursive: true, force: true });
    expect(listSourceRefs(root)).toEqual([]);
  });
});

describe("listSourceRefs — a source's own contents are not more sources", () => {
  it("does not descend into a source it has found", () => {
    // **The rule group 6 makes non-optional.** An unpacked repository lives
    // under `raw/<id>/`, and a repository routinely contains a `manifest.json`
    // of its own — npm, a VS Code extension, a browser extension. Descending
    // would enumerate somebody else's file as a source of this project.
    const dir = source("acme-api-zip", "acme-api-zip");
    mkdirSync(join(dir, "contents", "packages", "core"), { recursive: true });
    writeFileSync(
      join(dir, "contents", "packages", "core", "manifest.json"),
      JSON.stringify({ id: "core", title: "not ours", kind: "file" }),
      "utf8",
    );

    expect(ids()).toEqual(["acme-api-zip"]);
  });

  it("does not descend even when the nested directory looks exactly like a source", () => {
    const dir = source("report.pdf", "report.pdf");
    mkdirSync(join(dir, "attachments", "inner.pdf"), { recursive: true });
    writeFileSync(
      join(dir, "attachments", "inner.pdf", "manifest.json"),
      JSON.stringify({ id: "inner.pdf", title: "inner", kind: "file", original: "inner.pdf" }),
      "utf8",
    );
    expect(ids()).toEqual(["report.pdf"]);
  });
});

describe("listSourceRefs — links are not followed", () => {
  it("does not follow a directory link out of raw/", () => {
    // The same escape `paths.ts` exists to stop, and the same one `listPages`
    // refuses: a link inside `raw/` pointing elsewhere would enumerate that
    // elsewhere as this project's sources.
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "ow-locate-out-")));
    try {
      mkdirSync(join(outside, "borrowed"), { recursive: true });
      writeFileSync(
        join(outside, "borrowed", "manifest.json"),
        JSON.stringify({ id: "borrowed", title: "b", kind: "file" }),
        "utf8",
      );
      try {
        symlinkSync(outside, join(root, "raw", "elsewhere"), "junction");
      } catch {
        return; // no privilege on this machine; the rule still holds
      }
      expect(ids()).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("sourceDirOf — addressing by id", () => {
  it("resolves an id to where the source actually sits", () => {
    const dir = source("2026/weekly", "weekly");
    expect(sourceDirOf(root, "weekly")).toBe(dir);
  });

  it("is undefined for an id no source carries", () => {
    source("notes.md", "notes.md");
    expect(sourceDirOf(root, "ghost")).toBeUndefined();
  });

  it("is undefined for an id shaped like a path", () => {
    // An id reaches this out of a page's prose: `src://../../elsewhere#p1`
    // parses as an id. It names no source, and answering otherwise would make
    // this an existence oracle for anything on disk.
    source("notes.md", "notes.md");
    for (const id of ["..", "../..", "raw/notes.md", "2026/weekly"]) {
      expect(sourceDirOf(root, id), id).toBeUndefined();
    }
  });
});

describe("moving a source between folders changes nothing (8.4)", () => {
  // The property 8.3 exists to give, and the one worth a test that would notice
  // if it were lost. `src://<id>` never encoded a location, so refiling is a
  // `mv` and not a migration.
  function move(from: string, to: string): void {
    const target = join(root, "raw", ...to.split("/"));
    mkdirSync(join(target, ".."), { recursive: true });
    renameSync(join(root, "raw", ...from.split("/")), target);
  }

  it("keeps the id, the manifest, the state and everything under it", () => {
    const dir = source("weekly", "weekly", { processed: "2026-08-02", description: "the Q3 one" });
    writeFileSync(join(dir, "text.md"), "# Weekly\n", "utf8");

    const before = sourceState(root, "weekly");
    move("weekly", "2026/q3/weekly");
    const after = sourceState(root, "weekly");

    expect(after.id).toBe(before.id);
    expect(after.title).toBe(before.title);
    expect(after.stage).toBe(before.stage);
    expect(after.processed).toBe("2026-08-02");
    expect(after.description).toBe("the Q3 one");
    expect(after.textReady).toBe(true);
  });

  it("keeps the citation resolving, which is what a frozen id is for", () => {
    source("arch.pdf", "arch.pdf");
    expect(sourceExists(root, "arch.pdf")).toBe(true);
    move("arch.pdf", "documents/architecture/arch.pdf");
    expect(sourceExists(root, "arch.pdf")).toBe(true);
    expect(readManifest(root, "arch.pdf").id).toBe("arch.pdf");
  });

  it("lets a filed source still be written to, at its new home and not a new one", () => {
    // The failure worth naming: writing to `raw/<id>/manifest.json` for a filed
    // source would *create* a second directory carrying that id — the check
    // would then report a duplicate this application had manufactured itself.
    source("notes.md", "notes.md");
    move("notes.md", "2026/notes.md");

    updateManifest(root, "notes.md", { description: "written after the move" });

    expect(readManifest(root, "notes.md").description).toBe("written after the move");
    expect(existsSync(join(root, "raw", "notes.md"))).toBe(false);
    expect(duplicateSourceIds(root)).toEqual([]);
  });
});

describe("duplicateSourceIds — the one rule the model needs", () => {
  it("reports two directories claiming one id, rather than picking one", () => {
    // `src://weekly#p1` cannot mean two sources. Resolving it by silently
    // choosing is the answer `adr:0016` refused for pages, for the same reason.
    source("2026/weekly", "weekly");
    source("archive/weekly", "weekly");

    const duplicates = duplicateSourceIds(root);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]!.id).toBe("weekly");
    expect(duplicates[0]!.dirs).toHaveLength(2);
  });

  it("says nothing when every id is unique", () => {
    source("2026/weekly", "weekly");
    source("archive/older", "older");
    expect(duplicateSourceIds(root)).toEqual([]);
  });

  it("resolves a duplicated id deterministically, so a report is stable", () => {
    // It still has to answer *something* — the finding is what makes the
    // ambiguity visible, and a resolver that varied between runs would make the
    // report vary too.
    source("archive/weekly", "weekly");
    source("2026/weekly", "weekly");
    expect(sourceDirOf(root, "weekly")).toBe(sourceDirOf(root, "weekly"));
    expect(sourceDirOf(root, "weekly")).toBe(join(root, "raw", "2026", "weekly"));
  });
});
