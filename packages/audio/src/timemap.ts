/**
 * The map from an instant in the Opus file to the instant it really happened
 * (plan 4.7), and the reader every consumer of `timemap.json` goes through.
 *
 * **This is the thing that lies with confidence.** The recorder already owns
 * one map — recorded time to wall time, which is where a *pause* is removed
 * (`crates/recorder/src/timemap.rs`). This one is the second half: silence is
 * removed from the recorded audio before it is encoded, so the file a
 * provenance link opens is shorter again, and *its* clock is what a citation
 * names. `rec://fenix-weekly-2026-07-31#14:32` is 14 minutes 32 seconds into
 * `mic.opus`, not into the capture and not a time of day.
 *
 * Composing the two at the moment the Opus is written, rather than at every
 * read, is deliberate: the recorder's map describes files that get discarded
 * (`adr:0006-opus-as-the-provenance-format` throws the WAV away), so a citation
 * resolved against it would stop resolving the moment retention did its job.
 *
 * **On units.** Durations are nanoseconds; wall-clock instants are
 * *milliseconds* since the epoch. Nanoseconds since the epoch is about 1.75e18,
 * and JavaScript's integers are exact only to 9.007e15 — reading the
 * recorder's `wall_start_ns` as a `number` already costs a couple of hundred
 * nanoseconds of precision, and doing arithmetic in that range would quietly
 * accumulate more. A millisecond is four orders of magnitude finer than any
 * instant a person cites, so the unit is chosen where the exactness is free.
 * Every field says which it is.
 */

/** One uninterrupted stretch of audio that survived into the Opus file. */
export interface TimeMapSegment {
  /** Where it starts in the Opus file, in nanoseconds. */
  compressedStartNs: number;
  /** How long it lasts. Identical in compressed and recorded time. */
  durationNs: number;
  /** Where it came from in the raw capture, in nanoseconds. */
  recordedStartNs: number;
  /** The wall-clock instant it began, in milliseconds since the Unix epoch. */
  wallStartMs: number;
}

/** A stretch of the Opus file sent to the provider as one request (plan 4.9). */
export interface Chunk {
  index: number;
  compressedStartNs: number;
  compressedEndNs: number;
}

export interface TimeMap {
  version: 1;
  /** How long the Opus file is — what a player's scrubber spans. */
  compressedDurationNs: number;
  segments: TimeMapSegment[];
  chunks: Chunk[];
}

export const TIMEMAP_FILE = "timemap.json";

const NS_PER_MS = 1_000_000;
const NS_PER_SECOND = 1_000_000_000;

/** Where the last segment ends: the length of the Opus file. */
export function compressedDurationNs(segments: readonly TimeMapSegment[]): number {
  const last = segments[segments.length - 1];
  return last ? last.compressedStartNs + last.durationNs : 0;
}

/**
 * The index of the segment owning `offsetOf(segment)`-relative instant `ns`,
 * or `null` when the instant falls outside the recording.
 *
 * A segment owns `[start, start + duration)` — half-open. The one exception is
 * the final instant, which has no next segment to belong to and so belongs to
 * the last one. Owning the boundary at both ends would put every citation that
 * lands exactly on a cut at the wrong side of it, by the whole length of the
 * cut — which is the failure this module exists to prevent.
 *
 * "The last one" means the last segment that recorded anything, matching
 * `crates/recorder/src/timemap.rs`. Taking the last *index* instead would give
 * the recording's final instant to nobody whenever the map ends on an empty
 * segment — the two halves of one map disagreeing about their own boundary
 * rule.
 */
function locate(
  segments: readonly TimeMapSegment[],
  ns: number,
  startOf: (s: TimeMapSegment) => number,
): { segment: TimeMapSegment; offsetNs: number } | null {
  const last = lastRecordingIndex(segments);
  if (last < 0) return null;
  for (let i = 0; i <= last; i++) {
    const segment = segments[i]!;
    if (segment.durationNs === 0) continue;
    const offsetNs = ns - startOf(segment);
    if (offsetNs < 0) continue;
    const owns = i === last ? offsetNs <= segment.durationNs : offsetNs < segment.durationNs;
    if (owns) return { segment, offsetNs };
  }
  return null;
}

