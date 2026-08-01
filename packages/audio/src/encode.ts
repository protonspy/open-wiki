import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
 * `compress.ts` and `adr:0017-one-compressed-clock-for-both-tracks`.
 *
 * **The cut is `atrim` plus `concat`, not `aselect`.** `aselect` is the shorter
 * recipe and it is a *frame* selector: it evaluates its expression once per
 * decoded frame and passes or drops the whole frame, so every boundary is
 * quantised to about 21 ms and — because `between` is inclusive at both ends —
 * quantised *outward* every time. The error is signed rather than random, so
 * two hundred cuts in an hour-long meeting leave the file seconds longer than
 * the map says it is, with every instant after the first cut naming audio
 * progressively earlier than the one it points at. `atrim` cuts inside a frame,
 * and given `start_sample`/`end_sample` it cuts on the exact sample the map was
 * built from.
 */

/** 16 kHz mono is what a transcription model consumes anyway (`adr:0006`). */
export const OUTPUT_SAMPLE_RATE = 16_000;
export const OUTPUT_BITRATE = "24k";

/**
 * One output sample, in nanoseconds — 62 500 ns at 16 kHz. Every boundary in
 * the cut list sits on a multiple of this (`snapToSampleGrid` in `compress.ts`),
 * which is what lets the filter be given sample indices and the map be built
 * from the same numbers.
 */
export const SAMPLE_PERIOD_NS = 1_000_000_000 / OUTPUT_SAMPLE_RATE;

/** The output-stream sample index an instant in recorded time lands on. */
export function sampleAt(ns: number): number {
  return Math.round(ns / SAMPLE_PERIOD_NS);
}

/**
 * The filtergraph that keeps only the wanted stretches.
 *
 * Resampling happens once, before the split, so the branches carry 16 kHz mono
 * rather than 48 kHz stereo — the difference is what ffmpeg has to buffer while
 * `concat` works through the branches in order. `asetpts` restamps each piece;
 * without it the removed gaps come back as silence and nothing was saved.
 */
export function trimConcatFilter(keeps: readonly Interval[]): string {
  const n = keeps.length;
  const splits = keeps.map((_, i) => `[s${i}]`).join("");
  const lines = [
    `[0:a]aresample=${OUTPUT_SAMPLE_RATE},` +
      `aformat=sample_fmts=s16:channel_layouts=mono,asplit=${n}${splits};`,
  ];
  for (const [i, keep] of keeps.entries()) {
    lines.push(
      `[s${i}]atrim=start_sample=${sampleAt(keep.startNs)}:` +
        `end_sample=${sampleAt(keep.endNs)},asetpts=N/SR/TB[a${i}];`,
    );
  }
  const inputs = keeps.map((_, i) => `[a${i}]`).join("");
  lines.push(`${inputs}concat=n=${n}:v=0:a=1[out]`);
  return lines.join("\n");
}

/**
 * The ffmpeg invocation that produces one track's Opus.
 *
 * The filter arrives as a *file* rather than an argument. An hour of meeting
 * with a few hundred pauses builds a graph in the tens of kilobytes, and
 * Windows caps a command line at about 32 000 characters — a limit that would
 * be hit by exactly the long recordings this pipeline exists for, and only by
 * those.
 */
export function encodeArgs(input: string, output: string, filterScript: string | null): string[] {
  return [
    "-hide_banner",
    "-nostats",
    "-y",
    "-i",
    input,
    ...(filterScript ? ["-filter_complex_script", filterScript, "-map", "[out]"] : []),
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
 * altogether: there is nothing to select, and a graph that selects everything
 * is a way to get the arithmetic wrong for no gain.
 *
 * The filter script is written to a temporary directory rather than beside the
 * output. `raw/<id>/` is frozen once written (`adr:0011`), a leftover file
 * there reads as part of an immutable source, and a predictable path next to
 * the output is one a pre-planted symlink can redirect.
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
  const dir = mkdtempSync(join(tmpdir(), "ow-filter-"));
  const script = join(dir, "filter.txt");
  writeFileSync(script, trimConcatFilter(keeps), { encoding: "utf8", flag: "wx" });
  try {
    await runOrThrow(run, encodeArgs(input, output, script));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// `Duration: 00:41:07.23`, which ffmpeg prints for any input it can open.
const DURATION = /Duration:\s*(\d+):(\d{2}):(\d{2})\.(\d{1,3})/;

/**
 * How long a file actually turned out to be, or `null` when ffmpeg said
 * nothing about it.
 *
 * Asking ffmpeg to open a file with no output named makes it print the stream
 * information and exit non-zero, which is why this does not go through
 * `runOrThrow` — the failure *is* the invocation.
 */
export async function probeDurationNs(run: FfmpegRunner, file: string): Promise<number | null> {
  const result = await run(["-hide_banner", "-i", file]);
  const m = DURATION.exec(result.stderr);
  if (!m) return null;
  const fraction = m[4]!.padEnd(3, "0");
  const ms = (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + Number(fraction);
  return ms * 1_000_000;
}
