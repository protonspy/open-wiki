# What a harness loads

Three coding agents can open a project directory, and this product wants its convention read
in all of them. Each one loads a different entry file from a different place, keeps MCP
servers in a different file under a different schema, and offers a different — not weaker,
*different* — way to inspect a write before it lands.

Everything below was read from each harness's own source. That is the whole point of the
exercise: `adr:0013-the-project-directory-is-the-unit` exists because a claim about a
harness was reasoned rather than read, and was wrong. This is the second time the question
has come up and the second time reading beat reasoning — see **What the reading changed**
at the end, which is not a footnote.

## Claude Code

| What | Where |
| --- | --- |
| Entry file | `CLAUDE.md`, at the project root and in subdirectories |
| Convention | `.claude/skills/<name>/SKILL.md` |
| MCP | `.mcp.json` at the project root |
| Interception | `PreToolUse` and `PostToolUse` hooks, which may deny |

This is the one the product already ships to, and [[claude-code-plugins]] carries the
mechanics: what a plugin can and cannot package, and why the write gate is scaffolded into
the project rather than shipped whole.

## Codex

**Entry file — `AGENTS.md`, concatenated from the project root down.**
Codex walks *upwards* from the working directory until it finds a project-root marker
(`project_root_markers`, default `.git`), then collects every `AGENTS.md` from that root
down to the working directory and concatenates them in that order. It never walks past the
root. Within one directory the candidate filenames are tried in this order:

```
AGENTS.override.md          # a local variant, tried first
AGENTS.md
…project_doc_fallback_filenames
```

— `codex-rs/core/src/agents_md.rs`

Two consequences for this product. A generated entry file at the project root is always
loaded, exactly as `CLAUDE.md` is, so `adr:0013`'s argument carries over unchanged. And the
fallback list means a project could be told to read `CLAUDE.md` as well — which is a
configuration this product must not rely on, because it is the user's to change.

**Configuration — `.codex/config.toml`, project-local.**
Loaded from the working directory, from `.codex/config.toml` in every parent up to the
root, and from the git repository root. Project-local config is *disabled* while the
directory is untrusted, and a denylist forbids it from setting the security-sensitive keys
— `model_provider`, `model_providers`, `notify`, `profile`, `profiles`, the base URLs and
`otel` among them.
— `codex-rs/config/src/loader/mod.rs`

**MCP — `[mcp_servers]` inside that config.**
A map of name to server, in the same TOML file. Not a file of its own, which is the shape
`.mcp.json` has.
— `codex-rs/config/src/config_toml.rs`

**Interception — `PreToolUse`, and it can block.**
The hook events are `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`,
`PostCompact`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `SubagentStart`,
`SubagentStop` and `Stop`. `run_pre_tool_use_hooks` runs before every tool call, and its
outcome carries `should_block` and a `block_reason`; the blocked path names `Bash` and
`apply_patch` explicitly.
— `codex-rs/config/src/hook_config.rs`, `codex-rs/core/src/hook_runtime.rs`

`apply_patch` is how Codex edits a file. So Codex can refuse a write before it lands, on
the same terms Claude Code can.

## opencode

**Entry file — `AGENTS.md`, and it reads `CLAUDE.md` too.**
Instruction files are resolved by globbing *upwards* from the project directory to the
worktree root. `AGENTS.md`, `CLAUDE.md` and `CONTEXT.md` are all named in that path, and
`OPENCODE_DISABLE_PROJECT_CONFIG` restricts resolution to the global config directory
instead.
— `packages/opencode/src/session/instruction.ts`

**Configuration — `opencode.json` or `opencode.jsonc`.**
Walked up from the directory to the worktree and then *reversed*, so the closest file is
merged last and wins.
— `packages/opencode/src/config/paths.ts`

**MCP — an `mcp` key inside that same config**, each server named and individually
`enabled`.
— `packages/web/src/content/docs/mcp-servers.mdx`, `packages/web/src/content/docs/config.mdx`

**Interception — a plugin, and the hook that can refuse is not the one you would guess.**
`tool.execute.before(input, output)` returns `Promise<void>` and its `output` carries only
`args`. It can *rewrite what a tool was asked to do* and has no channel to refuse it. The
hook that refuses is `permission.ask(input, output: { status: "ask" | "deny" | "allow" })`.
— `packages/plugin/src/index.ts`

So for opencode the gate is a permission decision, not a pre-tool veto. That is a different
shape, and a plugin written against the wrong hook would silently permit everything.

## What the reading changed

The plan this came from was written expecting the gate to **degrade** outside Claude Code —
`plans/harness-portability.md` says so in as many words, and reserves group 3 for scaffolding
"nothing, and saying so" where there is no interception.

That is not what the source says. All three can refuse a write before it lands:

- Claude Code — `PreToolUse`, deny.
- Codex — `PreToolUse`, `should_block`, and `apply_patch` is named in the blocked path.
- opencode — `permission.ask`, `status: "deny"`.

What varies is the **mechanism and its shape**, not whether one exists: a hook command in
JSON, a hook command in TOML, and a JavaScript plugin. The honest framing is *the gate is
scaffolded differently per harness*, not *the gate degrades*. The task that scaffolds it
(group 3) still needs the branch for a harness with nothing, because that is a claim about
the future rather than about today — but it is not today's claim about these three.

The second finding worth carrying: **two of the three read `CLAUDE.md`.** opencode names it
directly, and Codex can be configured to. A project scaffolded for more than one harness can
therefore end up loading the same convention twice under two names, which is a duplication
the renderer has to decide about rather than discover.
