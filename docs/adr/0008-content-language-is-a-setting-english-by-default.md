---
status: accepted
---

# 0008 · The content language is a setting, English by default

## Context

The product's content is written in a human language: the wiki pages, and the
transcription the pages are built from. The plan used to fix that language as Brazilian
Portuguese, which was a decision made about the first user rather than about the product.

`adr:0003-mcp-as-the-only-bridge-to-the-llm` changes what that decision can even reach.
The application writes no content, so it has exactly two places where a language appears:
the hint sent with a transcription request, and the `CLAUDE.md` generated in the project,
which is what tells the agent the language to write pages in. Everything else the
application produces — frontmatter keys, `type` values, directory names, MCP tool names —
is identifiers, not prose.

So the question is narrow: hard-code one language in those two places, or make it a
setting.

## Decision

The content language is a setting, chosen during onboarding and changeable afterwards.
**English is the default**, with Brazilian Portuguese and Spanish offered alongside it.

It lives in `config.json` as a workspace-wide value — see
`adr:0007-plaintext-credentials-in-the-config` — and reaches exactly the two places above:
the transcription hint, and the generated project `CLAUDE.md`.

**The schema is English regardless of the setting.** Frontmatter keys, the `decision` /
`fact` / `action_item` / `open_question` values, the `raw/` and `wiki/` directory names,
the MCP tool names and the canonical terms in `docs/glossary.md` do not translate. They
are names a program compares, and translating them would mean a wiki written in Spanish
is not readable by a tool that reads a wiki written in English.

**The setting is workspace-wide, not per project.** A workspace holding projects in
different languages is a second axis nobody has asked for; someone who needs it has a
second workspace, which costs a folder.

## Consequences

An unconfigured install produces English, which is the right default for an open source
project whose repository, schema and glossary are already English. Nobody has to configure
anything to get a coherent result, and the person who needs another language changes one
setting before the first source lands.

Three consequences worth stating plainly:

**The setting is an instruction, not an enforcement.** Group 5 validates form; nothing
checks that a page is written in the configured language. An agent prompted in Portuguese
inside a workspace set to English will write Portuguese pages and every validation will
pass. This is the same weakness as the convention living in prose, and it is the same
answer: the generated `CLAUDE.md` has to be specific, because it is the only place the
instruction exists.

**A source in another language is not a failure.** A Spanish recording in an English
workspace produces a Spanish `text.md`; what the agent then writes is the agent's call.
The application does not translate and does not refuse — refusing would mean detecting the
language of every source, which is a classifier the application has no business owning.

**Three languages, because each one costs a check.** The transcription model is
multilingual and takes no work per language, but the vocabulary seeding of task 4.10 and
someone able to read the output do. Adding a fourth is one value in the setting and one
line in the generated `CLAUDE.md` — cheap. The reverse is not: once workspaces exist in
several languages, going back to one hard-coded language breaks every one of them that is
not in it.
