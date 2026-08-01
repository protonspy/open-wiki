import { msToNs, MIN_SILENCE_MS, type Interval } from "./silence.js";
import type { TimeMapSegment } from "./timemap.js";

/**
 * Deciding what to cut, and composing the two clocks (plan 4.7).
 *
 * **Silence is cut only where every track is silent.** Cutting each track on
 * its own silence is the obvious design and it is wrong: the two files would
 * come out different lengths, their compressed clocks would diverge, and
 * `rec://<id>#14:32` would have to say which track it meant — undoing exactly
 * the alignment 4.1 and 4.3 exist to guarantee. One cut list, applied to both,
 * keeps one instant meaning one moment.
 *
 * It costs some size. A stretch where only the remote party is talking keeps a
 * silent microphone track alongside it. At 24 kbps silence is nearly free, and
 * the alternative is provenance that cannot be stated in one number.
 */

const NS_PER_MS = 1_000_000;

/** One uninterrupted stretch of capture, as the recorder's manifest records it. */
export interface RecorderSegment {
  recordedStartNs: number;
  durationNs: number;
  /** Milliseconds since the epoch — see the note on units in `timemap.ts`. */
  wallStartMs: number;
}

export interface CompressionInput {
  /** Each track's silent stretches, in recorded time. */
  perTrackSilence: readonly (readonly Interval[])[];
  recordedDurationNs: number;
  /** The recorder's own map, which is where the pauses live. */
  recorderSegments: readonly RecorderSegment[];
  minSilenceNs?: number;
  /**
   * One output sample in nanoseconds. Boundaries are snapped onto it so the
   * map and the encoder are built from the same integers; zero disables the
   * snap, which is what a test that is not about the grid wants.
   */
  sampleGridNs?: number;
}

export interface CompressionPlan {
  /** What to keep, in recorded time — the cut list both tracks are encoded with. */
  keeps: Interval[];
  /** The same stretches with their compressed and wall-clock positions worked out. */
  segments: TimeMapSegment[];
}

/**
 * The stretches every track agrees are silent and that last long enough to be
 * worth removing. Intersecting first and filtering after is the order that
 * matters: two tracks each silent for ten seconds may only overlap for half of
 * one, and it is the overlap that gets cut.
 */
export function sharedSilence(
  perTrack: readonly (readonly Interval[])[],
  minNs: number,
): Interval[] {
  const first = perTrack[0];
  if (!first) return [];
  let shared: Interval[] = [...first];
  for (let i = 1; i < perTrack.length; i++) {
    shared = intersect(shared, perTrack[i]!);
    if (shared.length === 0) break;
  }
  return shared.filter((s) => s.endNs - s.startNs >= minNs);
}

/** Both lists are start-ordered, so one pass over each finds every overlap. */
function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const startNs = Math.max(a[i]!.startNs, b[j]!.startNs);
    const endNs = Math.min(a[i]!.endNs, b[j]!.endNs);
    if (endNs > startNs) out.push({ startNs, endNs });
    // Advance whichever ends first; the other may still overlap what follows.
    if (a[i]!.endNs < b[j]!.endNs) i++;
    else j++;
  }
  return out;
}

/**
 * What is left of the recording once the cuts are removed.
 *
 * A recording that is silent end to end keeps everything. An Opus of zero
 * length is a provenance file that opens at no instant, and "the meeting was
 * silent" is a fact about the meeting rather than a reason to have no record
 * of it.
 */
export function keepsFrom(cuts: readonly Interval[], durationNs: number): Interval[] {
  const keeps: Interval[] = [];
  let cursor = 0;
  for (const cut of cuts) {
    if (cut.startNs > cursor) keeps.push({ startNs: cursor, endNs: cut.startNs });
    cursor = Math.max(cursor, cut.endNs);
  }
  if (cursor < durationNs) keeps.push({ startNs: cursor, endNs: durationNs });
  return keeps.length > 0 ? keeps : [{ startNs: 0, endNs: durationNs }];
}

/**
 * Move every boundary onto an output-sample boundary.
 *
 * The encoder cuts on whole samples of the 16 kHz output stream, so a cut list
 * carrying boundaries between samples describes something ffmpeg cannot do —
 * and the map built from it would be off by a fraction of a sample at every
 * join, in a direction nothing controls. Snapping here, before the map is
 * built, means the map and the file are computed from the same integers.
 *
 * Boundaries move outward — start down, end up — so snapping only ever keeps
 * audio. Keeps are separated by at least `MIN_SILENCE_MS`, four orders of
 * magnitude more than one sample, so outward movement cannot make two of them
 * touch.
 */
export function snapToSampleGrid(keeps: readonly Interval[], gridNs: number): Interval[] {
  if (gridNs <= 0) return [...keeps];
  return keeps.map((keep) => ({
    startNs: Math.floor(keep.startNs / gridNs) * gridNs,
    endNs: Math.ceil(keep.endNs / gridNs) * gridNs,
  }));
}

/**
 * The cut list and the segments that describe where everything ended up.
 *
 * The composition is the delicate part. A kept stretch is split wherever the
 * recorder paused, because recorded time runs unbroken across a pause and wall
 * time jumps by its whole length — one stretch spanning the join has two
 * different slopes against the clock and cannot be described by one segment.
 * Getting this wrong produces a map that is plausible everywhere and wrong
 * after the first pause, which is why the task is `(TDD)`.
 */
export function planCompression(input: CompressionInput): CompressionPlan {
  const minNs = input.minSilenceNs ?? msToNs(MIN_SILENCE_MS);
  const cuts = sharedSilence(input.perTrackSilence, minNs);
  const gridNs = input.sampleGridNs ?? 0;
  // Snapped against a duration that is itself on the grid: an end rounded up
  // past the last whole sample would ask the encoder for audio the file does
  // not contain.
  const durationNs =
    gridNs > 0 ? Math.floor(input.recordedDurationNs / gridNs) * gridNs : input.recordedDurationNs;
  const keeps = snapToSampleGrid(keepsFrom(cuts, durationNs), gridNs).map((keep) => ({
    startNs: Math.max(0, keep.startNs),
    endNs: Math.min(durationNs, keep.endNs),
  }));

  const segments: TimeMapSegment[] = [];
  let compressedStartNs = 0;
  for (const keep of keeps) {
    for (const capture of input.recorderSegments) {
      // A segment that captured nothing answers for no instant, including its
      // own start — the same rule the recorder's map applies.
      if (capture.durationNs === 0) continue;
      const captureEnd = capture.recordedStartNs + capture.durationNs;
      const startNs = Math.max(keep.startNs, capture.recordedStartNs);
      const endNs = Math.min(keep.endNs, captureEnd);
      if (endNs <= startNs) continue;
      segments.push({
        compressedStartNs,
        durationNs: endNs - startNs,
        recordedStartNs: startNs,
        wallStartMs:
          capture.wallStartMs + Math.round((startNs - capture.recordedStartNs) / NS_PER_MS),
      });
      compressedStartNs += endNs - startNs;
    }
  }
  return { keeps, segments };
}
