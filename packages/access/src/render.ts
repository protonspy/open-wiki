import { CODEWIKI_SKILL_BODY, WIKI_SKILL_BODY } from "./skills.js";
import type { Language } from "./config/settings.js";
import {
  entryFilesFor,
  harnessesSharingEntryFile,
  profilesFor,
  type Harness,
  type HarnessProfile,
} from "./harness.js";

/**
 * One template set, three renderings (plan `harness-portability.md` 2.2).
 *
 * `adr:0024-the-convention-ships-to-every-harness` decided the convention
 * ships to every harness a project is scaffolded for, from one source, through
 * a profile that is data. This is the renderer: it takes profiles and returns
 * `path -> content`, and it writes nothing. Keeping the rendering separate from
 * the writing is what lets 2.2 assert over *every* rendered byte without a
 * temporary directory, and what gives 5.1 something to hash a file against.
 *
 * **The failure this is shaped around is silent.** A skill that tells a Codex
 * user to look in `.claude/` is valid markdown, raises nothing, and simply
 * never gets read — which is the exact bug the whole plan exists to end,
 * reproduced one level up. Hence 2.2 is `(TDD)` and its central assertion is
 * negative and exhaustive.
 */

const LANGUAGE_LABEL: Record<Language, string> = {
  en: "English",
  "pt-BR": "Brazilian Portuguese",
  es: "Spanish",
};

/**
 * The skill bodies, read at call time rather than at module load.
 *
 * `skills.ts` imports `renderSkills` from here and this imports the bodies from
 * there, which is a cycle ESM resolves only if neither side *reads* the other's
 * bindings while the modules are still initialising. A module-level table would
 * read them during initialisation and hit the temporal dead zone, depending on
 * which of the two a caller happened to import first — a failure that shows up
 * as `undefined` in one entrypoint and not another.
 */
function skillBodies(): ReadonlyArray<{ name: string; body: string }> {
  return [
    { name: "wiki", body: WIKI_SKILL_BODY },
    { name: "codewiki", body: CODEWIKI_SKILL_BODY },
  ];
}

/**
 * The skills for one harness, at that harness's own paths.
 *
 * All three read `SKILL.md` from a project-local directory, so this is one
 * shape at three addresses rather than three formats — the plan expected
 * otherwise and the sources said so. The bodies are identical across harnesses
 * by construction: there is one convention, and three copies of it maintained
 * separately is the drift `adr:0015` and `adr:0024` both refuse.
 */
export function renderSkills(profile: HarnessProfile): Record<string, string> {
  const files: Record<string, string> = {};
  for (const skill of skillBodies()) {
    files[`${profile.skillsDir}/${skill.name}/SKILL.md`] = skill.body;
  }
  return files;
}

/**
 * The generated entry files for a set of harnesses.
 *
 * Keyed by filename rather than by harness, because **Codex and opencode both
 * read `AGENTS.md`**: a project carrying both gets one file serving two
 * harnesses, not two files racing to be last. That collision is decided here
 * rather than discovered, which is what `adr:0024` asked for.
 *
 * The second collision is the interesting one. **opencode reads `CLAUDE.md`
 * too**, so a project carrying Claude Code and opencode would load the whole
 * convention twice in one session under two names. The answer is Claude Code's
 * own: where a repository already has an `AGENTS.md`, its reference gives
 * `@AGENTS.md` in a `CLAUDE.md` as the way to make both tools read one text.
 * So `CLAUDE.md` becomes a pointer whenever an `AGENTS.md` is written beside
 * it, and stays the full file when it is alone.
 */
export function renderEntryFiles(
  profiles: readonly HarnessProfile[],
  language: Language,
): Record<string, string> {
  const files: Record<string, string> = {};
  const names = entryFilesFor(profiles);
  for (const filename of names) {
    const sharing = harnessesSharingEntryFile(profiles, filename);
    const importsInstead = filename === "CLAUDE.md" && names.includes("AGENTS.md");
    files[filename] = importsInstead
      ? entryPointer(sharing)
      : entryFile(sharing, language, filename);
  }
  return files;
}

/** Everything the convention writes for a set of harnesses, as `path -> content`. */
export function renderConvention(
  harnesses: readonly Harness[],
  language: Language = "en",
): Record<string, string> {
  const profiles = profilesFor(harnesses);
  const files: Record<string, string> = {};
  for (const profile of profiles) Object.assign(files, renderSkills(profile));
  Object.assign(files, renderEntryFiles(profiles, language));
  return files;
}

/**
 * The short `CLAUDE.md` written when an `AGENTS.md` carries the convention.
 *
 * It names no skills directory and repeats no rule: the whole point is that
 * there is one text. Claude-Code-specific content would go below the import,
 * and there is none — which is worth saying, because an empty section here
 * would read as a decision rather than as an absence.
 */
function entryPointer(sharing: readonly HarnessProfile[]): string {
  return `# CLAUDE.md

@AGENTS.md

The convention is in \`AGENTS.md\`, which every harness this project is
scaffolded for reads. This file imports it so there is one text rather than two
copies that drift apart.

${skillList(sharing)}
`;
}

