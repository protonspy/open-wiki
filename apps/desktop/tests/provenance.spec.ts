import { formatInstant, parseInstant } from "@open-wiki/audio/timemap";
import { describe, expect, it } from "vitest";
import type { SourceLocation } from "../src/main/sources.js";
import { citationOf, playheadPercent, transportLabel } from "../src/renderer/provenance.js";

/**
 * The provenance viewer (plan desktop-ui 5.4) — **(TDD)**.
 *
 * Test-first because this is the time map's last mile. 8.6 seeks to an instant;
 * an off-by-one here points a citation at the wrong moment *while reading
 * perfectly*, which is the failure family the plan reserves TDD for: the code
 * runs, the tests pass, and the damage shows up somewhere else or much later.
 *
 * The instant format has one authority — `parseInstant` and `formatInstant` in
 * `@open-wiki/audio/timemap` — and these assert against it rather than against
 * a second regex written here, because two definitions of a time format
 * disagree at exactly the values that matter.
 */

const audio = (seconds: number): SourceLocation => ({
  kind: "audio",
  file: "C:/p/raw/weekly/mic.opus",
  seconds,
  wallStartMs: null,
});

describe("citationOf (5.4)", () => {
  it("writes a recording's citation at the instant the viewer is at", () => {
    expect(citationOf("fenix-weekly-2026-07-31", audio(872))).toBe(
      "rec://fenix-weekly-2026-07-31#14:32",
    );
  });

  it("writes a document's citation at the page it is open at", () => {
    expect(citationOf("arquitetura-fenix.pdf", { kind: "document", file: "x", page: 12 })).toBe(
      "src://arquitetura-fenix.pdf#p12",
    );
  });

  it("writes an hour-long recording's instant with its hour", () => {
    expect(citationOf("weekly", audio(3852))).toBe("rec://weekly#1:04:12");
  });

  it("round-trips through the store's own reader", () => {
    // The whole point of the task. What is copied has to parse back to the
    // instant it was copied at — `store/provenance.ts` validates a citation
    // through `parseInstant`, so a citation this pane produces and the checks
    // refuse is a citation the reader pasted in good faith.
    for (const seconds of [0, 59, 60, 61, 599, 872, 3599, 3600, 3852]) {
      const citation = citationOf("weekly", audio(seconds));
      const fragment = citation?.split("#")[1] ?? "";
      expect(parseInstant(fragment)).toBe(Math.floor(seconds) * 1_000_000_000);
    }
  });

  it("truncates rather than rounds, like every other anchor in this product", () => {
    // `formatInstant` is explicit about it: an anchor that rounded up would
    // name a moment slightly *after* the passage it is the provenance for, and
    // a reader following it lands past the sentence.
    expect(citationOf("weekly", audio(59.9))).toBe("rec://weekly#0:59");
    expect(citationOf("weekly", audio(872.999))).toBe(`rec://weekly#${formatInstant(872e9)}`);
  });

  it("has no citation to offer for a source it could not open", () => {
    // Copying `rec://weekly#` would be a citation that resolves to nothing,
    // which is the one thing 7.3 exists to report.
    expect(citationOf("weekly", { kind: "missing", reason: "no such source" })).toBeNull();
  });
});

describe("playheadPercent (5.4)", () => {
  it("puts the playhead where the instant is in the recording", () => {
    expect(playheadPercent(872, 3484)).toBeCloseTo(25.03, 1);
    expect(playheadPercent(0, 3484)).toBe(0);
  });

  it("never runs past either end of the bar", () => {
    // A citation past the end is refused upstream, but a recording whose map
    // disagrees with its file by a second is a case 4.6 explicitly tolerates —
    // and a playhead at 103% is drawn outside the element it belongs to.
    expect(playheadPercent(4000, 3484)).toBe(100);
    expect(playheadPercent(-5, 3484)).toBe(0);
  });

  it("sits at the start when nobody knows how long the recording is", () => {
    // The duration comes from the audio element's metadata, which is not there
    // until it loads. Guessing a position would move the playhead the moment
    // the real duration arrived.
    expect(playheadPercent(872, null)).toBe(0);
    expect(playheadPercent(872, 0)).toBe(0);
  });
});

describe("transportLabel (5.4)", () => {
  it("says where you are and how long the recording is", () => {
    expect(transportLabel(872, 3484)).toBe("14:32 of 58:04");
  });

  it("says where you are alone, until the length is known", () => {
    expect(transportLabel(872, null)).toBe("14:32");
  });
});
