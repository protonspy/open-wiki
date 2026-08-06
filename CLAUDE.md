# CLAUDE.md

Spec-driven development, scaffolded and checked by `scc`. Keep this file short —
the methodology lives in `.claude/rules/`, read when the concern is live. Never inline it here.

## Rules — `.claude/rules/<name>.md`

Read at these moments, without being asked:

- autonomy — at kickoff, before writing anything
- routing — work arrives and needs a vehicle: a spec, or a plan
- methodology — starting a task: which cycle, what to run first
- verification — code is written and you think it is done
- delivery — last task done: branch, review, PR

Read by name when you're in that territory: tasks, specs, project (build/test/lint
commands), knowledge-base (something learned, or a decision made).

## Layout

```
specs/<feature>/   requirements.md · design.md · tasks.md
plans/<name>.md    structure, plus a checklist and/or spec references
docs/wiki/         index.md · changelog.md — the wiki's fixed documents
docs/wiki/pages/   one page per concept, linked with [[wikilinks]] and reached from index.md
docs/              the rest of the knowledge base — adr, codewiki, glossary, stack
.claude/rules/     the methodology above
.claude/skills/    how to author each part of docs/ — invoked when it applies
.claude/commands/  the same skills on demand: /scc-wiki, /scc-adr, /scc-prd, …
```

## Checking your work

`scc validate` — or `npx @protonspy/scc validate` if not installed (`@<version>` pins for CI).
Exit `0` ok · `1` could not run · `2` ran and found something. A finding is an answer, not a crash.
`scc` checks artifact *shape* only; it never reads source, so whether the code honors the artifact is on you.


<!-- rtk-instructions v2 -->
## RTK
Prefix EVERY command with `rtk`, including each link in a `&&` chain (`rtk git add . && rtk git commit -m "x"`).
No dedicated filter means it passes through unchanged — always safe.

Covered:
- cargo build/check/clippy/test, go test, tsc, lint, prettier, next build
- jest, vitest, playwright, pytest, rspec, rake test, test `<cmd>`
- git (all subcommands)
- gh pr view/checks, gh run list, gh issue list, gh api
- pnpm, npm run, npx, prisma, uv run
- ls, read, grep, find
- err, log, json, deps, env, summary, diff
- docker, kubectl, curl, wget

Meta: `rtk gain [--history]`, `rtk discover`, `rtk proxy <cmd>` (no filtering), `rtk init [--global]`
Caveat: `rtk grep` with `-c -l -L -o -Z` runs raw.
<!-- /rtk-instructions -->

<!-- scc:codegraph-instructions v1 -->
## CodeGraph
Ask the symbol graph before reading files. "Who calls this", "what breaks if I change it",
"where does this concept live" are one command here and a dozen reads otherwise.

- `scc graph explore "<question>"` — the relevant symbols' source plus the call paths between them. Start here.
- `scc graph query <name> [--kind function|class] [--limit N]` — find a symbol by name.
- `scc graph status` — what the graph holds. `--check` exits 2 when there is none.
- `scc graph sync` — re-index after you have written code you then need to search.
- `scc graph build [--force]` — first index, or a full rebuild when the graph has gone wrong.

`scc launch` indexes before the session starts, so the graph is current at turn one.
It goes stale as you edit: sync before searching for something you just wrote.
The graph is CodeGraph's — never edit `.codegraph/`, and never commit it.
<!-- /scc:codegraph-instructions -->
