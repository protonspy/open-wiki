# Changelog

What changed in the wiki, newest first.

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
