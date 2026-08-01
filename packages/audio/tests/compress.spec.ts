import { describe, expect, it } from "vitest";
import {
  keepsFrom,
  planCompression,
  sharedSilence,
  snapToSampleGrid,
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

describe("snapToSampleGrid", () => {
  const GRID = 62_500; // one sample at 16 kHz

  it("moves boundaries outward, so snapping only ever keeps audio", () => {
    expect(snapToSampleGrid([{ startNs: 100_000, endNs: 200_000 }], GRID)).toEqual([
      { startNs: 62_500, endNs: 250_000 },
    ]);
  });

  it("leaves a boundary already on the grid where it is", () => {
    expect(snapToSampleGrid([{ startNs: 0, endNs: 125_000 }], GRID)).toEqual([
      { startNs: 0, endNs: 125_000 },
    ]);
  });

  it("does nothing when there is no grid to snap to", () => {
    const keeps = [{ startNs: 100_000, endNs: 200_000 }];
    expect(snapToSampleGrid(keeps, 0)).toEqual(keeps);
  });
});

describe("planCompression", () => {
  it("puts every boundary on a whole output sample when given a grid", () => {
    // The encoder cuts on whole samples. A map built from boundaries between
    // samples describes something ffmpeg cannot do, and the two disagree by a
    // fraction of a sample at every join, in a direction nothing controls.
    const plan = planCompression({
      perTrackSilence: [
        [{ startNs: 5_000_010_000, endNs: 10_000_010_000 }],
        [{ startNs: 5_000_010_000, endNs: 10_000_010_000 }],
      ],
      recordedDurationNs: s(20),
      recorderSegments: unpaused(s(20)),
      sampleGridNs: 62_500,
    });
    for (const segment of plan.segments) {
      expect(segment.compressedStartNs % 62_500).toBe(0);
      expect(segment.durationNs % 62_500).toBe(0);
    }
  });

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

  it("composes both removals when a shared silence spans a pause", () => {
    // The case task 4.7 is `(TDD)` for, and the one every other test here
    // misses by exercising one removal at a time. Captured [0,10) at wall T
    // and [10,20) at T+70s, with both tracks silent across [8s,12s) — so the
    // cut straddles the pause. What survives is [0,8) and [12,20): the second
    // piece starts at compressed 8 s, comes from recorded 12 s, and happened
    // at T + 70 s + 2 s. Getting the composition wrong puts it at T + 12 s,
    // which is plausible, off by a minute, and invisible to any test that
    // removes only silence or only a pause.
    const plan = planCompression({
      perTrackSilence: [[{ startNs: s(8), endNs: s(12) }], [{ startNs: s(8), endNs: s(12) }]],
      recordedDurationNs: s(20),
      recorderSegments: [
        { recordedStartNs: 0, durationNs: s(10), wallStartMs: 1_000_000 },
        { recordedStartNs: s(10), durationNs: s(10), wallStartMs: 1_070_000 },
      ],
    });
    expect(plan.segments).toEqual([
      { compressedStartNs: 0, durationNs: s(8), recordedStartNs: 0, wallStartMs: 1_000_000 },
      {
        compressedStartNs: s(8),
        durationNs: s(8),
        recordedStartNs: s(12),
        wallStartMs: 1_072_000,
      },
    ]);
  });

  it("keeps the compressed clock continuous across a cut that straddles a pause", () => {
    const plan = planCompression({
      perTrackSilence: [[{ startNs: s(8), endNs: s(12) }], [{ startNs: s(8), endNs: s(12) }]],
      recordedDurationNs: s(20),
      recorderSegments: [
        { recordedStartNs: 0, durationNs: s(10), wallStartMs: 1_000_000 },
        { recordedStartNs: s(10), durationNs: s(10), wallStartMs: 1_070_000 },
      ],
    });
    let expected = 0;
    for (const segment of plan.segments) {
      expect(segment.compressedStartNs).toBe(expected);
      expected += segment.durationNs;
    }
    expect(expected).toBe(s(16));
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
