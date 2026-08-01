# Claude Code plugins

A plugin is a self-contained directory that adds skills, agents, hooks, MCP servers and
LSP servers to Claude Code, installed with one command instead of assembled by hand. It
matters here because this product's interface is a written convention plus a read-only MCP
server, and a plugin is the only shipping format that carries both at once.

Read against `adr:0013-the-project-directory-is-the-unit`, which moved the local wiki out
of MCP's reach and left the protocol one job: consulting *another* project. Much of what
follows was distilled when the plan still had an HTTP server with a token, and the sections
below say where that no longer applies.

## The shape on disk

`.claude-plugin/` holds only the manifest. Everything else sits at the plugin root —
putting `skills/` inside `.claude-plugin/` is the documented way to get a plugin that
loads nothing.

```
my-plugin/
  .claude-plugin/plugin.json     the manifest — optional
  skills/<name>/SKILL.md         a skill, invocable as /my-plugin:<name>
  agents/*.md                    subagents
  hooks/hooks.json               event handlers
  commands/*.md                  flat-file skills; skills/ is preferred for new plugins
  .mcp.json                      MCP servers
  bin/                           executables added to PATH
  scripts/                       what hooks and helpers call
```

The manifest is optional: with none, components are discovered in the default locations
and the plugin takes its name from the directory. When present, `name` is the only
required field, and unrecognised top-level fields are ignored — so one file can double as
an npm `package.json` or a VS Code manifest. `claude plugin validate --strict` turns those
warnings into errors, which is what belongs in CI.

## Three variables, and where they resolve

| Variable | Resolves to |
|---|---|
| `${CLAUDE_PLUGIN_ROOT}` | the plugin's installed directory |
| `${CLAUDE_PLUGIN_DATA}` | a directory that survives plugin updates |
| `${CLAUDE_PROJECT_DIR}` | the project root |

They substitute in skill and agent text anywhere, in hook commands anywhere, and in MCP
servers only in specific fields — `command`, `args` and `env` for stdio servers, and
`url`, `headers` and `headersHelper` for HTTP ones.

Installation copies the plugin into a cache, so nothing may reference a path outside its
own directory. `../shared` does not survive the copy.

## `headersHelper` — a finding this project no longer needs

An HTTP MCP server in a plugin can name a command that produces its headers:

```json
{
  "mcpServers": {
    "open-wiki": {
      "type": "http",
      "url": "http://127.0.0.1:7331/mcp",
      "headersHelper": "node scripts/mcp-headers.mjs"
    }
  }
}
```

The command writes a JSON object of string pairs to stdout, runs in a shell with a
ten-second timeout, and for a plugin-provided server runs with its working directory set
to the plugin root. It runs fresh on every connection, and since v2.1.193 Claude Code
re-runs it and retries once when a tool call comes back `401` or `403`.

**This solved a problem the product then stopped having.** It was distilled to remove the
pasted bearer token of what was task 9.13, back when the server ran over HTTP on the
loopback. `adr:0013-the-project-directory-is-the-unit` replaced that with stdio, spawned by
the harness — and a stdio server has no headers, no port and no token to deliver. The
mechanism is recorded here because it is a real Claude Code capability and the next person
to reach for an HTTP MCP server will want it; it is not something this plan uses.

One constraint to design around: a plugin's `headersHelper` cannot read the plugin's own
`${user_config.*}` values, because the command goes through a shell. The helper has to
read what it needs from a file or its own environment, which is exactly what reading
`config.json` does.

## Getting it installed

Two routes, and they suit different moments.

**A marketplace**, which is a `.claude-plugin/marketplace.json` at a repository root
listing one or more plugins:

```json
{
  "name": "open-wiki",
  "owner": { "name": "…" },
  "plugins": [
    { "name": "open-wiki", "source": "./plugin", "description": "…" }
  ]
}
```

`name`, `owner` and `plugins` are required at the top; each entry needs `name` and
`source`. A user then runs:

```
/plugin marketplace add <owner>/<repo>
/plugin install open-wiki@open-wiki
```

Marketplace names are checked against a reserved list — anything resembling an official
Anthropic source is refused, at every load and not only when first added.

**Or a skills-directory plugin**, which is any folder under a skills directory carrying
`.claude-plugin/plugin.json`. It loads as `<name>@skills-dir` with no marketplace and no
install step, scaffolded by `claude plugin init <name> --with skills mcp`. Under
`~/.claude/skills/` it is personal and unrestricted; under a project's `.claude/skills/`
it is checked into the repository and reaches everyone who clones it — and then the MCP
servers it declares go through per-server approval, LSP servers wait for workspace trust,
and background monitors do not load at all.

Both routes now matter, which was not true when this page was written. The audience installs
a desktop application, so the marketplace reaches them — but after
`adr:0013-the-project-directory-is-the-unit` they also work in repositories where
`.claude/` and `.mcp.json` are committed and reach everyone who clones, and
`npx open-wiki init` targets someone with nothing installed at all.

## What a plugin carries, and the two things it does not

| Component | In a plugin? |
|---|---|
| Skills, agents, hooks, LSP servers, MCP servers | yes |
| Executables in `bin/`, added to the Bash `PATH` | yes |
| Background monitors | yes |
| Default settings | only the `agent` and `subagentStatusLine` keys |
| **Permission rules — `allow`, `ask`, `deny`** | **no** |
| **`additionalDirectories`** | **no** |

The two absences are the ones that reach this plan.

**A plugin cannot ship the deny rule**, so nothing the product distributes can be what
stops an agent writing `wiki/` outside the validations. If the write gate of task 9.5 turns
out to be `Edit(wiki/**)` in `deny`, that rule has to be written into the user's own
settings — by `ow init`, or by the user — and the plugin can only carry the hooks beside
it. Hooks it can carry, which is why the hook-based gate is the one a plugin could deliver
whole.

**`bin/` on the `PATH` is worth more than it looks.** A plugin can put a CLI in front of
the agent without the desktop application being installed, which is the same reach
`npx open-wiki` has and the reason
`adr:0014-typescript-everywhere-except-audio-capture` cares that the CLI runs standalone.

What a plugin still does not distribute is the wiki itself: an MCP server consulting
`fenix` needs `fenix` checked out somewhere on that machine, and the registry is what turns
a committed project *name* into that local path.

The question this page used to leave open — whether the convention lives in a generated
`CLAUDE.md` or in a skill — was closed by `adr:0015-the-convention-ships-as-skills`. It is
a skill, scaffolded by `ow init`, and the `CLAUDE.md` points at it.

## Sources

- <https://code.claude.com/docs/en/plugins-reference>
- <https://code.claude.com/docs/en/plugin-marketplaces>
- <https://code.claude.com/docs/en/mcp>
- <https://code.claude.com/docs/en/hooks>
- <https://github.com/ivan-magda/claude-code-plugin-template>

Read 2026-07-31, against Claude Code v2.1.x. Revisited 2026-08-01 for what a plugin cannot
carry, and for the hook mechanics the write gate rests on: a `PreToolUse` hook receives the
tool's complete `tool_input` — including `content` for `Write` and the strings for `Edit` —
and can answer `permissionDecision: deny` with a reason the agent reads, or `updatedInput`
to replace the arguments before the tool runs. So a write can be refused before it lands,
and it can also be *completed* before it lands. Both facts were recorded wrongly on a first
pass — first as "the hook cannot see the content", then as "the hook cannot change it" — and
several documents were written against each before either was checked.
