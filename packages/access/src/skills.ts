import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The convention ships as skills scaffolded into the project's `.claude/skills/`
 * — one for **wiki** and one for **codewiki** — and writes neither if it is
 * already there (`adr:0015-the-convention-ships-as-skills`). A plugin may carry
 * the scaffolding command but never the skills themselves: two copies of one
 * convention, updated by different mechanisms, is the drift this avoids.
 *
 * The `open-wiki-version` frontmatter marker lets `ow init` report staleness
 * instead of overwriting — the open question in that record.
 */
export const SKILLS_VERSION = "0.1.0";

const WIKI_SKILL = `---
name: wiki
description: Build and maintain the project's wiki/ — one page per entity, linked with wikilinks and reachable from index.md. Use it when a source lands in raw/ and has to be distilled into a page, and when ow check reports a broken wikilink, an orphan, or a source no page cites.
open-wiki-version: ${SKILLS_VERSION}
---

You own \`wiki/\`: the durable half of what this project knows. \`raw/\` holds the
sources; this is where they become knowledge that outlasts the meeting or the
document that produced it.

The application does not write these pages — you do, with your own tools. It
validates what you write: a page that breaks the schema is refused or flagged.
The format below is the contract.

## A page

Every entity page is markdown with YAML frontmatter:

    ---
    id: project:fenix
    type: project
    title: Fenix
    status: active
    aliases: [fenix platform]
    updated: 2026-07-31
    sources: [src://arquitetura-fenix.pdf#p12]
    superseded-by: ""
    ---

- **id** is \`type:slug\` — \`project:fenix\`, \`person:ana\`, \`topic:checkout\`,
  or a codewiki area. The filename is the slug.
- **type** is \`project\`, \`person\`, \`topic\` or a codewiki page.
- **status** is \`active\` unless the page is superseded, when it is
  \`superseded\` and \`superseded-by\` names the replacement.
- **sources** lists the provenance links this page rests on.

\`index.md\`, \`changelog.md\` and \`log.md\` are not entity pages; they are
themselves and are not validated against this schema.

## A claim

A page holds claims. Every claim cites where it came from, with a provenance
link:

- \`src://arquitetura-fenix.pdf#p12\` — a document, at a page.
- \`rec://fenix-weekly-2026-07-31#14:32\` — a recording, at an instant.

A citation that opens nothing is worse than none. If you cannot point at a
source, the claim does not go in.

## Supersession

When a decision is replaced, mark the old page — never delete it:

- set \`status: superseded\`, \`superseded-by: project:fenix-2\`, and the date in
  \`updated\`;
- strike through the replaced prose with the same date and a link to the
  replacement.

The data fields are what \`ow graph superseded\` walks; the prose is what a
reader sees. Both, or it is not supersession.

## Ingest — a source landed in raw/

1. Read the source completely before writing anything. A page distilled from a
   skim looks authoritative and is not.
2. One page per concept. A source covering three concepts becomes three pages
   or three edits, not a mirror of the source.
3. Check the glossary; use the canonical term.
4. Write the page at \`wiki/<slug>.md\`, link it from \`index.md\`, record it in
   \`changelog.md\`.
5. Run \`ow check\`.
`;

const CODEWIKI_SKILL = `---
name: codewiki
description: Narrate an area of this project's code in wiki/codewiki/, where every section cites the exact lines it explains. Use it when a subsystem is hard to enter cold and the code does not say why it is shaped that way, and when ow check reports a codewiki citation that no longer resolves.
open-wiki-version: ${SKILLS_VERSION}
---

\`codewiki/\` is prose that explains code, one page per area, with every section
citing the exact lines it is about:

    ## How the dispatcher routes

    [packages/cli/src/dispatch.ts:48-64]()

    One switch, no registration...

A citation that no longer resolves is a finding, so this is the part of the
wiki that goes stale loudly rather than quietly. **Every section cites
something** — a section that cites nothing is prose that has drifted free of
the code it describes.

Write it for the parts where reading the code does not tell you *why* it is
like that. Do not narrate what a reader can see.
`;

const SKILLS: ReadonlyArray<{ dir: string; content: string }> = [
  { dir: "wiki", content: WIKI_SKILL },
  { dir: "codewiki", content: CODEWIKI_SKILL },
];

/**
 * Scaffolds the wiki and codewiki skills into the project's `.claude/skills/`,
 * overwriting nothing already there. Returns what it wrote and what it skipped.
 */
export function scaffoldSkills(projectRoot: string): {
  written: string[];
  skipped: string[];
} {
  const written: string[] = [];
  const skipped: string[] = [];
  for (const skill of SKILLS) {
    const file = join(projectRoot, ".claude", "skills", skill.dir, "SKILL.md");
    if (existsSync(file)) {
      skipped.push(skill.dir);
      continue;
    }
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, skill.content, "utf8");
    written.push(skill.dir);
  }
  return { written, skipped };
}
