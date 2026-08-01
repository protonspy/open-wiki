import type { JournalChunk, TrackName } from "./journal.js";
import { toWallMs, type TimeMap } from "./timemap.js";

/**
 * Rebuilding absolute time from a chunk's offsets (plan 4.11).
 *
 * A provider is handed one chunk and answers about that chunk: a segment it
 * reports at two seconds is two seconds into what it was sent, not into the
 * recording. Two additions stand between that and a citation:
 *
 * 1. the chunk's own start in the compressed file, and
 * 2. the time map, which puts the compressed instant back on the wall clock —
 *    adding back the silence 4.6 removed and the pauses the recorder removed
 *    before that.
 *
 * Doing only the first is the failure that looks right. Every timestamp after
 * the first chunk would be wrong by exactly the length of what came before it,
 * and the transcript would still read perfectly.
 */

export interface TimedPassage {
  track: TrackName;
  compressedStartNs: number;
  compressedEndNs: number;
  /** Milliseconds since the epoch — see the note on units in `timemap.ts`. */
  wallStartMs: number;
  text: string;
}

export function absolutePassages(chunk: JournalChunk, map: TimeMap): TimedPassage[] {
  if (!chunk.done) return [];

  const segments = chunk.segments ?? [];
  if (segments.length === 0) {
    // A provider that returned only text still produced evidence. Anchoring it
    // at the chunk's start is coarse and honest; dropping it loses the words.
    const text = (chunk.text ?? "").trim();
    if (!text) return [];
    const passage = passageAt(chunk, map, 0, chunk.compressedEndNs - chunk.compressedStartNs, text);
    return passage ? [passage] : [];
  }

  const passages: TimedPassage[] = [];
  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) continue;
    const passage = passageAt(chunk, map, segment.startNs, segment.endNs, text);
    if (passage) passages.push(passage);
  }
  return passages;
}

function passageAt(
  chunk: JournalChunk,
  map: TimeMap,
  startNs: number,
  endNs: number,
  text: string,
): TimedPassage | null {
  // One ceiling, applied once. The chunk's end and the recording's end are the
  // same number for the last chunk and the chunk's is lower for every other,
  // so taking the smaller of the two and clamping everything against it keeps
  // the three returned fields describing one instant. Clamping them separately
  // is how a passage ends up claiming to start at 28 s, end at 25 s, and carry
  // a wall time belonging to neither.
  const ceiling = Math.min(chunk.compressedEndNs, map.compressedDurationNs);
  const rawStart = chunk.compressedStartNs + startNs;

  // Whisper over-runs: asked about ten seconds it sometimes answers about
  // eleven. A segment that merely *ends* past the chunk is clipped — the words
  // are real and they started here. A segment that *begins* past it is not
  // this chunk's at all: the next chunk covers that second and will return the
  // same words, and clipping it to a zero-length passage on the boundary is
  // how they end up in the timeline twice.
  if (rawStart >= ceiling && ceiling > chunk.compressedStartNs) return null;

  const start = clamp(rawStart, chunk.compressedStartNs, ceiling);
  const end = clamp(chunk.compressedStartNs + endNs, start, ceiling);

  const wallStartMs = toWallMs(map, start);
  // An instant the map refuses has no place in the timeline. Answering with
  // the nearest one it accepts would be the map lying, which is the whole
  // thing this module exists not to do.
  if (wallStartMs === null) return null;

  return {
    track: chunk.track,
    compressedStartNs: start,
    compressedEndNs: end,
    wallStartMs,
    text,
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
