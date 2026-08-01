# Claude Code plugins

A plugin is a self-contained directory that adds skills, agents, hooks, MCP servers and
LSP servers to Claude Code, installed with one command instead of assembled by hand. It
matters here because this product's whole interface is an MCP server plus a written
convention, and a plugin is the only shipping format that carries both at once.

Read against `adr:0003-mcp-as-the-only-bridge-to-the-llm`, which is what makes the MCP
server the product rather than an accessory.

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

## `headersHelper` — the finding that changes a task

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

**This removes the pasted configuration.** Task 9.13 exists because the MCP token is
generated per workspace and has to reach the harness somehow, and pasting a JSON block
containing a bearer token is the current answer. With a helper, the plugin ships a static
file that contains no secret; the helper reads the token from the application's own
`config.json` — the same file `adr:0007-plaintext-credentials-in-the-config` already
puts it in — and hands it over at connection time. Rotating the token then needs no edit
anywhere, and a token that changed while a harness was connected recovers on the retry
instead of failing until someone notices.

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

For this product the marketplace route is the one that matters, because the audience
installs a desktop application and is not cloning anything.

## What this does not solve

A plugin distributes the skill and the server *configuration*. It does not distribute the
server: the MCP endpoint is the desktop application, which the user still installs from
`adr:0009-distribution-through-github-releases`. So the plugin is worth exactly one thing
— removing the paste step and the copy of the token that comes with it.

It also raises a question this project has not answered. `adr:0003-mcp-as-the-only-bridge-to-the-llm`
puts the page convention in a `CLAUDE.md` generated inside each project folder, and a
plugin skill is a second place the same convention could live — versioned with the
product and updated by an upgrade, rather than regenerated per folder. Two homes for one
convention is the drift that ADR warned about, so one of them has to become a pointer to
the other.

## Sources

- <https://code.claude.com/docs/en/plugins-reference>
- <https://code.claude.com/docs/en/plugin-marketplaces>
- <https://code.claude.com/docs/en/mcp>
- <https://github.com/ivan-magda/claude-code-plugin-template>

Read 2026-07-31, against Claude Code v2.1.x.
