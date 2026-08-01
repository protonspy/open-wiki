import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where ffmpeg is, and how it is run (plan 4.6).
 *
 * The binary is bundled with the installer and never downloaded at run time
 * (`scripts/fetch-ffmpeg.mjs`, `docs/stack.md`), so locating it is a matter of
 * looking in the two places it can be rather than searching.
 *
 * **Everything above this file talks to a `FfmpegRunner`, never to `spawn`.**
 * That is the same seam the recorder put under `CaptureSource`, and for the
 * same reason: CI has no ffmpeg and no audio device, so the arithmetic that
 * decides where a citation points has to be testable without either. What a
 * fake runner cannot prove is that ffmpeg accepts the arguments we build — that
 * is what the manual checks group 4 calls for are for.
 */

export interface FfmpegResult {
  code: number;
  /** ffmpeg writes its whole log to stderr, including `silencedetect`. */
  stderr: string;
  stdout: string;
}

export type FfmpegRunner = (args: readonly string[]) => Promise<FfmpegResult>;

export class FfmpegMissingError extends Error {
  constructor(looked: readonly string[]) {
    super(
      `ffmpeg was not found. It ships with the installer; in a checkout run ` +
        `\`node scripts/fetch-ffmpeg.mjs\`. Looked in:\n  ${looked.join("\n  ")}`,
    );
    this.name = "FfmpegMissingError";
  }
}

export class FfmpegFailedError extends Error {
  constructor(
    readonly code: number,
    readonly stderr: string,
  ) {
    // The tail, not the whole log: ffmpeg prints its build configuration first
    // and the actual reason last, and a message that leads with the banner
    // hides the one line the reader needs.
    super(`ffmpeg exited ${code}\n${tail(stderr, 20)}`);
    this.name = "FfmpegFailedError";
  }
}

/** The last `lines` lines of `text`, for an error message. */
export function tail(text: string, lines: number): string {
  const all = text.split(/\r?\n/);
  return all.slice(Math.max(0, all.length - lines)).join("\n");
}

/**
 * The bundled ffmpeg's path.
 *
 * `OPEN_WIKI_FFMPEG` wins so a developer can point at a build they already
 * have; otherwise it is `vendor/ffmpeg/ffmpeg.exe` at the repository root. The
 * `PATH` is deliberately not consulted: a product that verifies the SHA256 of
 * its own download must not silently run whichever ffmpeg a machine happens to
 * have on it.
 */
export function resolveFfmpeg(repoRoot = defaultRepoRoot()): string {
  const looked: string[] = [];
  const override = process.env["OPEN_WIKI_FFMPEG"];
  if (override) {
    if (existsSync(override)) return override;
    looked.push(`${override} (OPEN_WIKI_FFMPEG)`);
  }
  const vendored = join(repoRoot, "vendor", "ffmpeg", "ffmpeg.exe");
  if (existsSync(vendored)) return vendored;
  looked.push(vendored);
  throw new FfmpegMissingError(looked);
}

/** `packages/audio/src` → the repository root. */
function defaultRepoRoot(): string {
  return resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
}

/**
 * Run ffmpeg once and collect its output.
 *
 * It never rejects on a non-zero exit — the caller decides, because
 * `silencedetect` runs against `-f null -` and a probe that found nothing is
 * not a failure. It rejects only when the process could not be started at all.
 */
export function spawnFfmpeg(exe: string): FfmpegRunner {
  return (args) =>
    new Promise<FfmpegResult>((resolvePromise, rejectPromise) => {
      const child = spawn(exe, [...args], { windowsHide: true });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
      child.on("error", rejectPromise);
      child.on("close", (code) => resolvePromise({ code: code ?? -1, stderr, stdout }));
    });
}

/** Run ffmpeg and throw unless it exited zero. */
export async function runOrThrow(
  run: FfmpegRunner,
  args: readonly string[],
): Promise<FfmpegResult> {
  const result = await run(args);
  if (result.code !== 0) throw new FfmpegFailedError(result.code, result.stderr);
  return result;
}
