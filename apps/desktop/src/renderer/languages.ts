import type { Language } from "@open-wiki/access";

/**
 * The content languages 8.12 ships, in one place.
 *
 * Shared because two screens ask the same question — the launcher at onboarding,
 * the settings screen afterwards — and a list written out twice becomes two
 * answers to one question the moment a fourth language is added.
 *
 * The values are the `Language` union itself, so a language added to the setting
 * and forgotten here is a compile error rather than a picker missing an option.
 */
export const LANGUAGES: ReadonlyArray<{ value: Language; label: string }> = [
  { value: "en", label: "English" },
  { value: "pt-BR", label: "Brazilian Portuguese" },
  { value: "es", label: "Spanish" },
];

/** What a project starts in when nobody chose — `adr:0008`. */
export const DEFAULT_LANGUAGE: Language = "en";

/**
 * What `<html lang>` should say (uxpass 4.4).
 *
 * `index.html` hard-wires `en` while a project's content language may be `pt-BR`
 * or `es` — so a screen reader pronounces Portuguese prose with English
 * phonemes, which is not an accent but an unintelligible one. The wiki is the
 * overwhelming majority of the text in this window, so the document's language
 * is the project's.
 *
 * Anything unrecognised falls back rather than being passed through: `lang`
 * takes a BCP-47 tag, and a value from `ow.json` is a value somebody typed.
 */
export function htmlLang(language: string | null | undefined): string {
  return LANGUAGES.some((known) => known.value === language)
    ? (language as Language)
    : DEFAULT_LANGUAGE;
}
