import { join } from "node:path";
import { absolutePassages, type TimedPassage } from "./absolute.js";
import { writeAtomic } from "./atomic.js";
import type { Journal, TrackName } from "./journal.js";
import type { TimeMap } from "./timemap.js";

/**
 * The timeline: both tracks merged and ordered by real time (plan 4.12).
 *
 * It is the machine-readable truth `text.md` renders from and that provenance
 * resolves against — `adr:0012-transcription-is-a-journalled-serial-pipeline`
 * says so, and adds the rule that follows from it: **only the timeline may be
 * read by anything downstream.** A consumer that learns to read the journal
 * has coupled itself to a temporary file that disappears when the source
 * seals.
 *
 * The speaker comes from the track and from nothing else. There is no
 * diarisation here and there is not meant to be: the microphone is the person
 * at this machine and the loopback is everybody else, which is a fact about
 * where the audio came from rather than a guess about who was talking.
 */

export type Speaker = "me" | "remote";

export interface TimelineEntry {
  speaker: Speaker;
  /** Offset into the Opus, in nanoseconds — what a citation names. */
  compressedStartNs: number;
  compressedEndNs: number;
  /** Milliseconds since the epoch — see the note on units in `timemap.ts`. */
  wallStartMs: number;
  text: string;
}

export interface Timeline {
  version: 1;
  compressedDurationNs: number;
  entries: TimelineEntry[];
}

export const TIMELINE_FILE = "timeline.json";

export function speakerOf(track: TrackName): Speaker {
  return track === "mic" ? "me" : "remote";
}

/**
 * Merge the journal's per-track results into one ordered timeline.
 *
 * Ordered by the *compressed* instant rather than by the wall-clock
 * millisecond, which is the same order — the map is monotonic — and finer. Two
 * passages a quarter of a millisecond apart sort correctly here and are a tie
 * on the clock, and a tie is where a merge silently reorders speakers.
 *
 * Only chunks that succeeded contribute. A journal still missing a chunk
 * produces a timeline with a hole in it, and that is the honest rendering: the
 * source is not sealed and 4.14 will not discard its WAV.
 */
export function buildTimeline(journal: Journal, map: TimeMap): Timeline {
  const passages: TimedPassage[] = [];
  for (const chunk of journal.chunks) {
    passages.push(...absolutePassages(chunk, map));
  }
  passages.sort(
    (a, b) =>
      a.compressedStartNs - b.compressedStartNs ||
      a.compressedEndNs - b.compressedEndNs ||
      // A stable last resort so two passages that start and end together come
      // out in the same order on every run — a timeline that reshuffles
      // between builds is a diff nobody can read.
      a.track.localeCompare(b.track),
  );
  return {
    version: 1,
    compressedDurationNs: map.compressedDurationNs,
    entries: passages.map((p) => ({
      speaker: speakerOf(p.track),
      compressedStartNs: p.compressedStartNs,
      compressedEndNs: p.compressedEndNs,
      wallStartMs: p.wallStartMs,
      text: p.text,
    })),
  };
}

/** Write `timeline.json` through a rename, for the reasons in `atomic.ts`. */
export function writeTimeline(dir: string, timeline: Timeline): void {
  writeAtomic(join(dir, TIMELINE_FILE), `${JSON.stringify(timeline, null, 2)}\n`);
}
