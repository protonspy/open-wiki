import { describe, expect, it } from "vitest";
import {
  compressedDurationNs,
  containsInstant,
  formatInstant,
  isTimeMap,
  parseInstant,
  toCompressedNs,
  toRecordedNs,
  toWallMs,
  type TimeMap,
} from "../src/timemap.js";

const SECOND = 1_000_000_000;
const s = (n: number): number => n * SECOND;

/**
 * 20 s of capture with 5 s..10 s of shared silence removed, then a minute's
 * pause, then 10 s more. Compressed: 0..5 s, 5..15 s, 15..25 s.
 */
const map: TimeMap = {
  version: 1,
  compressedDurationNs: s(25),
  segments: [
    { compressedStartNs: 0, durationNs: s(5), recordedStartNs: 0, wallStartMs: 1_000_000 },
    { compressedStartNs: s(5), durationNs: s(10), recordedStartNs: s(10), wallStartMs: 1_010_000 },
    { compressedStartNs: s(15), durationNs: s(10), recordedStartNs: s(20), wallStartMs: 1_080_000 },
  ],
  chunks: [],
};

describe("compressedDurationNs", () => {
  it("is where the last segment ends", () => {
    expect(compressedDurationNs(map.segments)).toBe(s(25));
  });

  it("is zero when nothing was kept", () => {
    expect(compressedDurationNs([])).toBe(0);
  });
});

describe("toWallMs", () => {
  it("maps the first instant to the instant the recording began", () => {
    expect(toWallMs(map, 0)).toBe(1_000_000);
  });

  it("adds back the silence that was cut", () => {
    // Compressed 6 s is recorded 11 s, which is 11 s after the start.
    expect(toWallMs(map, s(6))).toBe(1_011_000);
  });

  it("adds back the pause as well as the silence", () => {
    // Compressed 16 s is recorded 21 s, which happened a further minute later.
    expect(toWallMs(map, s(16))).toBe(1_081_000);
  });

  it("gives the final instant to the last segment rather than to nothing", () => {
    expect(toWallMs(map, s(25))).toBe(1_090_000);
  });

  it("puts an instant exactly on a join on the later side of it", () => {
    // Half-open. Owning the boundary at both ends would put every citation
    // landing on a cut at the wrong side, by the whole length of the cut.
    expect(toWallMs(map, s(5))).toBe(1_010_000);
  });

  it("refuses an instant past the end of the recording", () => {
    expect(toWallMs(map, s(26))).toBeNull();
  });

  it("refuses an instant on an empty map", () => {
    expect(toWallMs({ ...map, segments: [], compressedDurationNs: 0 }, 0)).toBeNull();
  });

  it("gives the final instant to the last segment that recorded something", () => {
    // `crates/recorder/src/timemap.rs` uses the last *recording* segment for
    // this rule. Taking the last index instead would give the recording's
    // final instant to nobody whenever the map ends on an empty segment — the
    // two halves of one map disagreeing about their own boundary.
    const trailing: TimeMap = {
      ...map,
      segments: [
        ...map.segments,
        { compressedStartNs: s(25), durationNs: 0, recordedStartNs: s(30), wallStartMs: 1_090_000 },
      ],
    };
    expect(toWallMs(trailing, s(25))).toBe(1_090_000);
  });
});

describe("isTimeMap", () => {
  it("accepts a map this version can answer from", () => {
    expect(isTimeMap(map)).toBe(true);
  });

  it("refuses an object that merely parsed", () => {
    // `{}` casts to TimeMap as happily as a real map does, and then throws
    // inside the reader — which would take `ow check` down for a whole project
    // over one corrupt file in one recording directory.
    expect(isTimeMap({})).toBe(false);
    expect(isTimeMap(null)).toBe(false);
    expect(isTimeMap("a map")).toBe(false);
    expect(isTimeMap([])).toBe(false);
  });

  it("refuses a version it was not written to read", () => {
    expect(isTimeMap({ ...map, version: 2 })).toBe(false);
  });

  it("refuses segments that are not made of numbers", () => {
    expect(isTimeMap({ ...map, segments: [{ compressedStartNs: "0" }] })).toBe(false);
    expect(isTimeMap({ ...map, segments: [null] })).toBe(false);
  });

  it("refuses a length that is not finite", () => {
    expect(isTimeMap({ ...map, compressedDurationNs: Number.NaN })).toBe(false);
  });
});

describe("toRecordedNs", () => {
  it("maps a compressed instant to where it sits in the raw capture", () => {
    expect(toRecordedNs(map, s(6))).toBe(s(11));
  });

  it("refuses an instant past the end", () => {
    expect(toRecordedNs(map, s(99))).toBeNull();
  });
});

describe("toCompressedNs", () => {
  it("is the inverse of toRecordedNs for a kept instant", () => {
    expect(toCompressedNs(map, s(11))).toBe(s(6));
  });

  it("refuses an instant that was cut out, rather than answering with the nearest kept one", () => {
    // Recorded 7 s fell in the removed silence. It exists in no Opus file, so
    // there is no compressed instant to answer with, and the nearest one would
    // be the map lying.
    expect(toCompressedNs(map, s(7))).toBeNull();
  });
});

describe("containsInstant", () => {
  it("accepts an instant inside the recording", () => {
    expect(containsInstant(map, s(10))).toBe(true);
  });

  it("accepts the very last instant", () => {
    expect(containsInstant(map, s(25))).toBe(true);
  });

  it("refuses an instant past the end — which is what makes 5.4's check real", () => {
    expect(containsInstant(map, s(25) + 1)).toBe(false);
  });

  it("refuses a negative instant", () => {
    expect(containsInstant(map, -1)).toBe(false);
  });
});

describe("parseInstant", () => {
  it("reads mm:ss as an offset into the recording", () => {
    expect(parseInstant("14:32")).toBe(s(14 * 60 + 32));
  });

  it("reads h:mm:ss for a recording over an hour", () => {
    expect(parseInstant("1:14:32")).toBe(s(3600 + 14 * 60 + 32));
  });

  it("accepts a single-digit leading field", () => {
    expect(parseInstant("4:05")).toBe(s(4 * 60 + 5));
  });

  it("refuses anything that is not a time", () => {
    expect(parseInstant("p12")).toBeNull();
    expect(parseInstant("14")).toBeNull();
    expect(parseInstant("14:5")).toBeNull();
    expect(parseInstant("")).toBeNull();
  });

  it("refuses a field out of range rather than rolling it over", () => {
    expect(parseInstant("14:75")).toBeNull();
  });
});

describe("formatInstant", () => {
  it("writes mm:ss under an hour", () => {
    expect(formatInstant(s(14 * 60 + 32))).toBe("14:32");
  });

  it("writes h:mm:ss at an hour and beyond", () => {
    expect(formatInstant(s(3600 + 14 * 60 + 32))).toBe("1:14:32");
  });

  it("pads the seconds", () => {
    expect(formatInstant(s(65))).toBe("1:05");
  });

  it("truncates rather than rounding, so the instant never points past what it names", () => {
    expect(formatInstant(s(14 * 60 + 32) + 999_999_999)).toBe("14:32");
  });

  it("round-trips with parseInstant", () => {
    const ns = s(3661);
    expect(parseInstant(formatInstant(ns))).toBe(ns);
  });
});
