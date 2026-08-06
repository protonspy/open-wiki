# Changelog

What changed in the wiki, newest first.

## 2026-08-06

- Moved every page into `wiki/pages/`, leaving `index.md` and `changelog.md` one
  level up in `docs/wiki/`. Pages are content; the index and changelog are the wiki's
  fixed documents, and keeping them out of `pages/` is what lets the validator tell
  one from the other without matching filenames. Wikilinks are unaffected — the slug
  is the filename, never the path, so `[[what-a-harness-loads]]` still resolves to
  `pages/what-a-harness-loads.md`. `scc` v0.13.0 enforces the split (`wiki.legacy-page`
  for any page left at the top level); the skills, `knowledge-base.md` rule, and
  `CLAUDE.md` layout were updated to match.

## 2026-08-03

- Recorded in [[what-a-harness-loads]] that **Claude Code reads a project's hooks from
  `.claude/settings.json`, never from `.claude/hooks/hooks.json`** — that path is a plugin's
  mechanism only. `ow init` wrote the second one from plan 9.5 onward, so the write gate was
  never installed and every run reported that it was. Found by a code review asking for the
  citation behind a profile field; [[claude-code-plugins]] had the plugin half right since
  2026-07-31 and the project half was never checked. Fixed in the same branch, along with
  refusing to overwrite a settings file this product does not own.
- Revised [[what-a-harness-loads]] for task 2.1, and **it corrected the page the same way
  the page had just corrected the plan**. Recording a convention directory for Claude Code
  and none for the others read as "only Claude Code has skills", and `adr:0024` wrote a
  branch for that. All three read a project-local `SKILL.md`: `.claude/skills`,
  `.codex/skills` — plus `.agents/skills`, the harness-neutral location this product
  deliberately does not write to — and `.opencode/skills`. Also recorded: Codex reads
  `.codex/hooks.json` beside the TOML hook form, so two of the three gates are a JSON hook
  file and only opencode's is a plugin. **An unrecorded capability reads as a missing one**,
  which is the failure mode of a findings page and is now said on the page itself.
- Added [[what-a-harness-loads]], read from each harness own source for task 1.1 of
  `plans/harness-portability.md`. It carries two findings that reach the plan. **The gate
  does not degrade**: Codex has `PreToolUse` with `should_block` and names `apply_patch` in
  the blocked path, and opencode can refuse through `permission.ask` — what varies is the
  mechanism, not whether one exists. And **two of the three read `CLAUDE.md`**, so a project
  scaffolded for more than one harness can load the same convention twice under two names.

## 2026-08-01

- Updated [[claude-code-plugins]] for the CLI's published name. npm refused `open-wiki` as
  too similar to the existing `openwiki`, so the registry entry is `@protonspy/open-wiki`
  and the `npx` invocations name the scope. The plugin, the installer and the MCP server
  keep the unscoped name — only the registry ever sees the scope.
- Revised [[claude-code-plugins]] against `adr:0013-the-project-directory-is-the-unit`.
  Its `headersHelper` finding no longer applies to this product — a stdio server has no
  headers and no token — and it gains what a plugin *cannot* carry: permission rules and
  `additionalDirectories`. That absence is what stops the product from shipping the deny
  rule its write gate may need.
- The page also records the hook mechanics the write gate rests on: a `PreToolUse` hook
  receives the tool's complete `tool_input`, can deny with a reason, and can replace the
  arguments with `updatedInput` — so a malformed page can be refused before it lands, and a
  page missing an automatic field can be completed before it lands.
- Both of those were recorded wrongly first, in opposite directions, and
  `adr:0013-the-project-directory-is-the-unit` was drafted against each wrong version in
  turn. What the hook contract permits is now a thing to read rather than infer, and the
  hooks reference joins this page's sources.

## 2026-07-31

- The project is **open-wiki**, not project-wiki. Renamed throughout, including
  `plans/open-wiki.md` and the `@open-wiki/*` package scope.
- Added [[claude-code-plugins]], distilled from the Claude Code plugin, marketplace and
  MCP references. It carries one finding that reaches the plan: an HTTP MCP server in a
  plugin can generate its own auth headers at connection time, which removes the pasted
  token of what was then task 9.13. (That finding was voided a day later, along with the
  token itself — see the entry above.)
- Started the wiki with `index.md` and this file.
