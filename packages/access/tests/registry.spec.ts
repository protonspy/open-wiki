import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectRegistry, UnknownNameError, MovedProjectError } from "../src/registry.js";

function tempDir(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("project registry", () => {
  let appData: string;
  beforeEach(() => (appData = tempDir("ow-reg-")));
  afterEach(() => rmSync(appData, { recursive: true, force: true }));

  it("registers and resolves a name to its directory", () => {
    const project = tempDir("ow-proj-");
    try {
      const reg = new ProjectRegistry(appData);
      reg.register("fenix", project);
      expect(reg.resolve("fenix")).toBe(project);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("persists across instances — the registry is on disk, not in memory", () => {
    const project = tempDir("ow-proj-");
    try {
      new ProjectRegistry(appData).register("fenix", project);
      expect(new ProjectRegistry(appData).resolve("fenix")).toBe(project);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("refuses an unknown name rather than guessing", () => {
    const reg = new ProjectRegistry(appData);
    expect(() => reg.resolve("nope")).toThrow(UnknownNameError);
  });

  it("degrades a moved directory to a refusal, never to the current directory", () => {
    const project = tempDir("ow-proj-");
    rmSync(project, { recursive: true, force: true });
    const reg = new ProjectRegistry(appData);
    reg.register("fenix", project);
    expect(() => reg.resolve("fenix")).toThrow(MovedProjectError);
    // It must not fall back to cwd or anywhere else.
    expect(existsSync(join(process.cwd(), "fenix"))).toBe(false);
  });

  it("refuses a name that is a path segment, a drive, or a traversal", () => {
    const reg = new ProjectRegistry(appData);
    for (const bad of ["a/b", "a\\b", "C:dev", ".", "..", "", "a b"]) {
      expect(() => reg.register(bad, tempDir("ow-p-")), `name "${bad}"`).toThrow();
    }
  });

  it("lists known names and removes entries", () => {
    const project = tempDir("ow-proj-");
    try {
      const reg = new ProjectRegistry(appData);
      reg.register("fenix", project);
      expect(reg.known()).toContain("fenix");
      reg.remove("fenix");
      expect(reg.known()).not.toContain("fenix");
      expect(() => reg.resolve("fenix")).toThrow(UnknownNameError);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("updating an existing name moves the project to a new path", () => {
    const a = tempDir("ow-a-");
    const b = tempDir("ow-b-");
    try {
      const reg = new ProjectRegistry(appData);
      reg.register("fenix", a);
      reg.register("fenix", b);
      expect(reg.resolve("fenix")).toBe(b);
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });
});
