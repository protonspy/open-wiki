import { readSettings, type Language } from "../config/settings.js";
import { projectVocabulary, DEFAULT_VOCABULARY_LIMIT } from "./vocabulary.js";

/**
 * What a transcription needs from the project, minus the credential (plan
 * 4.10 and 4.15).
 *
 * **The credential is deliberately not here.** `config/secrets.ts` says it in
 * as many words: the CLI, the hooks and the MCP process must not read the
 * secret, because their stderr is consumed by an agent and travels to a model
 * provider. Only the desktop application reads it, and it does so at the point
 * it builds the provider. Everything *else* a transcription needs comes out of
 * the project directory and is safe for anything to read — so it lives here,
 * in one call, rather than being re-derived by each caller.
 *
 * The language reaches the provider as the hint
 * (`adr:0008-content-language-is-a-setting-english-by-default`), rather than
 * being left to detection. A provider guessing from the first thirty seconds
 * of a Portuguese meeting that opened with English pleasantries gets it wrong
 * for the whole chunk, and nothing downstream can tell.
 */
export interface TranscriptionInputs {
  language: Language;
  vocabulary: string[];
}

export function transcriptionInputs(
  projectRoot: string,
  vocabularyLimit = DEFAULT_VOCABULARY_LIMIT,
): TranscriptionInputs {
  return {
    language: readSettings(projectRoot).language,
    vocabulary: projectVocabulary(projectRoot, vocabularyLimit),
  };
}
