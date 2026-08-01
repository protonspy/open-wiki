import { describe, expect, it } from "vitest";
import { planChunks } from "../src/chunks.js";
import type { TimeMapSegment } from "../src/timemap.js";

const SECOND = 1_000_000_000;
const s = (n: number): number => n * SECOND;

/** `lengths` consecutive kept stretches, each following the last. */
function segments(lengths: readonly number[]): TimeMapSegment[] {
  let compressed = 0;
  return lengths.map((len) => {
    const seg: TimeMapSegment = {
      compressedStartNs: compressed,
      durationNs: len,
      recordedStartNs: compressed,
      wallStartMs: 1_000_000 + compressed / 1_000_000,
    };
    compressed += len;
    return seg;
  });
}

describe("planChunks", () => {
  it("cuts at a silence point, never inside a kept stretch", () => {
    // The point of chunking here rather than every N minutes: a boundary in
    // the middle of a sentence gives the provider half a word on each side.
    const segs = segments([s(300), s(300), s(300)]);
    const chunks = planChunks(segs, { targetNs: s(400), maxNs: s(900) });
    const joins = new Set(segs.map((seg) => seg.compressedStartNs));
    joins.add(s(900));
    for (const chunk of chunks) {
      expect(joins.has(chunk.compressedStartNs)).toBe(true);
      expect(joins.has(chunk.compressedEndNs)).toBe(true);
    }
  });

  it("fills a chunk up to the target before closing it", () => {
    const chunks = planChunks(segments([s(100), s(100), s(100), s(100)]), {
      targetNs: s(250),
      maxNs: s(600),
    });
    expect(chunks).toEqual([
      { index: 0, compressedStartNs: 0, compressedEndNs: s(200) },
      { index: 1, compressedStartNs: s(200), compressedEndNs: s(400) },
    ]);
  });

  it("covers the whole recording with no gap and no overlap", () => {
    const chunks = planChunks(segments([s(120), s(90), s(400), s(30)]), {
      targetNs: s(200),
      maxNs: s(600),
    });
    expect(chunks[0]!.compressedStartNs).toBe(0);
    expect(chunks[chunks.length - 1]!.compressedEndNs).toBe(s(640));
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.compressedStartNs).toBe(chunks[i - 1]!.compressedEndNs);
    }
  });

  it("numbers the chunks from zero, in order", () => {
    const chunks = planChunks(segments([s(100), s(100), s(100)]), {
      targetNs: s(100),
      maxNs: s(600),
    });
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it("splits a stretch longer than the maximum, because nobody paused in it", () => {
    // Twenty minutes without an 800 ms gap is a real recording, and a chunk
    // that long is one the provider refuses. The cut lands mid-speech; there
    // is no silence to put it at, and refusing to transcribe is worse.
    const chunks = planChunks(segments([s(1000)]), { targetNs: s(600), maxNs: s(600) });
    expect(chunks).toEqual([
      { index: 0, compressedStartNs: 0, compressedEndNs: s(600) },
      { index: 1, compressedStartNs: s(600), compressedEndNs: s(1000) },
    ]);
  });

  it("never emits a chunk longer than the maximum", () => {
    const chunks = planChunks(segments([s(2500), s(10)]), { targetNs: s(600), maxNs: s(900) });
    for (const chunk of chunks) {
      expect(chunk.compressedEndNs - chunk.compressedStartNs).toBeLessThanOrEqual(s(900));
    }
  });

  it("makes one chunk of a recording shorter than the target", () => {
    const chunks = planChunks(segments([s(10), s(10)]), { targetNs: s(600), maxNs: s(900) });
    expect(chunks).toEqual([{ index: 0, compressedStartNs: 0, compressedEndNs: s(20) }]);
  });

  it("returns nothing for a recording that kept nothing", () => {
    expect(planChunks([], { targetNs: s(600), maxNs: s(900) })).toEqual([]);
  });

  it("falls back rather than looping forever on a maximum of zero", () => {
    // The split loop advances by `maxNs`. At zero it advances by nothing and
    // the array grows until the process dies — an option that hangs instead of
    // failing, which is the worst way for a bad value to arrive.
    const chunks = planChunks(segments([s(2000)]), { targetNs: s(600), maxNs: 0 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[chunks.length - 1]!.compressedEndNs).toBe(s(2000));
  });

  it("falls back on a negative or non-finite maximum", () => {
    for (const maxNs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const chunks = planChunks(segments([s(2000)]), { maxNs });
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[chunks.length - 1]!.compressedEndNs).toBe(s(2000));
    }
  });

  it("never lets the target exceed the maximum", () => {
    const chunks = planChunks(segments([s(100), s(100), s(100)]), {
      targetNs: s(10_000),
      maxNs: s(150),
    });
    for (const chunk of chunks) {
      expect(chunk.compressedEndNs - chunk.compressedStartNs).toBeLessThanOrEqual(s(150));
    }
  });

  it("emits no empty chunk", () => {
    for (const chunk of planChunks(segments([s(600), s(600)]), {
      targetNs: s(600),
      maxNs: s(600),
    })) {
      expect(chunk.compressedEndNs).toBeGreaterThan(chunk.compressedStartNs);
    }
  });
});
