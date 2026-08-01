import { runOrThrow, type FfmpegRunner } from "./ffmpeg.js";

/**
 * Finding the silence (plan 4.6, the detection half).
 *
 * ffmpeg's `silencedetect` is an amplitude gate, not a trained voice-activity
 * model. That is the right trade here: it ships in the essentials build we
 * already bundle and verify, it costs one pass over the file, and what it is
 * used for is deciding which stretches to *drop* — a gate that keeps a bit too
 * much wastes a few seconds of Opus, while a model that drops a quiet sentence
 * loses evidence. Erring towards keeping is the whole tuning policy.
 */

/** A half-open range `[startNs, endNs)` in the recording's own clock. */
export interface Interval {
  startNs: number;
  endNs: number;
}

/** Silence has to last this long before it is worth removing (plan 4.6). */
export const MIN_SILENCE_MS = 800;

/**
 * Below this the gate calls it silence. Meeting audio through a laptop
 * microphone carries a noise floor well above a studio's, so a stricter
 * threshold (-50 dB and below) detects almost nothing and the file never
 * shrinks.
 */
export const SILENCE_THRESHOLD_DB = -35;

const NS_PER_MS = 1_000_000;
const NS_PER_SECOND = 1_000_000_000;

/** The ffmpeg invocation that probes one track for silence. Decodes, writes nothing. */
export function silenceDetectArgs(
  input: string,
  minSilenceMs = MIN_SILENCE_MS,
  thresholdDb = SILENCE_THRESHOLD_DB,
): string[] {
  const seconds = minSilenceMs / 1000;
  return [
    "-hide_banner",
    "-nostats",
    "-i",
    input,
    "-af",
    `silencedetect=noise=${thresholdDb}dB:d=${seconds}`,
    "-f",
    "null",
    "-",
  ];
}

// `[silencedetect @ 0000...] silence_start: 12.345`, and the matching
// `silence_end: 18.9 | silence_duration: 6.555`. A negative start is possible
// when the file opens in silence and ffmpeg back-dates it past zero.
const START = /silence_start:\s*(-?\d+(?:\.\d+)?)/;
const END = /silence_end:\s*(-?\d+(?:\.\d+)?)/;

/**
 * Read the silent stretches out of an ffmpeg log.
 *
 * `durationNs` closes the last one: a file that ends while still silent gets a
 * `silence_start` and no `silence_end`, and treating that as "no silence here"
 * would keep a minute of nothing on the end of every recording that stopped
 * after the meeting went quiet.
 *
 * Intervals come back clamped into `[0, durationNs)`, ordered, and with the
 * empty ones dropped. Nothing here filters by length — that happens after the
 * tracks are intersected, because it is the *shared* silence that gets cut.
 */
export function parseSilenceLog(log: string, durationNs: number): Interval[] {
  const intervals: Interval[] = [];
  let open: number | null = null;

  for (const line of log.split(/\r?\n/)) {
    if (!line.includes("silencedetect")) continue;
    const start = START.exec(line);
    if (start?.[1] !== undefined) {
      open = secondsToNs(start[1]);
      // No `continue`: ffmpeg can print a start and an end on one line.
    }
    const end = END.exec(line);
    if (end?.[1] !== undefined && open !== null) {
      intervals.push({ startNs: open, endNs: secondsToNs(end[1]) });
      open = null;
    }
  }
  if (open !== null) intervals.push({ startNs: open, endNs: durationNs });

  return clampAll(intervals, durationNs);
}

function secondsToNs(text: string): number {
  return Math.round(Number(text) * NS_PER_SECOND);
}

function clampAll(intervals: readonly Interval[], durationNs: number): Interval[] {
  const out: Interval[] = [];
  for (const raw of intervals) {
    const startNs = Math.max(0, Math.min(raw.startNs, durationNs));
    const endNs = Math.max(0, Math.min(raw.endNs, durationNs));
    if (endNs > startNs) out.push({ startNs, endNs });
  }
  return out.sort((a, b) => a.startNs - b.startNs);
}

/** Probe one track and return its silent stretches. */
export async function detectSilence(
  run: FfmpegRunner,
  input: string,
  durationNs: number,
  minSilenceMs = MIN_SILENCE_MS,
): Promise<Interval[]> {
  const result = await runOrThrow(run, silenceDetectArgs(input, minSilenceMs));
  return parseSilenceLog(result.stderr, durationNs);
}

/** Milliseconds as nanoseconds — the unit every interval here is in. */
export function msToNs(ms: number): number {
  return Math.round(ms * NS_PER_MS);
}