/** The index of the last segment that recorded anything, or -1. */
function lastRecordingIndex(segments: readonly TimeMapSegment[]): number {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i]!.durationNs > 0) return i;
  }
  return -1;
}

/**
 * Whether a parsed JSON value is a time map this version can answer from.
 *
 * A cast is not a check. `timemap.json` is a file on disk in a directory the
 * user owns, so it can be truncated, hand-edited, or written by a later
 * version of this product — and `{}` casts to `TimeMap` just as happily as a
 * real map does, then throws inside `locate` and takes the whole of `ow check`
 * down with it. Every consumer goes through here.
 */
export function isTimeMap(value: unknown): value is TimeMap {
  if (typeof value !== "object" || value === null) return false;
  const map = value as Partial<TimeMap>;
  if (map.version !== 1) return false;
  if (!Number.isFinite(map.compressedDurationNs)) return false;
  if (!Array.isArray(map.segments)) return false;
  return map.segments.every(
    (s) =>
      typeof s === "object" &&
      s !== null &&
      Number.isFinite(s.compressedStartNs) &&
      Number.isFinite(s.durationNs) &&
      Number.isFinite(s.recordedStartNs) &&
      Number.isFinite(s.wallStartMs),
  );
}

/** The wall-clock instant a compressed instant happened at, in milliseconds. */
export function toWallMs(map: TimeMap, compressedNs: number): number | null {
  const found = locate(map.segments, compressedNs, (s) => s.compressedStartNs);
  if (!found) return null;
  return found.segment.wallStartMs + Math.round(found.offsetNs / NS_PER_MS);
}

/** Where a compressed instant sits in the raw capture. */
export function toRecordedNs(map: TimeMap, compressedNs: number): number | null {
  const found = locate(map.segments, compressedNs, (s) => s.compressedStartNs);
  if (!found) return null;
  return found.segment.recordedStartNs + found.offsetNs;
}

/**
 * Where a recorded instant sits in the Opus file, or `null` when it was cut
 * out. A moment that is in no file has no instant to answer with, and giving
 * the nearest kept one would be the map lying.
 */
export function toCompressedNs(map: TimeMap, recordedNs: number): number | null {
  const found = locate(map.segments, recordedNs, (s) => s.recordedStartNs);
  if (!found) return null;
  return found.segment.compressedStartNs + found.offsetNs;
}

/**
 * Whether an instant falls inside the recording — the in-range half of the
 * provenance check plan 5.4 left dormant until this format existed.
 */
export function containsInstant(map: TimeMap, compressedNs: number): boolean {
  return toWallMs(map, compressedNs) !== null;
}

// `mm:ss` or `h:mm:ss`, the two forms `adr:0011-sources-are-named-by-what-they-are`
// writes. The minute and second fields are range-checked rather than merely
// counted: `14:75` reads as a time and is not one, and accepting it would let a
// citation name an instant that arithmetic then rolls into a different minute.
const INSTANT = /^(\d{1,2}):([0-5]\d)$/;
const LONG_INSTANT = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/;

/**
 * Read a citation's instant as an offset into the recording, or `null` when it
 * is not an instant. This is the single authority on what an instant is —
 * `store/provenance.ts` asks here rather than carrying a second regex, because
 * two definitions of a time format disagree at exactly the values that matter.
 */
export function parseInstant(text: string): number | null {
  const long = LONG_INSTANT.exec(text);
  if (long) {
    return seconds(Number(long[1]) * 3600 + Number(long[2]) * 60 + Number(long[3]));
  }
  const short = INSTANT.exec(text);
  if (short) return seconds(Number(short[1]) * 60 + Number(short[2]));
  return null;
}

function seconds(n: number): number {
  return n * NS_PER_SECOND;
}

/**
 * Write an instant the way a citation carries it. Truncated, never rounded: an
 * anchor that rounded up would name a moment slightly after the passage it is
 * the provenance for, and a reader following it would land past the sentence.
 */
export function formatInstant(ns: number): string {
  const total = Math.floor(Math.max(0, ns) / NS_PER_SECOND);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
