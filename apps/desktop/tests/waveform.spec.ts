import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FfmpegRunner } from "@open-wiki/audio";
import { forgetWaveforms, peaksFrom, WAVE_COLUMNS, waveformOf } from "../src/main/waveform.js";

/**
 * The waveform behind the provenance transport (plan desktop-ui 5.5).
 *
 * The bucketing is what is tested, because it is the only part a machine
 * without ffmpeg can run — and because an off-by-one in it draws a picture
 * that does not line up with the playhead, which is the one thing this panel
 * exists to get right. That ffmpeg accepts the arguments is a manual check,
 * like every other ffmpeg invocation in this repository.
 */

/** Signed 16-bit mono PCM from a list of amplitudes. */
function pcm(samples: readonly number[]): Buffer {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((value, i) => buffer.writeInt16LE(value, i * 2));
  return buffer;
}

describe("peaksFrom (5.5)", () => {
  it("gives one peak per column", () => {
    expect(peaksFrom(pcm(new Array(5000).fill(1000)), 100)).toHaveLength(100);
  });

  it("takes the loudest sample in a column, not the average", () => {
    // A waveform is a picture of where the loud parts are. Averaging draws a
    // recording of one continuous murmur, which is what a meeting is not.
    const peaks = peaksFrom(pcm([0, 0, 0, 32767]), 1);
    expect(peaks[0]).toBeCloseTo(1, 5);
  });

  it("reads a negative sample as loud as its positive twin", () => {
    expect(peaksFrom(pcm([-20000]), 1)).toEqual(peaksFrom(pcm([20000]), 1));
  });

  it("never exceeds one, even at the negative rail", () => {
    // `Math.abs(-32768)` is 32768, one past the positive maximum — an
    // unclamped ratio would draw a bar taller than the box it is in.
    expect(peaksFrom(pcm([-32768]), 1)[0]).toBe(1);
  });

  it("covers the whole recording, with the last column reaching the end", () => {
    // Boundaries from the column rather than a stride: a stride accumulates
    // rounding and the last column stops short, which is exactly the
    // misalignment the playhead would then show.
    const samples = new Array(1000).fill(0);
    samples[999] = 30000;
    expect(peaksFrom(pcm(samples), 7).at(-1)).toBeGreaterThan(0);
  });

  it("puts a loud passage where it happened", () => {
    const samples = new Array(1000).fill(0);
    for (let i = 500; i < 600; i++) samples[i] = 30000;
    const peaks = peaksFrom(pcm(samples), 10);
    expect(peaks[5]).toBeGreaterThan(0);
    expect(peaks[0]).toBe(0);
    expect(peaks[9]).toBe(0);
  });

  it("has nothing to draw for an empty file", () => {
    expect(peaksFrom(Buffer.alloc(0), 10)).toEqual([]);
  });

  it("draws a column per pixel of the panel by default", () => {
    expect(peaksFrom(pcm(new Array(4000).fill(100)))).toHaveLength(WAVE_COLUMNS);
  });
});

describe("waveformOf (5.5)", () => {
  let root: string;

  beforeEach(() => {
    forgetWaveforms();
    root = mkdtempSync(join(tmpdir(), "ow-wave-"));
    mkdirSync(join(root, "raw", "weekly"), { recursive: true });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function source(kind: "recording" | "file"): void {
    writeFileSync(
      join(root, "raw", "weekly", "manifest.json"),
      JSON.stringify({ id: "weekly", title: "Weekly", kind, original: "" }),
      "utf8",
    );
  }

  /** An ffmpeg that writes the PCM it was asked for, and remembers the call. */
  function fakeFfmpeg(samples: readonly number[], code = 0): { run: FfmpegRunner; args: string[] } {
    const seen: string[] = [];
    const run: FfmpegRunner = async (args) => {
      seen.push(...args);
      const out = args[args.length - 1];
      if (code === 0 && out) writeFileSync(out, pcm(samples));
      return { code, stdout: "", stderr: "" };
    };
    return { run, args: seen };
  }

  it("draws a recording", async () => {
    source("recording");
    const ffmpeg = fakeFfmpeg(new Array(2000).fill(8000));
    const peaks = await waveformOf(root, "weekly", { run: ffmpeg.run, scratch: root });
    expect(peaks).toHaveLength(WAVE_COLUMNS);
    // Mono, and to raw samples: anything else and `peaksFrom` reads a header
    // as audio.
    expect(ffmpeg.args).toContain("s16le");
    expect(ffmpeg.args).toContain("1");
  });

  it("draws a recording that has been filed into a folder (8.3)", async () => {
    // The quietest of the five sites that still joined `raw/<id>`.
    // `readManifest` walked and confirmed `kind: recording`, while the
    // directory beside it was joined and pointed at nothing — so ffmpeg failed
    // and this returned `null`, which is exactly what it returns for "not
    // transcribed yet". A processed recording that never drew a waveform, with
    // nothing able to tell the two cases apart.
    rmSync(join(root, "raw", "weekly"), { recursive: true, force: true });
    mkdirSync(join(root, "raw", "2026", "q3", "weekly"), { recursive: true });
    writeFileSync(
      join(root, "raw", "2026", "q3", "weekly", "manifest.json"),
      JSON.stringify({ id: "weekly", title: "Weekly", kind: "recording", original: "" }),
      "utf8",
    );

    const ffmpeg = fakeFfmpeg(new Array(2000).fill(8000));
    const peaks = await waveformOf(root, "weekly", { run: ffmpeg.run, scratch: root });

    expect(peaks).toHaveLength(WAVE_COLUMNS);
    // The audio it read is the filed one, not a path under `raw/weekly`.
    expect(ffmpeg.args.join(" ")).toContain(join("2026", "q3", "weekly", "mic.opus"));
  });

  it("has nothing to draw for a file source", async () => {
    // A PDF has no sound, and asking ffmpeg about it would be a spawn per
    // citation to be told so.
    source("file");
    const ffmpeg = fakeFfmpeg([]);
    expect(await waveformOf(root, "weekly", { run: ffmpeg.run, scratch: root })).toBeNull();
    expect(ffmpeg.args).toEqual([]);
  });

  it("says nothing rather than failing when there is no audio yet", async () => {
    // A recording that has not been preprocessed has no `mic.opus`. The panel's
    // subject is the citation, and it draws a plain bar instead.
    source("recording");
    expect(
      await waveformOf(root, "weekly", { run: fakeFfmpeg([], 1).run, scratch: root }),
    ).toBeNull();
  });

  it("decodes a recording once, however often it is opened", async () => {
    // Sound in `raw/` is sealed, so a cached answer cannot go stale — and an
    // hour of Opus is not decoded again every time somebody follows a citation.
    source("recording");
    const ffmpeg = fakeFfmpeg(new Array(2000).fill(8000));
    await waveformOf(root, "weekly", { run: ffmpeg.run, scratch: root });
    const after = ffmpeg.args.length;
    await waveformOf(root, "weekly", { run: ffmpeg.run, scratch: root });
    expect(ffmpeg.args.length).toBe(after);
  });

  it("refuses an id that climbs out of raw/", async () => {
    // An id like `../wiki` stays inside the project and is still not a source
    // — the same rule `sourceState` follows, and for the same reason.
    await expect(
      waveformOf(root, "../wiki", { run: fakeFfmpeg([]).run, scratch: root }),
    ).rejects.toThrow();
  });
});
