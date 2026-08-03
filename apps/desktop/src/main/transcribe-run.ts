import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  readManifest,
  readSettings,
  transcriptionInputs,
  withdrawProcessed,
} from "@open-wiki/access";
import { defaultAppDataDir, readSecrets } from "@open-wiki/access/secrets";
import {
  createProvider,
  finishRecording,
  preprocessRecording,
  isTimeMap,
  resolveFfmpeg,
  spawnFfmpeg,
  transcribeRecording,
  TIMEMAP_FILE,
  type FfmpegRunner,
  type Journal,
  type TimeMap,
} from "@open-wiki/audio";
import { readFileSync } from "node:fs";
import { sourceDir } from "@open-wiki/audio";

/**
 * Running a transcription (plan 6.3), which is the one thing group 4 built and
 * nothing could start.
 *
 * **It is here because this is where the credential is.** 4.15 left the wiring
 * deliberately unbuilt: `config/secrets.ts` says the CLI, the hooks and the
 * MCP process must not read the Groq key, so the orchestrator that does had to
 * be the desktop application — and it needed 8.3 to have stored one.
 *
 * The order is group 4's, unchanged: preprocess if it has not been, transcribe
 * what the journal says is left, then finish — timeline, VTT, `text.md`, and
 * the seal that discards the WAV only once every chunk succeeded.
 */

export interface TranscribeOptions {
  /** Throw away a journal that no longer matches, rather than refusing (4.17). */
  restart?: boolean;
}

export interface TranscribeDeps {
  run?: FfmpegRunner;
  appDataDir?: string;
}

export type TranscribeOutcome =
  { ok: true; done: number; total: number; sealed: boolean } | { ok: false; reason: string };

export async function runTranscription(
  projectRoot: string,
  id: string,
  options: TranscribeOptions = {},
  deps: TranscribeDeps = {},
): Promise<TranscribeOutcome> {
  // Inside the outcome type, not thrown past it. An id that escapes `raw/`
  // and a missing manifest were the two failures that rejected the promise
  // while every other one came back as a `TranscribeOutcome` — a caller
  // reading the union would believe rejection was impossible.
  let dir: string;
  let manifest: ReturnType<typeof readManifest>;
  try {
    dir = sourceDir(projectRoot, id);
    manifest = readManifest(projectRoot, id);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  if (manifest.kind !== "recording") {
    return { ok: false, reason: `"${id}" is a file, not a recording` };
  }

  const secrets = readSecrets(projectRoot, deps.appDataDir ?? defaultAppDataDir());
  if (!secrets?.stt) {
    return {
      ok: false,
      reason: "no transcription provider is configured yet — set one in Settings",
    };
  }

  let run: FfmpegRunner;
  try {
    run = deps.run ?? spawnFfmpeg(resolveFfmpeg());
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }

  try {
    // Preprocess only if it has not happened. `timemap.json` is the record
    // that it did — re-encoding would move every instant a citation names.
    const map = await mapFor(run, dir);

    const provider = createProvider({
      provider: secrets.stt.provider,
      ...(secrets.stt.apiKey ? { apiKey: secrets.stt.apiKey } : {}),
    });
    const inputs = transcriptionInputs(projectRoot);

    const journal: Journal = await transcribeRecording({
      dir,
      provider,
      language: inputs.language,
      vocabulary: inputs.vocabulary,
      map,
      run,
      // 4.17 refuses a journal that no longer describes the same work and says
      // "start again from the beginning, or put the previous settings back".
      // Without this the caller could not take the first half of that offer,
      // so changing the content language mid-recording left a permanently
      // unfinishable transcription and its 690 MB WAV.
      ...(options.restart ? { restart: true } : {}),
    });

    // Finish either way. A part-done run still gets a timeline, which is what
    // makes "what is missing" visible on the sources screen; `text.md` and the
    // seal wait for a complete journal, which `finishRecording` decides.
    // The project's own setting, which was being ignored — so a user who
    // chose to keep their WAVs lost ~690 MB per hour of "the only copy of a
    // meeting that already happened" anyway, which is the loss `adr:0006`
    // and `adr:0012` are entirely about.
    const finished = finishRecording(projectRoot, id, journal, map, {
      title: manifest.title,
      deleteWav: readSettings(projectRoot).deleteWavAfterTranscription,
    });
    // The transcript is new material about this source, so a declaration made
    // before it landed was made about a recording that did not yet say any of
    // this (`specs/source-status`, R3.1). `writeSourceText` withdraws on the
    // upload door; this is the other door, because `finishRecording` writes
    // `text.md` through `@open-wiki/audio` and that package deliberately does
    // not depend on `@open-wiki/access`. Same function, called from the side
    // that already imports both.
    if (finished.textReady) withdrawProcessed(projectRoot, id);

    const done = journal.chunks.filter((c) => c.done).length;
    return { ok: true, done, total: journal.chunks.length, sealed: finished.seal.sealed };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The recording's time map: read if it is there, produced if it is not.
 *
 * **Read through `isTimeMap`, never cast.** `timemap.json` is committed by
 * design — the managed gitignore covers the audio and `.state/`, not this —
 * so it arrives with a clone, and `{}` casts to `TimeMap` as happily as a
 * real map does. What flows out of here decides how many paid provider
 * requests one click makes, and what wall-clock instant every citation of this
 * recording resolves to.
 *
 * A map that does not check out is treated as *absent*, so the recording is
 * preprocessed again and the map is rebuilt from the audio. That is safe in a
 * way overwriting silently is not: `preprocessRecording` refuses to write a
 * map that disagrees with the file it describes.
 */
async function mapFor(run: FfmpegRunner, dir: string): Promise<TimeMap> {
  const file = join(dir, TIMEMAP_FILE);
  if (existsSync(file)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (isTimeMap(parsed)) return parsed;
    } catch {
      // Unreadable reads as absent, for the same reason.
    }
  }
  return preprocessRecording(run, dir);
}