/**
 * The full entry file.
 *
 * `sharing` is every harness that reads this filename, which is why the skills
 * are listed per harness: one `AGENTS.md` serving Codex and opencode has to
 * tell each of them where its own skills are, and a file naming only one would
 * silently give the other nothing.
 */
function entryFile(
  sharing: readonly HarnessProfile[],
  language: Language,
  filename: string,
): string {
  return `# ${filename}

This project's wiki is maintained under the open-wiki convention, which lives as
skills scaffolded into this project:

${skillList(sharing)}

Read those skills; they are the convention, and this file does not repeat them.

## Writing a page

${gateParagraph(sharing)}

\`ow write <path> --file <file>\` writes a page through the same store from the
shell, and it is the documented path in **every** regime — not a fallback for
where interception is missing. It is the one path that is the same everywhere.

Do not write pages with your own shell redirection: the store validates the page
schema and fills the fields it owns (\`updated\`, \`sources\`), and a raw write
bypasses all of it.

## Content language

**${LANGUAGE_LABEL[language]}** (configured). Pages are written in this language,
and it is the transcription hint for any audio source. Change it with
\`ow init --language <en|pt-BR|es>\`; this file is regenerated because it is
generated, and the skills are not.
`;
}

/**
 * The skills, linked by the path each harness actually reads them from.
 *
 * A path rather than a name, because the entry file's whole job is to send a
 * reader to the convention and a name is not a route. Where one file serves two
 * harnesses — Codex and opencode share `AGENTS.md` — each gets its own line:
 * a file naming one harness's directory and not the other's would give the
 * second nothing, which is this plan's original bug at one remove.
 */
function skillList(sharing: readonly HarnessProfile[]): string {
  const link = (dir: string, name: string) => `[${name}](${dir}/${name}/SKILL.md)`;
  if (sharing.length === 1) {
    const dir = sharing[0]!.skillsDir;
    return [
      `- the ${link(dir, "wiki")} skill — building and maintaining \`wiki/\``,
      `- the ${link(dir, "codewiki")} skill — narrated code in \`wiki/codewiki/\``,
    ].join("\n");
  }
  return sharing
    .map(
      (p) => `- **${p.label}** — ${link(p.skillsDir, "wiki")} · ${link(p.skillsDir, "codewiki")}`,
    )
    .join("\n");
}

/**
 * The harnesses whose gate this build actually installs.
 *
 * **Offering an interception and having one installed are different facts, and
 * conflating them is how a convention file comes to lie.** `writeHooks` writes
 * `.claude/hooks/hooks.json` and nothing else; `.codex/hooks.json` and
 * opencode's plugin are task 3.1 and do not exist yet. The profile's `gate`
 * says what the *harness* can do — which is why it is non-null for all three —
 * and this says what *this build* has put on disk.
 *
 * Group 3.1 extends this list in the same commit that starts writing those
 * files. It is one line so that the text and the fact cannot drift.
 */
export const GATES_INSTALLED: readonly Harness[] = ["claude", "codex", "opencode"];

/**
 * What this project's write gate is, in the words of the profile.
 *
 * `adr:0024` requires the regime *stated*, per harness, in the convention text:
 * a user who believes they are protected and is not is worse off than one who
 * knows they are not. That cuts both ways, and the second way is the one that
 * caught this function out — **a harness whose gate is not installed yet must
 * not be described as though it were.** Saying "a PreToolUse hook refuses a bad
 * page" in a Codex project's `AGENTS.md` while nothing writes `.codex/hooks.json`
 * is precisely the sentence that rule forbids, written by the code the rule is
 * quoted in.
 */
function gateParagraph(sharing: readonly HarnessProfile[]): string {
  const lines = sharing.map((p) => {
    if (p.gate && GATES_INSTALLED.includes(p.id)) {
      return p.gate.completes
        ? `- **${p.label}** — ${p.gate.describes}. A page that breaks the schema is refused with a reason, and one that is merely incomplete is completed: the store fills the fields it owns before the write lands.`
        : `- **${p.label}** — ${p.gate.describes}. **It refuses; it does not complete.** What it is handed carries no page content it could fill in — a patch, or a path — so a direct edit under \`wiki/\` is denied and the denial says this. Write pages with \`ow write <path> --file <file>\`, which validates and completes them.`;
    }
    if (p.gate) {
      return `- **${p.label}** — **no gate is installed yet.** This harness can refuse a write (${p.gate.configFile}), and this build does not scaffold it. Nothing stops a bad page landing here: write through \`ow write\`, which validates, and \`ow check\` reports what got past.`;
    }
    return `- **${p.label}** — no interception is scaffolded, because this harness offers none. Nothing refuses a bad page before it lands here; \`ow check\` reports it afterwards.`;
  });
  return `Pages you write to \`wiki/\` go through a write gate installed by \`ow init\` —
and what that gate is depends on the harness:

${lines.join("\n")}`;
}

export { LANGUAGE_LABEL };
