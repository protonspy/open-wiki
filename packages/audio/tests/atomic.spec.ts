import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeAtomic } from "../src/atomic.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ow-atomic-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("writeAtomic", () => {
  it("publishes the whole file", () => {
    const target = join(dir, "timeline.json");
    writeAtomic(target, "content\n");
    expect(readFileSync(target, "utf8")).toBe("content\n");
  });

  it("replaces an existing file", () => {
    const target = join(dir, "journal.json");
    writeFileSync(target, "old", "utf8");
    writeAtomic(target, "new");
    expect(readFileSync(target, "utf8")).toBe("new");
  });

  it("leaves no temporary file behind", () => {
    writeAtomic(join(dir, "a.json"), "x");
    expect(readdirSync(dir)).toEqual(["a.json"]);
  });

  it("does not write through a predictable temporary name", () => {
    // `${target}.tmp` was guessable, and the default write flag follows a
    // symlink and truncates what it finds — so anything able to plant an entry
    // there got an arbitrary file overwritten with content it partly
    // controlled. `raw/` arrives with a clone, and the window between
    // recording and finishing is hours by design.
    const target = join(dir, "timeline.json");
    const planted = join(dir, "timeline.json.tmp");
    writeFileSync(planted, "PLANTED", "utf8");
    writeAtomic(target, "ours");
    expect(readFileSync(planted, "utf8")).toBe("PLANTED");
    expect(readFileSync(target, "utf8")).toBe("ours");
  });

  it("leaves the previous file intact when the write fails", () => {
    const target = join(dir, "journal.json");
    writeFileSync(target, "the previous hour of transcription", "utf8");
    const doomed = {
      toJSON: () => {
        throw new Error("nope");
      },
    };
    expect(() => writeAtomic(target, JSON.stringify(doomed))).toThrow();
    expect(readFileSync(target, "utf8")).toBe("the previous hour of transcription");
    expect(readdirSync(dir)).toEqual(["journal.json"]);
  });

  it("refuses to write into a directory that is not there", () => {
    expect(() => writeAtomic(join(dir, "gone", "a.json"), "x")).toThrow();
  });
});
