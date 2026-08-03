---
status: accepted
---

# 0024 · The convention ships to every harness, from one template set

## Context

`adr:0015-the-convention-ships-as-skills` decided *where* the page convention lives: in
skills scaffolded into the project, loaded when the concern is live, rather than in an entry
file loaded into every session. It said "skills", singular, because there was one harness.

`adr:0020-decisions-are-made-for-every-harness` decided the *stance*: a decision this product
makes is made for every harness it supports, and deliberately left the mechanics open.

This is the mechanics. It rests on [[what-a-harness-loads]], which is task 1.1 of
`plans/harness-portability.md` and was read from each harness's own source — because
`adr:0013` exists precisely because a claim about a harness was reasoned rather than read,
and was wrong.

**The reading changed the premise the plan was written on.** That plan says the convention is
portable and *the gate is not*, and reserves a task for scaffolding "nothing, and saying so"
where a harness cannot intercept a write. All three can:

- Claude Code — `PreToolUse`, deny.
- Codex — `PreToolUse` carrying `should_block`, with `apply_patch` named in the blocked
  path (`codex-rs/core/src/hook_runtime.rs`).
- opencode — `permission.ask`, whose output is `"ask" | "deny" | "allow"`
  (`packages/plugin/src/index.ts`).

What differs is the mechanism: a hook command declared in JSON, a hook command declared in
TOML, and a JavaScript plugin. And in opencode's case the hook that *can* refuse is not
`tool.execute.before`, which returns `Promise<void>` and can only rewrite arguments — a
plugin written against the obvious hook would silently permit everything.

## Decision

**One template set, rendered through a per-harness profile.** A profile is data — entry
filename, convention directory, MCP configuration path and schema, and the interception this
harness offers — and the renderer branches on nothing else. That is the move
`spec-claude-code#6` made when it deleted a per-harness template tree rather than growing two
more.

**The convention ships to every harness a project is scaffolded for**, and a project may
carry more than one. `adr:0015` is narrowed, not superseded: it said the convention ships as
skills, and that stays true wherever a harness has a skills directory; where one does not,
the same convention text ships under whatever that harness reads.

**The gate is scaffolded per harness, and its regime is stated in the convention text.** Not
"degrades" — that word assumed a hierarchy the source does not support. Where a harness
offers interception, the strongest one it offers is scaffolded. Where a future harness offers
none, nothing is scaffolded and the convention says so, because a user who believes they are
protected and is not is worse off than one who knows they are not.

**`ow write` is the documented path in every regime**, not only where hooks are absent. It is
the one path that is the same everywhere, and a convention that recommends it conditionally
is a convention that has to explain the condition.

## Consequences

- Adding a harness is a profile and a review of the rendered output, not a branch through the
  scaffolder.
- **No rendered file for one harness may name another's directory.** A skill telling a Codex
  user to look in `.claude/` is wrong in a way nothing errors on, which is why the task that
  renders it is `(TDD)`.
- **Two of the three read `CLAUDE.md`** — opencode names it directly, Codex can be configured
  to through `project_doc_fallback_filenames`. A project scaffolded for more than one harness
  can load the same convention twice under two names. The renderer has to decide about that
  rather than discover it.
- A project already scaffolded for one harness can gain another, which is what makes the
  plural choice something a user may change their mind about.
- This decides what is committed into every project this product touches, which is why it is
  a record. Reversing it means rewriting files in repositories that are not ours.
