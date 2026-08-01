import { describe, expect, it } from "vitest";
import {
  keepsFrom,
  planCompression,
  sharedSilence,
  type RecorderSegment,
} from "../src/compress.js";

const SECOND = 1_000_000_000;
const s = (n: number): number => n * SECOND;

/** One uninterrupted capture starting at an arbitrary wall instant. */
function unpaused(durationNs: number, wallStartMs = 1_000_000): RecorderSegment[] {
  return [{ recordedStartNs: 0, durationNs, wallStartMs }];
}

describe("sharedSilence", () => {
  it("cuts only where every track is silent", () => {
    // The load-bearing rule of this whole group. Cutting each track on its own
    // silence would give mic and system different compressed clocks, and
    // `rec://<id>#14:32` would have to say which track it meant.
    const mic = [{ startNs: s(0), endNs: s(10) }];
    const system = [{ startNs: s(5), endNs: s(20) }];
    expect(sharedSilence([mic, system], s(0.8))).toEqual([{ startNs: s(5), endNs: s(10) }]);
  });

  it("cuts nothing when one track was speaking throughout", () => {
    const mic = [{ startNs: s(0), endNs: s(60) }];
    expect(sharedSilence([mic, []], s(0.8))).toEqual([]);
  });

  it("drops an overlap shorter than the minimum, however silent both tracks were", () => {
    const mic = [{ startNs: s(0), endNs: s(10) }];
    const system = [{ startNs: s(9.5), endNs: s(20) }];
    expect(sharedSilence([mic, system], s(0.8))).toEqual([]);
  });

  it("keeps every qualifying overlap, in order", () => {
    const mic = [
      { startNs: s(0), endNs: s(10) },
      { startNs: s(30), endNs: s(40) },
    ];
    const system = [
      { startNs: s(5), endNs: s(12) },
      { startNs: s(20), endNs: s(35) },
    ];
    expect(sharedSilence([mic, system], s(0.8))).toEqual([
      { startNs: s(5), endNs: s(10) },
      { startNs: s(30), endNs: s(35) },
    ]);
  });

  it("cuts nothing when there are no tracks to agree", () => {
    expect(sharedSilence([], s(0.8))).toEqual([]);
  });
});

describe("keepsFrom", () => {
  it("is the complement of the cuts inside the recording", () => {
    expect(keepsFrom([{ startNs: s(5), endNs: s(10) }], s(20))).toEqual([
      { startNs: s(0), endNs: s(5) },
      { startNs: s(10), endNs: s(20) },
    ]);
  });

  it("keeps everything when nothing was cut", () => {
    expect(keepsFrom([], s(20))).toEqual([{ startNs: s(0), endNs: s(20) }]);
  });

  it("drops a leading cut without leaving an empty keep in front of it", () => {
    expect(keepsFrom([{ startNs: s(0), endNs: s(5) }], s(20))).toEqual([
      { startNs: s(5), endNs: s(20) },
    ]);
  });

  it("drops a trailing cut without leaving an empty keep after it", () => {
    expect(keepsFrom([{ startNs: s(15), endNs: s(20) }], s(20))).toEqual([
      { startNs: s(0), endNs: s(15) },
    ]);
  });

  it("refuses to cut the recording down to nothing", () => {
    // A recording that is silent end to end is still a recording, and an Opus
    // of zero length is a provenance file that opens at no instant.
    expect(keepsFrom([{ startNs: s(0), endNs: s(20) }], s(20))).toEqual([
      { startNs: s(0), endNs: s(20) },
    ]);
  });
});

describe("planCompression", () => {
  it("maps a compressed instant past a cut back to the right wall instant", () => {
    // 20 s captured from wall 1_000_000 ms, with 5 s..10 s cut. Compressed 6 s
    // is recorded 11 s, which happened 11 s after the start.
    const plan = planCompression({
      perTrackSilence: [[{ startNs: s(5), endNs: s(10) }], [{ startNs: s(5), endNs: s(10) }]],
      recordedDurationNs: s(20),
      recorderSegments: unpaused(s(20)),
    });
    expect(plan.segments).toEqual([
      { compressedStartNs: 0, durationNs: s(5), recordedStartNs: 0, wallStartMs: 1_000_000 },
      {
        compressedStartNs: s(5),
        durationNs: s(10),
        recordedStartNs: s(10),
        wallStartMs: 1_010_000,
      },
    ]);
  });

  it("splits a kept stretch at a pause, because wall time jumps there and recorded time does not", () => {
    // The arithmetic that goes quietly wrong. Two segments of 10 s with a
    // 60 s pause between them: recorded time runs 0..20 s unbroken, wall time
    // skips a minute. A keep spanning the join has two different wall slopes
    // and cannot be one segment.
    const plan = planCompression({
      perTrackSilence: [[], []],
      recordedDurationNs: s(20),
      recorderSegments: [
        { recordedStartNs: 0, durationNs: s(10), wallStartMs: 1_000_000 },
        { recordedStartNs: s(10), durationNs: s(10), wallStartMs: 1_070_000 },
      ],
    });
    expect(plan.segments).toEqual([
      { compressedStartNs: 0, durationNs: s(10), recordedStartNs: 0, wallStartMs: 1_000_000 },
      {
        compressedStartNs: s(10),
        durationNs: s(10),
        recordedStartNs: s(10),
        wallStartMs: 1_070_000,
      },
    ]);
  });

  it("gives both tracks the same cut list", () => {
    const plan = planCompression({
      perTrackSilence: [[{ startNs: s(5), endNs: s(10) }], [{ startNs: s(5), endNs: s(10) }]],
      recordedDurationNs: s(20),
      recorderSegments: unpaused(s(20)),
    });
    expect(plan.keeps).toEqual([
      { startNs: 0, endNs: s(5) },
      { startNs: s(10), endNs: s(20) },
    ]);
  });

  it("leaves a recording with no silence and no pause as one segment", () => {
    const plan = planCompression({
      perTrackSilence: [[], []],
      recordedDurationNs: s(20),
      recorderSegments: unpaused(s(20)),
    });
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0]).toEqual({
      compressedStartNs: 0,
      durationNs: s(20),
      recordedStartNs: 0,
      wallStartMs: 1_000_000,
    });
  });

  it("ignores a recorder segment that captured nothing", () => {
    const plan = planCompression({
      perTrackSilence: [[], []],
      recordedDurationNs: s(10),
      recorderSegments: [
        { recordedStartNs: 0, durationNs: 0, wallStartMs: 1_000_000 },
        { recordedStartNs: 0, durationNs: s(10), wallStartMs: 1_000_500 },
      ],
    });
    expect(plan.segments).toEqual([
      { compressedStartNs: 0, durationNs: s(10), recordedStartNs: 0, wallStartMs: 1_000_500 },
    ]);
  });

  it("produces a compressed length equal to what it kept", () => {
    const plan = planCompression({
      perTrackSilence: [[{ startNs: s(5), endNs: s(10) }], [{ startNs: s(5), endNs: s(10) }]],
      recordedDurationNs: s(20),
      recorderSegments: unpaused(s(20)),
    });
    const total = plan.segments.reduce((n, seg) => n + seg.durationNs, 0);
    expect(total).toBe(s(15));
  });
});
