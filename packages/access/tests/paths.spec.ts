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

  it("refuses a symlink inside the project that points outside", () => {
    const outside = join(dirname(root), "secret.md");
    writeFileSync(outside, "x");
    const link = join(root, "wiki", "link.md");
    try {
      symlinkSync(outside, link);
    } catch {
      // Some Windows accounts lack the symlink privilege; that is a different
      // failure from the containment logic and should not fail this test.
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { force: true });
      return;
    }
    try {
      expect(isWithin(root, link)).toBe(false);
      expect(() => assertWithin(root, link)).toThrow(OutsideProjectError);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("refuses a Windows directory junction pointing outside, without privilege", () => {
    const outside = join(dirname(root), "junction-target");
    mkdirSync(outside, { recursive: true });
    const junction = join(root, "wiki", "junction");
    // A junction needs no privilege on Windows and is not a symlink.
    try {
      symlinkSync(outside, junction, "junction");
    } catch {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
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
