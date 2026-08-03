# What a harness loads

Three coding agents can open a project directory, and this product wants its convention read
in all of them. Each one loads a different entry file from a different place, keeps MCP
servers in a different file under a different schema, and offers a different — not weaker,
*different* — way to inspect a write before it lands.

Everything below carries the source it was read from — the Rust and TypeScript sources for
Codex and opencode, which are public; the published reference for Claude Code, which is what
Anthropic ships in place of one. Nothing here is inferred from another claim on this page.
That is the whole point of the exercise: `adr:0013-the-project-directory-is-the-unit` exists
because a claim about a harness was reasoned rather than read, and was wrong. This is the
second time the question has come up and the second time reading beat reasoning — see **What
the reading changed** at the end, which is not a footnote.

## Claude Code

| What | Where |
| --- | --- |
| Entry file | `CLAUDE.md` or `.claude/CLAUDE.md` at the project root — and in subdirectories, but see below |
| Convention | `.claude/skills/<name>/SKILL.md` |
| MCP | `.mcp.json` at the project root |
| Interception | `PreToolUse`, which can deny before the tool runs — declared in `.claude/settings.json` |

**The root file loads at launch; a subdirectory's does not.** Claude Code walks *upwards*
from the working directory and concatenates what it finds, root-first. Files in
subdirectories *below* the working directory are discovered too, but "instead of loading
them at launch, they are included when Claude reads files in those subdirectories". Only the
root file is guaranteed to be in context, which is the file this product generates.
— <https://code.claude.com/docs/en/memory>

**Only `PreToolUse` refuses a write.** It answers
`hookSpecificOutput.permissionDecision: "deny"` before the tool executes, or `updatedInput`
to replace the arguments. `PostToolUse` fires *after a tool call succeeds*: its
`decision: "block"` stops the agent continuing and `updatedToolOutput` rewrites what the
agent sees, but the file is already written. A gate built on `PostToolUse` would report a
refusal it did not perform.
— <https://code.claude.com/docs/en/hooks>

`adr:0013-the-project-directory-is-the-unit` already had this right — it gives `PostToolUse`
validation and group 7's checks as what *covers what the entrance misses*, which is detection
and undo, not prevention. A page about the harnesses must not know less than the record that
came before it.

**And the hook goes in `.claude/settings.json`, under a `hooks` key — not in
`.claude/hooks/hooks.json`.** A standalone `hooks/hooks.json` is *exclusively* a plugin's
mechanism, resolved inside the plugin's own installed directory; a project's hooks are read
from its settings file (or `settings.local.json`).

This is the one that cost something. `ow init` wrote `.claude/hooks/hooks.json` from plan
task 9.5 onward, and **nothing ever read it** — so the write gate this product's whole
safety argument rests on was never installed, while every `ow init` reported installing it.
It was found by a code review asking for the citation behind a profile field, and there was
none: [[claude-code-plugins]] had recorded the plugin half of this fact correctly since
2026-07-31, and the project half was never checked against anything.

Three lessons compound here rather than repeating: read rather than reason; **an unrecorded
capability reads as a missing one**; and the harness whose behaviour goes unchecked longest
is the one you think you already know.
— <https://code.claude.com/docs/en/hooks>

Read 2026-08-03. This is the one the product already ships to, and [[claude-code-plugins]]
carries the rest of the mechanics — what a plugin can and cannot package, and why the write
gate is scaffolded into the project rather than shipped whole — against Claude Code v2.1.x.

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

**Convention — `.codex/skills/<name>/SKILL.md`, and `.agents/skills` as well.**
Skill roots are collected per configuration layer; the project layer's is
`<config folder>/skills` carrying `SkillScope::Repo`. A second walk adds
`<dir>/.agents/skills` for every directory between the project root and the working
directory. That second one is the harness-neutral location, and this product
deliberately does not write to it: a convention in a directory several harnesses share
is one `ow update` cannot attribute to the harness that asked for it.
— `codex-rs/core-skills/src/loader.rs`

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

**Interception — `PreToolUse`, and it can block. Declared in `.codex/hooks.json`.**
The hooks for a layer are read from `<config folder>/hooks.json` *and* from the TOML form
in `config.toml`; Codex warns when a layer carries both and asks for one representation.
So the gate here is a JSON hook file, as Claude Code's is — a smaller spread than "a hook
in JSON, a hook in TOML, a plugin" suggested.
— `codex-rs/hooks/src/engine/discovery.rs`

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
merged last and wins. The directory entries it discovers are `.opencode` folders.
— `packages/opencode/src/config/paths.ts`, `packages/core/src/config.ts`

**Convention — `.opencode/skills/<name>/SKILL.md`.**
Each configuration directory contributes two skill sources, `<dir>/skill` and
`<dir>/skills`, and skills are globbed from them as `{*.md,**/SKILL.md}`. opencode's own
repository ships `.opencode/skills/effect/SKILL.md`, which is the same shape from the
other direction.
— `packages/core/src/config/plugin/skill.ts`, `packages/core/src/skill.ts`

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

What varies is the **mechanism**, not whether one exists: a hook command declared in JSON
for Claude Code and for Codex — `.codex/hooks.json` is read beside the TOML form — and a
JavaScript plugin for opencode. The honest framing is *the gate is scaffolded differently
per harness*, not *the gate degrades*. The task that scaffolds it (group 3) still needs the
branch for a harness with nothing, because that is a claim about the future rather than
about today — but it is not today's claim about these three.

**And the same thing happened a second time, to the other half of the plan.** This page
first recorded a convention directory for Claude Code and none for the others, which read
as "only Claude Code has skills" — the shape `adr:0024` then wrote a branch for, shipping
the convention as entry-file text "where a harness has no skills directory". Reading the
sources again for task 2.1 found that **all three read a project-local `SKILL.md`**:

- Claude Code — `.claude/skills/<name>/SKILL.md`.
- Codex — `.codex/skills/`, and `.agents/skills/`, both `SkillScope::Repo`.
- opencode — `.opencode/skills/`, globbed as `{*.md,**/SKILL.md}`.

So that branch is unexercised by these three, exactly as the gate's was. Twice now the
plan's shape came from an absence in this page rather than from a finding, and both times
the absence was mine and not the harness's. **An unrecorded capability reads as a missing
one**, which is the failure mode of a findings page and is worth more than the two
corrections it has produced.

The second finding worth carrying: **two of the three read `CLAUDE.md`.** opencode names it
directly, and Codex can be configured to. A project scaffolded for more than one harness can
therefore end up loading the same convention twice under two names, which is a duplication
the renderer has to decide about rather than discover.
