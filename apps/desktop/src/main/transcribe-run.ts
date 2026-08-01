import { existsSync } from "node:fs";
import { join } from "node:path";
import { readManifest, transcriptionInputs } from "@open-wiki/access";
import { defaultAppDataDir, readSecrets } from "@open-wiki/access/secrets";
import {
  createProvider,
  finishRecording,
  preprocessRecording,
  readJournal,
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

export interface TranscribeDeps {
  run?: FfmpegRunner;
  appDataDir?: string;
}

export type TranscribeOutcome =
  { ok: true; done: number; total: number; sealed: boolean } | { ok: false; reason: string };

export async function runTranscription(
  projectRoot: string,
  id: string,
  onProgress?: (done: number, total: number) => void,
  deps: TranscribeDeps = {},
): Promise<TranscribeOutcome> {
  const dir = sourceDir(projectRoot, id);
  const manifest = readManifest(projectRoot, id);
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
    let map: TimeMap;
    const existing = join(dir, TIMEMAP_FILE);
    if (existsSync(existing)) {
      map = JSON.parse(readFileSync(existing, "utf8")) as TimeMap;
    } else {
      map = await preprocessRecording(run, dir);
    }

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
      ...(onProgress ? { onProgress } : {}),
    });

    // Finish either way. A part-done run still gets a timeline, which is what
    // makes "what is missing" visible on the sources screen; `text.md` and the
    // seal wait for a complete journal, which `finishRecording` decides.
    const finished = finishRecording(projectRoot, id, journal, map, {
      title: manifest.title,
    });
    const done = journal.chunks.filter((c) => c.done).length;
    return { ok: true, done, total: journal.chunks.length, sealed: finished.seal.sealed };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** How far a recording got, for the button's label (plan 6.3). */
export function transcriptionProgress(
  projectRoot: string,
  id: string,
): { done: number; total: number } | null {
  const journal = readJournal(sourceDir(projectRoot, id));
  if (!journal) return null;
  return {
    done: journal.chunks.filter((c) => c.done).length,
    total: journal.chunks.length,
  };
}
