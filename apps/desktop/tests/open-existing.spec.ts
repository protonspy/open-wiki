import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AdoptOutcome } from "../src/main/settings.js";
import {
  directoryAfterChoosing,
  directoryFor,
  openExisting,
  proposedDirectory,
  type OpenExistingBridge,
} from "../src/renderer/open-existing.js";

/**
 * Opening a project the application was never told about
 * (`specs/opening-an-existing-project`, R2.1–R2.4, R3.1–R3.3).
 *
 * The launcher could only ever open what the registry already held, and the
 * note at the bottom of it said so outright: opening a project is running `ow`
 * inside its directory. For a project cloned by a teammate, restored from a
 * backup, or made before this application was on the machine, that was the only
 * way in.
 */

/** A bridge that answers what it is told to, and records what it was asked. */
function fakeBridge(
  chosen: string | null,
  outcome: AdoptOutcome = { kind: "not-a-project", directory: "" },
): OpenExistingBridge & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    chooseDirectory: () => Promise.resolve(chosen),
    openDirectory: (directory) => {
      asked.push(directory);
      return Promise.resolve(outcome);
    },
  };
}

describe("openExisting (R2.1, R2.2, R2.4)", () => {
  const dir = join("C:", "dev", "fenix");

  it("reports the project it opened", async () => {
    const ow = fakeBridge(dir, {
      kind: "adopted",
      project: { name: "fenix", path: dir, present: true },
    });
    expect(await openExisting(ow)).toEqual({ kind: "opened", name: "fenix" });
    expect(ow.asked).toEqual([dir]);
  });

  it("asks nothing further when the chooser was dismissed", async () => {
    // R3.3 at this level: Escape is the most ordinary thing anybody does with a
    // chooser, and it must not become an error banner — or a call.
    const ow = fakeBridge(null);
    expect(await openExisting(ow)).toEqual({ kind: "cancelled" });
    expect(ow.asked).toEqual([]);
  });

  it("carries a directory that is not a project into creating one there", async () => {
    // R2.4. The user already said where; asking again would make this read as a
    // refusal rather than a step.
    const ow = fakeBridge(dir, { kind: "not-a-project", directory: dir });
    expect(await openExisting(ow)).toEqual({ kind: "create-here", directory: dir });
  });
});

describe("directoryAfterChoosing (R3.2, R3.3)", () => {
  it("takes what the chooser gave", () => {
    expect(directoryAfterChoosing("", "C:\\dev\\fenix")).toBe("C:\\dev\\fenix");
    expect(directoryAfterChoosing("C:\\old", "C:\\dev\\fenix")).toBe("C:\\dev\\fenix");
  });

  it("leaves a typed path alone when the chooser was cancelled", () => {
    // Clearing it would throw away a hand-typed path in the exact moment
    // somebody went looking for the easier way to enter one.
    expect(directoryAfterChoosing("C:\\dev\\typed-by-hand", null)).toBe("C:\\dev\\typed-by-hand");
    expect(directoryAfterChoosing("", null)).toBe("");
  });
});

describe("proposedDirectory (R3.4)", () => {
  it("puts a new project under the default location, named for the project", () => {
    expect(proposedDirectory("C:\\Users\\prode\\WikiProjects", "fenix")).toBe(
      "C:\\Users\\prode\\WikiProjects\\fenix",
    );
  });

  it("reads the separator off the root rather than assuming one", () => {
    // The renderer is sandboxed and has no `path`. The root arrives from the
    // main process, so it already says which platform this is.
    expect(proposedDirectory("/home/prode/WikiProjects", "fenix")).toBe(
      "/home/prode/WikiProjects/fenix",
    );
  });

  it("does not double a separator the root already ends with", () => {
    expect(proposedDirectory("C:\\Users\\prode\\WikiProjects\\", "fenix")).toBe(
      "C:\\Users\\prode\\WikiProjects\\fenix",
    );
  });

  it("proposes nothing until there is a name", () => {
    // `WikiProjects\` alone is not a place to put a project, and offering it
    // would make the Create button look ready when it is not.
    expect(proposedDirectory("C:\\Users\\prode\\WikiProjects", "")).toBe("");
    expect(proposedDirectory("C:\\Users\\prode\\WikiProjects", "   ")).toBe("");
    expect(proposedDirectory("", "fenix")).toBe("");
  });
});

