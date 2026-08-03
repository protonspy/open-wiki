import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { defaultExportPath as defaultDestination, humanBytes, isWithin } from "@open-wiki/access";
import { parseExportArgs, runExport } from "../src/commands/export.js";
import { main } from "../src/main.js";

/** `ow export` — `specs/wiki-export`, task 2.1. */

const DATE = "2026-08-02";

let root: string;
let out: string[];
let err: string[];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "ow-exp-cli-")));
  mkdirSync(join(root, "wiki"), { recursive: true });
  mkdirSync(join(root, "raw", "notes.md"), { recursive: true });
  writeFileSync(join(root, "wiki", "index.md"), "# Index\n", "utf8");
  writeFileSync(join(root, "raw", "notes.md", "manifest.json"), "{}", "utf8");

  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation((c) => (out.push(String(c)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((c) => (err.push(String(c)), true));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

const stdout = () => out.join("");
const stderr = () => err.join("");

describe("parseExportArgs", () => {
  it("includes the sources and writes an archive by default", () => {
    expect(parseExportArgs([])).toEqual({ sources: true, survey: false });
  });

  it("reads --out, --no-sources and --survey", () => {
    expect(parseExportArgs(["--out", "C:\\tmp\\a.zip", "--no-sources", "--survey"])).toEqual({
      out: "C:\\tmp\\a.zip",
      sources: false,
      survey: true,
    });
  });
});

describe("defaultDestination", () => {
  it("lands beside the project, not inside it", () => {
    // Inside is refused (R3.1), and a default that is refused is a default
    // nobody can use.
    //
    // Asserted with `relative` rather than `startsWith`, and the difference is
    // the whole reason `paths.ts` resolves before comparing: the sibling file
    // is `<project>-wiki-<date>.zip`, which *does* begin with the project's own
    // path as a string while sitting outside it. A prefix check calls that
    // "inside" and is wrong.
    const dest = defaultDestination(root, DATE);
    const rel = relative(root, dest);
    expect(rel.startsWith("..")).toBe(true);
    expect(dirname(dest)).toBe(dirname(root));
    expect(basename(dest)).toBe(`${basename(root)}-wiki-${DATE}.zip`);
  });

  it("is a destination the export actually accepts", () => {
    // The property the previous test is really about, checked against the
    // thing that decides it rather than against a path comparison of my own.
    const dest = defaultDestination(root, DATE);
    expect(isWithin(root, dest)).toBe(false);
  });
});

describe("humanBytes", () => {
  it("reads as a size a person recognises", () => {
    expect(humanBytes(0)).toBe("0 B");
    expect(humanBytes(512)).toBe("512 B");
    expect(humanBytes(1024)).toBe("1.0 KB");
    expect(humanBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("runExport", () => {
  it("writes the archive and says what went into it and where", async () => {
    const dest = join(tmpdir(), `ow-exp-${Date.now()}.zip`);
    try {
      const result = await runExport(root, { sources: true, survey: false, out: dest }, DATE);
      expect(result.ok).toBe(true);
      expect(result.ok && result.stdout).toContain("2 files");
      expect(result.ok && result.stdout).toContain("wiki and sources");
      expect(existsSync(dest)).toBe(true);
    } finally {
      rmSync(dest, { force: true });
    }
  });

  it("surveys without writing, and without needing a destination", async () => {
    // The cheap question must not cost the expensive answer: the desktop asks
    // this before it has anywhere to put the file.
    const result = await runExport(root, { sources: true, survey: true }, DATE);
    expect(result.ok && result.stdout).toContain("would export 2 files");
    expect(readdirSync(tmpdir()).some((f) => f.endsWith(".zip") && f.includes("wiki"))).toBe(false);
  });

  it("says `wiki only` when the sources are left out", async () => {
    const result = await runExport(root, { sources: false, survey: true }, DATE);
    expect(result.ok && result.stdout).toContain("1 files");
    expect(result.ok && result.stdout).toContain("wiki only");
  });

  it("returns the refusal as a sentence rather than throwing", async () => {
    const inside = join(root, "wiki", "self.zip");
    const result = await runExport(root, { sources: true, survey: false, out: inside }, DATE);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("inside the project");
    expect(existsSync(inside)).toBe(false);
  });
});

describe("ow export — through the dispatch", () => {
  it("exits 0 and prints where it landed", async () => {
    const dest = join(tmpdir(), `ow-exp-main-${Date.now()}.zip`);
    try {
      expect(await main(["export", "--out", dest], root)).toBe(0);
      expect(stdout()).toContain("exported");
      expect(existsSync(dest)).toBe(true);
    } finally {
      rmSync(dest, { force: true });
    }
  });

  it("exits 2 with a sentence on stderr when the destination is refused", async () => {
    expect(await main(["export", "--out", join(root, "a.zip")], root)).toBe(2);
    expect(stderr()).toContain("inside the project");
    expect(stderr()).not.toContain("Error:");
  });

  it("is named in the usage text", async () => {
    await main([], root);
    expect(stdout()).toContain("ow export");
  });
});
