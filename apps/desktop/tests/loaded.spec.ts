import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { failed, LOADING, messageOf, ready, valueOf } from "../src/renderer/loaded.js";

/**
 * Loading, failed and ready, told apart (plan desktop-ui 8.3).
 *
 * The defect this closes is not cosmetic. The checks pane caught a failed
 * `findings()` into an empty list and rendered *Nothing to fix.* — a wiki
 * nobody checked, reported as a wiki with nothing wrong. The side panel did the
 * same with a page's sources: a failed read omitted the section, which reads as
 * "this page rests on nothing".
 */

describe("Loaded (8.3)", () => {
  it("starts as loading, which is not the same as empty", () => {
    expect(LOADING.state).toBe("loading");
    expect(valueOf(LOADING)).toBeUndefined();
  });

  it("carries a value once there is one, including an empty one", () => {
    // An *empty* answer is a real answer, and the point of the type is that it
    // is not confusable with the other two.
    expect(valueOf(ready([]))).toEqual([]);
    expect(valueOf(ready(["x"]))).toEqual(["x"]);
  });

  it("has no value when it failed", () => {
    expect(valueOf(failed(new Error("nope")))).toBeUndefined();
  });

  it("keeps why it failed, because a pane has to say", () => {
    expect(failed(new Error("EPERM"))).toMatchObject({ state: "failed", why: "EPERM" });
  });
});

describe("messageOf (8.3)", () => {
  it("takes an Error's message", () => {
    expect(messageOf(new Error("no such page"))).toBe("no such page");
  });

  it("stringifies whatever else an IPC rejection carried", () => {
    // A rejection can carry anything, and "undefined" on screen is still more
    // than a pane that silently shows nothing.
    expect(messageOf("plain string")).toBe("plain string");
    expect(messageOf(undefined)).toBe("undefined");
  });

  it("says something rather than nothing for an empty reason", () => {
    expect(messageOf("")).toBe("something went wrong");
  });
});

describe("the panes that fetch, as they ship (8.3)", () => {
  const read = (file: string): string =>
    readFileSync(fileURLToPath(new URL(`../src/renderer/${file}`, import.meta.url)), "utf8");

  it("no longer turns a failed checks run into an empty list", () => {
    // The regression guard: `setFindings([])` in a `catch` is the exact line
    // that reported an unchecked wiki as a clean one.
    for (const file of ["ChecksPane.tsx", "Side.tsx"]) {
      expect(read(file)).not.toMatch(/catch[\s\S]{0,80}\[\]\)/);
    }
  });

  it("says why, in the pane where it happened", () => {
    expect(read("ChecksPane.tsx")).toContain("The checks could not run");
    expect(read("Side.tsx")).toContain("Could not read this page");
  });
});
