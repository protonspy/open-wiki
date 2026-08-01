import { describe, expect, it } from "vitest";
import { absolutePassages } from "../src/absolute.js";
import type { JournalChunk } from "../src/journal.js";
import type { TimeMap } from "../src/timemap.js";

const SECOND = 1_000_000_000;
const s = (n: number): number => n * SECOND;

/**
 * 20 s captured with 5 s..10 s of shared silence removed, then a minute's
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

function chunk(over: Partial<JournalChunk> = {}): JournalChunk {
  return {
    index: 0,
    track: "mic",
    compressedStartNs: 0,
    compressedEndNs: s(25),
    done: true,
    segments: [],
    ...over,
  };
}

describe("absolutePassages (4.11)", () => {
  it("adds the chunk's offset to a segment timed from the chunk's own start", () => {
    // A provider is handed one chunk and answers about that chunk. A segment
    // it reports at 2 s in the second chunk is not 2 s into the recording, and
    // treating it as one is how every timestamp after the first chunk ends up
    // wrong by exactly the length of what came before.
    const passages = absolutePassages(
      chunk({
        compressedStartNs: s(15),
        compressedEndNs: s(25),
        segments: [{ startNs: s(2), endNs: s(4), text: "the cutover" }],
      }),
      map,
    );
    expect(passages[0]!.compressedStartNs).toBe(s(17));
  });

  it("resolves the absolute instant through the time map", () => {
    // Compressed 17 s is recorded 22 s, which happened a minute and two
    // seconds after the pause resumed.
    const passages = absolutePassages(
      chunk({
        compressedStartNs: s(15),
        compressedEndNs: s(25),
        segments: [{ startNs: s(2), endNs: s(4), text: "the cutover" }],
      }),
      map,
    );
    expect(passages[0]!.wallStartMs).toBe(1_082_000);
  });

  it("accounts for the silence that was cut, not only for the chunk offset", () => {
    // Compressed 6 s is recorded 11 s. A reconstruction that added the chunk
    // offset and stopped would say 6 s after the start, which is inside the
    // removed silence — a moment nothing recorded.
    const passages = absolutePassages(
      chunk({ segments: [{ startNs: s(6), endNs: s(7), text: "after the gap" }] }),
      map,
    );
    expect(passages[0]!.wallStartMs).toBe(1_011_000);
  });

  it("carries the track, which is what labels me and remote", () => {
    const passages = absolutePassages(
      chunk({ track: "system", segments: [{ startNs: 0, endNs: SECOND, text: "hello" }] }),
      map,
    );
    expect(passages[0]!.track).toBe("system");
  });

  it("keeps the segments in order", () => {
    const passages = absolutePassages(
      chunk({
        segments: [
          { startNs: 0, endNs: SECOND, text: "first" },
          { startNs: s(2), endNs: s(3), text: "second" },
        ],
      }),
      map,
    );
    expect(passages.map((p) => p.text)).toEqual(["first", "second"]);
  });

  it("clamps a segment that ran past the end of its chunk", () => {
    // Whisper over-runs: asked about ten seconds it sometimes answers about
    // eleven. Left alone, the eleventh second belongs to the next chunk too,
    // and the same words appear twice in the timeline.
    const passages = absolutePassages(
      chunk({
        compressedStartNs: 0,
        compressedEndNs: s(5),
        segments: [{ startNs: s(4), endNs: s(9), text: "over the edge" }],
      }),
      map,
    );
    expect(passages[0]!.compressedEndNs).toBe(s(5));
  });

  it("clamps a segment that would resolve past the end of the recording", () => {
    const passages = absolutePassages(
      chunk({
        compressedStartNs: s(15),
        compressedEndNs: s(25),
        segments: [{ startNs: s(9), endNs: s(30), text: "the last word" }],
      }),
      map,
    );
    expect(passages[0]!.wallStartMs).not.toBeNull();
    expect(passages[0]!.compressedEndNs).toBeLessThanOrEqual(s(25));
  });

  it("drops a segment that begins past the end of its chunk", () => {
    // Not the same as one that merely runs over. A segment that *starts* after
    // the chunk ends is the next chunk's, and that chunk will return the same
    // words — clipping it to a zero-length passage on the boundary is how they
    // land in the timeline twice.
    const passages = absolutePassages(
      chunk({
        compressedStartNs: 0,
        compressedEndNs: s(5),
        segments: [{ startNs: s(6), endNs: s(7), text: "belongs to the next chunk" }],
      }),
      map,
    );
    expect(passages).toEqual([]);
  });

  it("never emits a passage that ends before it starts", () => {
    // Clamping the start against the chunk and the end against the recording
    // is how a passage comes to claim it starts at 28 s and ends at 25 s.
    const passages = absolutePassages(
      chunk({
        compressedStartNs: s(20),
        compressedEndNs: s(30),
        segments: [{ startNs: s(1), endNs: s(9), text: "past the map" }],
      }),
      map,
    );
    for (const passage of passages) {
      expect(passage.compressedEndNs).toBeGreaterThanOrEqual(passage.compressedStartNs);
      expect(passage.compressedStartNs).toBeLessThanOrEqual(map.compressedDurationNs);
      expect(passage.compressedEndNs).toBeLessThanOrEqual(map.compressedDurationNs);
    }
  });

  it("returns nothing rather than a wrong instant when the map refuses one", () => {
    const empty = { ...map, segments: [], compressedDurationNs: 0 };
    expect(
      absolutePassages(chunk({ segments: [{ startNs: 0, endNs: 1, text: "orphan" }] }), empty),
    ).toEqual([]);
  });

  it("drops a segment with nothing in it", () => {
    const passages = absolutePassages(
      chunk({ segments: [{ startNs: 0, endNs: SECOND, text: "   " }] }),
      map,
    );
    expect(passages).toEqual([]);
  });

  it("returns nothing for a chunk that was never transcribed", () => {
    expect(absolutePassages(chunk({ done: false, segments: undefined }), map)).toEqual([]);
  });

  it("falls back to the chunk's whole text when the provider gave no segments", () => {
    // A provider that returns only text still produced evidence. Anchoring it
    // at the chunk's start is coarse and honest; dropping it loses the words.
    const passages = absolutePassages(
      chunk({ compressedStartNs: s(15), compressedEndNs: s(25), segments: [], text: "all of it" }),
      map,
    );
    expect(passages).toEqual([
      {
        track: "mic",
        compressedStartNs: s(15),
        compressedEndNs: s(25),
        wallStartMs: 1_080_000,
        text: "all of it",
      },
    ]);
  });
});
