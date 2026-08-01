import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baseId, recordingId } from "../src/sources/recording-id.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ow-recid-"));
  mkdirSync(join(root, "raw"), { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function existing(id: string): void {
  mkdirSync(join(root, "raw", id), { recursive: true });
}

/** 31 July 2026, 14:02:11 local. */
const at = new Date(2026, 6, 31, 14, 2, 11);

describe("baseId (4.16)", () => {
  it("is the occasion plus the day it happened", () => {
    expect(baseId({ occasion: "Fenix weekly", at })).toBe("fenix-weekly-2026-07-31");
  });

  it("carries the date even for the first of its name", () => {
    // The date is part of the shape, not a disambiguator that shows up on a
    // clash. Recurring meetings are the normal case, and a scheme where the
    // first has no date produces ids whose meaning depends on creation order.
    expect(baseId({ occasion: "Standup", at })).toBe("standup-2026-07-31");
  });

  it("slugs the way every other id is slugged", () => {
    expect(baseId({ occasion: "Reunião de Análise", at })).toBe("reuniao-de-analise-2026-07-31");
  });

  it("does not mistake the end of an occasion for a file extension", () => {
    // `deriveId` keeps a trailing `.pdf` because a file's format is part of its
    // identity. An occasion has no format.
    expect(baseId({ occasion: "Vendor call re. arch", at })).toBe("vendor-call-re-arch-2026-07-31");
  });

  it("falls back to the timestamp when nobody named it", () => {
    // Capture must never be blocked on a text field: a recording that started
    // is worth more than a naming rule.
    expect(baseId({ occasion: "", at })).toBe("recording-2026-07-31-140211");
  });

  it("falls back when the name derives to nothing at all", () => {
    expect(baseId({ occasion: "!!! ---", at })).toBe("recording-2026-07-31-140211");
  });

  it("pads the day and the time", () => {
    const early = new Date(2026, 0, 5, 9, 3, 4);
    expect(baseId({ occasion: "", at: early })).toBe("recording-2026-01-05-090304");
  });
});

describe("recordingId (4.16)", () => {
  it("is the base id when nothing has taken it", () => {
    expect(recordingId(root, { occasion: "Fenix weekly", at })).toBe("fenix-weekly-2026-07-31");
  });

  it("takes -2 for a second the same day", () => {
    // The opposite of the rule for a file, which is refused so the user
    // renames it. Two `fenix-weekly` on one Tuesday is a normal Tuesday, and
    // there is nothing to rename.
    existing("fenix-weekly-2026-07-31");
    expect(recordingId(root, { occasion: "Fenix weekly", at })).toBe("fenix-weekly-2026-07-31-2");
  });

  it("counts on past the second", () => {
    existing("fenix-weekly-2026-07-31");
    existing("fenix-weekly-2026-07-31-2");
    existing("fenix-weekly-2026-07-31-3");
    expect(recordingId(root, { occasion: "Fenix weekly", at })).toBe("fenix-weekly-2026-07-31-4");
  });

  it("does not collide with the same occasion on another day", () => {
    existing("fenix-weekly-2026-07-31");
    const nextWeek = new Date(2026, 7, 7, 14, 0, 0);
    expect(recordingId(root, { occasion: "Fenix weekly", at: nextWeek })).toBe(
      "fenix-weekly-2026-08-07",
    );
  });

  it("still produces an id when a hundred share the day, rather than refusing", () => {
    // Absurd, and capture still must not be blocked.
    existing("standup-2026-07-31");
    for (let n = 2; n <= 99; n++) existing(`standup-2026-07-31-${n}`);
    expect(recordingId(root, { occasion: "Standup", at })).toBe("standup-2026-07-31-140211");
  });

  it("suffixes an unnamed recording too, if the second landed in the same second", () => {
    existing("recording-2026-07-31-140211");
    expect(recordingId(root, { occasion: "", at })).toBe("recording-2026-07-31-140211-2");
  });
});
