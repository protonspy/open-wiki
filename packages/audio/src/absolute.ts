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
  // Clamped into the chunk, because Whisper over-runs: asked about ten seconds
  // it sometimes answers about eleven, and the eleventh belongs to the next
  // chunk as well — the same words twice in one timeline.
  const start = clamp(
    chunk.compressedStartNs + startNs,
    chunk.compressedStartNs,
    chunk.compressedEndNs,
  );
  const end = clamp(chunk.compressedStartNs + endNs, start, chunk.compressedEndNs);

  // And clamped into the recording, because the last chunk's end is the
  // recording's end and a provider that ran past it names an instant the map
  // rightly refuses.
  const inRange = Math.min(start, map.compressedDurationNs);
  const wallStartMs = toWallMs(map, inRange);
  if (wallStartMs === null) return null;

  return {
    track: chunk.track,
    compressedStartNs: start,
    compressedEndNs: Math.min(end, map.compressedDurationNs),
    wallStartMs,
    text,
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
