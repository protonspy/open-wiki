import type { Chunk, TimeMapSegment } from "./timemap.js";

/**
 * Where to cut the audio into requests (plan 4.7, the chunk half).
 *
 * **Boundaries land at silence points**, which is the whole reason chunking is
 * decided here and not by an egg timer. A cut every ten minutes regardless of
 * content splits a sentence in two, and each half arrives at the provider
 * without the other — one comes back with a truncated word and the other with
 * a phantom one. A join between kept stretches is a place where at least
 * `MIN_SILENCE_MS` of nothing was removed, so nobody was talking across it.
 */

const MINUTE_NS = 60_000_000_000;

/** Long enough to give the model context, short enough to redo cheaply (4.9). */
export const DEFAULT_TARGET_NS = 10 * MINUTE_NS;

/**
 * The hard cap. At 24 kbps fifteen minutes is under 3 MB — far below any
 * provider's 25 MB limit (`adr:0006`) — so this is about how much work one
 * failed chunk costs, not about the upload.
 */
export const DEFAULT_MAX_NS = 15 * MINUTE_NS;

export interface ChunkOptions {
  targetNs?: number;
  maxNs?: number;
}

/**
 * Group the kept stretches into chunks, closing one whenever the next stretch
 * would take it past the target.
 *
 * A single stretch longer than the maximum is split mid-speech. It has to be:
 * twenty minutes without an 800 ms gap is a real recording — a presentation, a
 * long answer — and there is no silence to put a boundary at. Refusing to
 * transcribe it would be worse than one seam in the timeline.
 */
export function planChunks(
  segments: readonly TimeMapSegment[],
  options: ChunkOptions = {},
): Chunk[] {
  const first = segments[0];
  if (!first) return [];
  // A non-positive maximum makes the split loop below advance by nothing and
  // never terminate — an option that hangs rather than failing, which is the
  // worst way for a bad value to arrive. Fall back rather than throw: the
  // caller wanted chunks, and refusing to produce any would strand a recording
  // over a tuning parameter.
  const maxNs = positive(options.maxNs, DEFAULT_MAX_NS);
  const targetNs = Math.min(positive(options.targetNs, DEFAULT_TARGET_NS), maxNs);

  const chunks: Chunk[] = [];
  let startNs = first.compressedStartNs;
  // The last silence point seen: where this chunk would end if it closed now.
  let boundaryNs = startNs;

  const close = (endNs: number): void => {
    chunks.push({
      index: chunks.length,
      compressedStartNs: startNs,
      compressedEndNs: endNs,
    });
    startNs = endNs;
  };

  for (const segment of segments) {
    const segmentEndNs = segment.compressedStartNs + segment.durationNs;
    if (segmentEndNs - startNs > targetNs) {
      if (boundaryNs > startNs) close(boundaryNs);
      // Only now, with the chunk closed at its last silence point, can a single
      // over-long stretch be recognised — and split where nothing else will do.
      while (segmentEndNs - startNs > maxNs) close(startNs + maxNs);
    }
    boundaryNs = segmentEndNs;
  }
  if (boundaryNs > startNs) close(boundaryNs);
  return chunks;
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}
