import { rmSync, writeFileSync } from "node:fs";
import { runOrThrow, type FfmpegRunner } from "./ffmpeg.js";
import type { Interval } from "./silence.js";

/**
 * Downmix, cut, encode (plan 4.6, the writing half).
 *
 * One pass per track turns a 48 kHz stereo WAV into the 16 kHz mono Opus at
 * 24 kbps that `adr:0006-opus-as-the-provenance-format` makes permanent: it is
 * what fits under a provider's 25 MB upload cap and what every provenance link
 * of a claim from audio will open, forever.
 *
 * **The cut list is shared between the tracks and is not computed here.** Both
 * are handed the same keeps so their compressed clocks stay identical — see
 * `compress.ts` for why that is the whole reason a citation can name one
 * instant rather than one instant per track.
 */

const NS_PER_SECOND = 1_000_000_000;

/** 16 kHz mono is what a transcription model consumes anyway (`adr:0006`). */
export const OUTPUT_SAMPLE_RATE = 16_000;
export const OUTPUT_BITRATE = "24k";

/**
 * The `aselect` filter that keeps only the wanted stretches, with `asetpts`
 * restamping what survives so the output is contiguous — without it the gaps
 * come back as silence and nothing was saved.
 *
 * `between` is inclusive at both ends, which would double-count a frame shared
 * by two adjacent intervals. Nothing produces adjacent intervals: a join
 * between keeps exists only where at least `MIN_SILENCE_MS` was removed.
 */
export function selectFilter(keeps: readonly Interval[]): string {
  const terms = keeps.map((k) => `between(t,${seconds(k.startNs)},${seconds(k.endNs)})`);
  return `aselect='${terms.join("+")}',asetpts=N/SR/TB`;
}

function seconds(ns: number): string {
  return (ns / NS_PER_SECOND).toFixed(6);
}

/**
 * The ffmpeg invocation that produces one track's Opus.
 *
 * The filter arrives as a *file* rather than an argument. An hour of meeting
 * with a few hundred pauses builds a filter string in the tens of kilobytes,
 * and Windows caps a command line at about 32 000 characters — a limit that
 * would be hit by exactly the long recordings this pipeline exists for, and
 * only by those.
 */
export function encodeArgs(input: string, output: string, filterScript: string | null): string[] {
  return [
    "-hide_banner",
    "-nostats",
    "-y",
    "-i",
    input,
    ...(filterScript ? ["-filter_script:a", filterScript] : []),
    "-vn",
    "-ac",
    "1",
    "-ar",
    String(OUTPUT_SAMPLE_RATE),
    "-c:a",
    "libopus",
    "-b:a",
    OUTPUT_BITRATE,
    output,
  ];
}

/**
 * Encode one track, dropping everything outside `keeps`.
 *
 * A `keeps` list that already covers the whole track skips the filter
 * altogether: there is nothing to select, and an `aselect` that selects
 * everything is a way to get the arithmetic wrong for no gain.
 */
export async function encodeTrack(
  run: FfmpegRunner,
  input: string,
  output: string,
  keeps: readonly Interval[],
  durationNs: number,
): Promise<void> {
  const whole = keeps.length === 1 && keeps[0]!.startNs <= 0 && keeps[0]!.endNs >= durationNs;
  if (keeps.length === 0 || whole) {
    await runOrThrow(run, encodeArgs(input, output, null));
    return;
  }
  const script = `${output}.filter.txt`;
  writeFileSync(script, selectFilter(keeps), "utf8");
  try {
    await runOrThrow(run, encodeArgs(input, output, script));
  } finally {
    // The filter script is scaffolding, and one left behind in `raw/` would
    // read as part of an immutable source.
    rmSync(script, { force: true });
  }
}
