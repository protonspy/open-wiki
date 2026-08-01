# open-wiki, as a Claude Code plugin

The write gate and the scaffolding command. Install it with:

```
/plugin marketplace add protonspy/open-wiki
/plugin install open-wiki@protonspy
```

## What is in here, and what deliberately is not

**In:** the `PreToolUse` and `PostToolUse` hooks that make an agent's writes go
through the store, and an `/ow-init` command that scaffolds a project.

The pair is what plan 9.5 settles. `PreToolUse` is handed a page's content
_before the file exists_, so it snapshots, validates, completes the frontmatter
through `updatedInput`, and denies with a reason when a page cannot be fixed by
filling a field in. `PostToolUse` appends the log, the changelog and the index
entry, because those describe a write that has actually happened.

**Not in: the skills.** `adr:0015-the-convention-ships-as-skills` gives the
convention one home, and it is `.claude/skills/` inside each project, written by
`ow init`. Shipping them here would be a second copy, and two copies of a
convention drift — which is the exact failure that record exists to prevent.

**Not in: a `.mcp.json`.** Its contents differ per user and per project: it names
_other_ projects this one consults, by name, and those names are on that
person's machine. `ow consult add <name>` writes it.

## What the hooks cannot do

A hook matches a tool. A page written through `Bash` arrives as a command
string with no page content to inspect, and denying `Edit(wiki/**)` does not
constrain `Bash` either, because permission rules are per tool. Where neither a
hook nor `ow write` is in the path, `ow check` is the only thing between a wrong
page and a permanent one — run it in CI.
