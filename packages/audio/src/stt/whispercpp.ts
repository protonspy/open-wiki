import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  SttError,
  vocabularyPrompt,
  WAV_16K,
  type SttProvider,
  type SttRequest,
  type SttResult,
  type SttSegment,
} from "./provider.js";

/**
 * whisper.cpp — the optional local provider, "for anyone who requires that the
 * audio never leave the machine" (`docs/stack.md`).
 *
 * It is a subprocess rather than a request, and it needs no credential at all,
 * which is the whole point: choosing it is how a user opts out of the one
 * place this product talks to a third party.
 *
 * The binary and the model are not bundled. They are large, they are a
 * per-user choice of size against accuracy, and the installer already carries
 * ffmpeg and `recorder.exe`. So this refuses clearly when they are absent
 * rather than degrading to the provider the user chose *not* to use.
 */

export type SpawnLike = (
  exe: string,
  args: readonly string[],
) => Promise<{ code: number; stderr: string }>;

export interface WhisperCppOptions {
  /** The `whisper-cli` executable. */
  exe: string;
  /** The GGML model file. Recorded in the journal, so a swap refuses a resume. */
  modelPath: string;
  run: SpawnLike;
}

export class WhisperCppMissingError extends Error {
  constructor(what: string, path: string) {
    super(
      `whisper.cpp's ${what} is not at ${path}. The local provider is not bundled — ` +
        `install it and point the setting at it, or use the Groq provider.`,
    );
    this.name = "WhisperCppMissingError";
  }
}

/** whisper.cpp's `-oj` output: offsets are milliseconds from the file's start. */
interface WhisperJson {
  transcription?: Array<{
    offsets?: { from?: number; to?: number };
    text?: string;
  }>;
}

export function createWhisperCppProvider(options: WhisperCppOptions): SttProvider {
  if (!existsSync(options.exe)) throw new WhisperCppMissingError("executable", options.exe);
  if (!existsSync(options.modelPath)) throw new WhisperCppMissingError("model", options.modelPath);

  return {
    name: "whispercpp",
    // The model file's name, not its path: the path is somebody's home
    // directory, and this string goes into a journal committed nowhere but
    // read by 4.17 to decide whether a resume is the same work.
    model: basenameOf(options.modelPath),
    audioFormat: WAV_16K,

    async transcribe(request: SttRequest): Promise<SttResult> {
      const dir = mkdtempSync(join(tmpdir(), "ow-whisper-"));
      // `basename`, because `filename` is documented as "the name the provider
      // sees" and this is an exported provider: nothing here should depend on
      // a numeric guard in a different file to know it is not a path.
      const input = join(dir, basename(request.filename));
      const outputStem = join(dir, "out");
      try {
        writeFileSync(input, request.audio);
        const args = [
          "-m",
          options.modelPath,
          "-f",
          input,
          "-l",
          request.language.split("-")[0]!.toLowerCase(),
          "-oj",
          "-of",
          outputStem,
        ];
        const prompt = vocabularyPrompt(request.vocabulary);
        if (prompt) args.push("--prompt", prompt);

        const result = await options.run(options.exe, args);
        if (result.code !== 0) {
          // A local run that failed will fail again on the same input, so the
          // journal should record it rather than the pipeline spinning on it.
          throw new SttError(`whisper.cpp exited ${result.code}: ${result.stderr}`, false);
        }
        const file = `${outputStem}.json`;
        if (!existsSync(file)) {
          throw new SttError("whisper.cpp wrote no transcription", false);
        }
        return parseWhisperJson(JSON.parse(readFileSync(file, "utf8")) as WhisperJson);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

function basenameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

const NS_PER_MS = 1_000_000;

export function parseWhisperJson(body: WhisperJson): SttResult {
  const segments: SttSegment[] = [];
  for (const raw of body.transcription ?? []) {
    const text = (raw.text ?? "").trim();
    if (!text) continue;
    const from = raw.offsets?.from ?? 0;
    segments.push({
      startNs: from * NS_PER_MS,
      endNs: (raw.offsets?.to ?? from) * NS_PER_MS,
      text,
    });
  }
  return {
    segments,
    text: segments
      .map((s) => s.text)
      .join(" ")
      .trim(),
  };
}
