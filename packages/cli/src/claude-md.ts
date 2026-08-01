import type { Language } from "@open-wiki/access";

const LANGUAGE_LABEL: Record<Language, string> = {
  en: "English",
  "pt-BR": "Brazilian Portuguese",
  es: "Spanish",
};

/**
 * The short project `CLAUDE.md` (plan 9.4). The convention lives in the skills
 * scaffolded into `.claude/skills/`, so this file points at them and duplicates
 * nothing they say. The one thing it carries that the skills cannot — because
 * it varies per project — is the configured content language. It is
 * regenerated on change because it is generated, and the skills are not
 * (`adr:0015-the-convention-ships-as-skills`).
 */
export function generateClaudeMd(language: Language): string {
  return `# CLAUDE.md

This project's wiki is maintained under the open-wiki convention, which lives as
skills in \`.claude/skills/\`:

- the [wiki](.claude/skills/wiki/SKILL.md) skill — building and maintaining \`wiki/\`
- the [codewiki](.claude/skills/codewiki/SKILL.md) skill — narrated code in \`codewiki/\`

Read those skills; they are the convention, and this file does not repeat them.

Pages you write to \`wiki/\` and \`codewiki/\` go through a write gate installed by
\`ow init\` — a hook that validates the page schema and fills the fields the store
owns (\`updated\`, \`sources\`) before the write lands. A page that breaks the schema
is refused with a reason; fix it and write again. Do not write pages through the
shell — the gate does not reach it, and the store would be bypassed.

## Content language

**${LANGUAGE_LABEL[language]}** (configured). Pages are written in this language,
and it is the transcription hint for any audio source. Change it with
\`ow init --language <en|pt-BR|es>\`; this file is regenerated because it is
generated, and the skills are not.
`;
}