describe("directoryFor (R3.4, R3.5)", () => {
  const root = "C:\\Users\\prode\\WikiProjects";

  it("follows the name while nobody has said where", () => {
    expect(directoryFor("", { defaultRoot: root, name: "fenix", touched: false })).toBe(
      "C:\\Users\\prode\\WikiProjects\\fenix",
    );
  });

  it("stops having an opinion once the user has said where", () => {
    // R3.5. A proposal that keeps rewriting a hand-typed path is the field
    // fighting whoever is using it.
    const mine = "D:\\work\\somewhere-else";
    expect(directoryFor(mine, { defaultRoot: root, name: "fenix", touched: true })).toBe(mine);
    expect(directoryFor(mine, { defaultRoot: root, name: "renamed", touched: true })).toBe(mine);
  });
});

describe("the launcher offers both doors (R2.1, R3.1)", () => {
  // Source-level, for the same reason `index.ts` is pinned that way: there is
  // no DOM in this suite, and a button that exists in a module nothing renders
  // is a feature nobody can reach.
  const launcher = readFileSync(join(__dirname, "..", "src", "renderer", "Launcher.tsx"), "utf8");
  const firstRun = readFileSync(join(__dirname, "..", "src", "renderer", "FirstRun.tsx"), "utf8");

  it("puts Open project… beside New project", () => {
    expect(launcher).toMatch(/New project/);
    expect(launcher).toMatch(/Open project…/);
    expect(launcher).toMatch(/openExisting\(bridge\(\)\)/);
  });

  it("puts a chooser beside every directory field", () => {
    // R3.1 says wherever one is asked for, and the first run's field is the
    // first directory anybody is ever asked for.
    for (const source of [launcher, firstRun]) {
      expect(source).toMatch(/Choose…/);
      expect(source).toMatch(/directoryAfterChoosing/);
    }
  });

  it("offers it on the first run too, where the registry is empty", () => {
    // The defect this closes: `Launcher` returns `<FirstRun />` as soon as the
    // registry is empty, so the button beside **New project** was in a branch
    // that screen never reaches. An empty registry is precisely the state of a
    // machine whose projects were all made somewhere else — which is who needs
    // this most, and who could not see it.
    expect(firstRun).toMatch(/openExisting\(bridge\(\)\)/);
    expect(firstRun).toMatch(/Open a project I already have…/);
  });

  it("proposes the default location on both doors (R3.4)", () => {
    // Both, or the two screens disagree about where a project goes — which is
    // worse than neither, because whichever one you used first is the one you
    // will believe.
    for (const source of [launcher, firstRun]) {
      expect(source).toMatch(/defaultDirectory\(\)/);
      expect(source).toMatch(/directoryFor\(/);
    }
  });

  it("stops proposing once the user has said where, on both doors (R3.5)", () => {
    // The chooser and the text box both count as saying where, and so does
    // arriving from R2.4 with a directory already picked.
    for (const source of [launcher, firstRun]) {
      expect(source).toMatch(/setTouched\(true\)/);
    }
  });

  it("keeps the first run's escape hatch on the step that can use it", () => {
    // Rendered inside the `project` step, not after it: the directory a refused
    // choice carries back (R2.4) is the field on that step, and an offer that
    // appears three steps later is an offer nobody takes.
    const projectStep = firstRun.slice(
      firstRun.indexOf('step === "project"'),
      firstRun.indexOf('step === "harness"'),
    );
    expect(projectStep).toMatch(/openExistingProject/);
  });
});
