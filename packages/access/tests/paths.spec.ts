import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { resolveReal, assertWithin, isWithin, OutsideProjectError } from "../src/paths.js";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "ow-paths-"));
}

describe("resolveReal", () => {
  it("resolves an existing path to its real location", () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, "file.md"), "x");
      expect(resolveReal(join(dir, "file.md"))).toBe(join(dir, "file.md"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves a not-yet-existing target through its existing parent", () => {
    const dir = tempDir();
    try {
      const target = join(dir, "wiki", "page.md");
      expect(resolveReal(target)).toBe(join(dir, "wiki", "page.md"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("isWithin / assertWithin", () => {
  let root: string;
  beforeEach(() => {
    root = tempDir();
    mkdirSync(join(root, "wiki"), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("accepts a target inside the project", () => {
    const target = join(root, "wiki", "page.md");
    expect(isWithin(root, target)).toBe(true);
    expect(assertWithin(root, target)).toBe(join(root, "wiki", "page.md"));
  });

  it("refuses a relative path that escapes the project via ..", () => {
    const escaping = join(root, "wiki", "..", "..", "elsewhere.md");
    expect(isWithin(root, escaping)).toBe(false);
    expect(() => assertWithin(root, escaping)).toThrow(OutsideProjectError);
  });

  it("refuses an absolute path outside the project", () => {
    const outside = join(dirname(root), "outside.md");
    expect(isWithin(root, outside)).toBe(false);
    expect(() => assertWithin(root, outside)).toThrow(OutsideProjectError);
  });

  it("refuses a symlink inside the project that points outside", (ctx) => {
    const outside = join(dirname(root), "secret.md");
    writeFileSync(outside, "x");
    const link = join(root, "wiki", "link.md");
    try {
      symlinkSync(outside, link);
    } catch (err) {
      // Creating a symlink is privileged on most Windows accounts, and that is
      // a different failure from the containment logic. **Reported as a skip,
      // never as a pass**: a test that silently returns green is one nobody
      // knows stopped running, and this is the check standing between a
      // citation and a file anywhere on disk.
      rmSync(outside, { force: true });
      ctx.skip(`symlink creation unavailable: ${err instanceof Error ? err.message : err}`);
      return;
    }
    try {
      expect(isWithin(root, link)).toBe(false);
      expect(() => assertWithin(root, link)).toThrow(OutsideProjectError);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("refuses a Windows directory junction pointing outside, without privilege", (ctx) => {
    const outside = join(dirname(root), "junction-target");
    mkdirSync(outside, { recursive: true });
    const junction = join(root, "wiki", "junction");
    try {
      symlinkSync(outside, junction, "junction");
    } catch (err) {
      rmSync(outside, { recursive: true, force: true });
      // **On Windows this is a failure, not a skip.** A junction needs no
      // privilege there — that is the entire reason this case exists beside the
      // symlink one — so an account that cannot create one is telling us
      // something is wrong with the test, not with the account. Elsewhere the
      // call is emulated as a symlink and may genuinely be unavailable.
      if (process.platform === "win32") throw err;
      ctx.skip(`junction creation unavailable: ${err instanceof Error ? err.message : err}`);
      return;
    }
    try {
      const through = join(junction, "page.md");
      expect(isWithin(root, through)).toBe(false);
      expect(() => assertWithin(root, through)).toThrow(OutsideProjectError);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
