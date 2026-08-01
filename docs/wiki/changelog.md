# Changelog

What changed in the wiki, newest first.

## 2026-08-01

- Revised [[claude-code-plugins]] against `adr:0013-the-project-directory-is-the-unit`.
  Its `headersHelper` finding no longer applies to this product — a stdio server has no
  headers and no token — and it gains what a plugin *cannot* carry: permission rules and
  `additionalDirectories`. That absence is what stops the product from shipping the deny
  rule its write gate may need.
- The page also records the hook mechanics the write gate rests on: a `PreToolUse` hook
  receives the tool's complete `tool_input` and can deny with a reason, so a malformed page
  can be refused before it lands. A first pass through this recorded the opposite, and
  `adr:0013-the-project-directory-is-the-unit` was drafted against the wrong version before
  it was checked against the hooks reference.

## 2026-07-31

- The project is **open-wiki**, not project-wiki. Renamed throughout, including
  `plans/open-wiki.md` and the `@open-wiki/*` package scope.
- Added [[claude-code-plugins]], distilled from the Claude Code plugin, marketplace and
  MCP references. It carries one finding that reaches the plan: an HTTP MCP server in a
  plugin can generate its own auth headers at connection time, which removes the pasted
  token of task 9.13.
- Started the wiki with `index.md` and this file.
