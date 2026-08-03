import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AdoptOutcome } from "../src/main/settings.js";
import {
  directoryAfterChoosing,
  openExisting,
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
