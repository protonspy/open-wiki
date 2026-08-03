---
autonomy: auto
ci: wait
---

# Open Wiki in Claude Code, Codex and opencode

Everything this product scaffolds into a project is addressed to one harness.
`scaffoldSkills` writes `.claude/skills/`, `claude-md.ts` generates `CLAUDE.md`, the
plugin ships Claude Code hooks, and the strongest path the write gate has is
`PreToolUse` / `PostToolUse`. Open a project in Codex or opencode and none of it is
read: the convention is on disk, in a directory that harness never looks in.

`protonspy/spec-claude-code#6` solved the same problem for `scc` — one template set,
paths from a harness profile, an entry file that differs by name — and that is the
shape to copy. Two things do not copy, and they are where the work actually is.

## The first divergence: a project is committed, a workspace is not

`scc init` asks which harness and scaffolds for it. One choice, one answer, because an
`scc` workspace is one developer's setup.

**A project directory is not.** `adr:0013-the-project-directory-is-the-unit` put the
convention inside the repository precisely so that `.mcp.json`, `CLAUDE.md` and the
skills are committed and reach everyone who clones. A team is not homogeneous — one
person on Claude Code and one on Codex is the normal case, not the edge — and a project
scaffolded for one of them silently gives the other nothing.

So **`ow init` takes harnesses, plural**, and a project may carry more than one entry
file. That is a real difference from `scc`, arrived at from a real difference in what
the artifact is for.

## The second divergence: the convention is portable, the gate is not

`scc` scaffolds methodology, which is entirely prose. Every byte of it ports by
changing a path and a filename.

This product scaffolds prose **and a gate**, and the gate is machinery.
`adr:0013` already said so, and it said it after getting the hook contract wrong twice
by reasoning instead of reading:

> Hooks are also Claude Code's mechanism and nobody else's. In a harness without them
> the gate is whatever the CLI verb enforces, and where neither is in place group 7 is
> the net of record.

So the split is already decided and this plan does not reopen it:

| | Claude Code | Codex · opencode |
| --- | --- | --- |
| the convention (skills, entry file) | scaffolded | scaffolded, at that harness's paths |
| refusal before the write | `PreToolUse`, with `updatedInput` | whatever that harness actually offers — **to be checked, not assumed** |
| the fallback | — | the `ow write` verb |
| the net when neither is in place | group 7 | group 7 |

**What each harness can enforce is a claim to check against its source.** `scc#6`
verified its conventions "against each tool's own source rather than its docs, which
disagree in two places", and `adr:0013` makes the same demand a rule. Nothing in this
plan asserts what Codex or opencode can intercept, because nobody has read it yet —
task 1.1 is that reading, and it comes before anything is designed on top of it.

## The third divergence: no silent default

`scc init` falls back to Claude Code when nobody is at the terminal — "an agent or a CI
job drives `init` exactly as before". That is right for `scc` and wrong here, for a
reason that is specific rather than a matter of taste.

**In `scc`, guessing wrong is discovered by the person who guessed, immediately.** They
are the only user of that workspace; the wrong picker choice shows up in their next
command.

**Here, the person who suffers is somebody else, later.** The convention is committed
(`adr:0013`), so a project scaffolded for the wrong harness looks perfect to whoever ran
`ow init` and gives nothing to the colleague who clones it next week. The feedback loop
that makes a silent default safe is broken, and the failure it produces — files on disk
that the harness never reads — is the exact failure this entire plan exists to end. A
default that reproduces the bug one level up is not a convenience.

So the contract is three-way and the third case refuses:

| invocation | what happens |
| --- | --- |
| a harness named | scaffold it, ask nothing |
| none named, terminal attached | the picker |
| none named, no terminal | refuse, and name the flags |

A refusal costs one second and one flag. A wrong scaffold costs somebody a week and
looks like the product not working.

**This is a breaking change to `ow init`, and calling it one is the point.** Scripts and
`npx open-wiki init` have to name a harness. That is cheap now and expensive after the
first project is scaffolded wrong.

## What this is not allowed to become

**Three copies of the convention.** `adr:0015-the-convention-ships-as-skills` gave it
one home, and the plugin was explicitly forbidden from re-shipping the skills for the
same reason. One template set, three renderings, is the only version of this that does
not drift.

**A second product.** The desktop application, the recorder and the wiki store do not
change. This is entirely about what `ow init` writes and where.

## And the ageing problem, which now has a known answer

`adr:0015` left one thing open: a skill scaffolded into a project ages there, so a
project set up today keeps today's convention forever. `plans/sources-stored-not-parsed.md`
task 5.3 already flags that this is about to bite, because a project scaffolded before
that plan lands has a skill that never mentions source status.

`scc#6` built exactly this answer: hash every managed file against what the current
build renders **and** against what the manifest says was last written, which separates
*unchanged*, *needs updating*, and *the user edited this* — and keep the edited one,
naming it, rather than merging or clobbering. `ow update` is that, and it closes a gap
this project recorded and then had to route around twice.

---

## 1 — Read the harnesses before designing for them

- [x] 1.1 (Unit) Establish, from each harness's own source, what it loads and from where: entry file, skills or equivalent, MCP configuration, and what — if anything — can inspect or refuse a write before it lands. Record it as findings with citations, because everything below is built on it and `adr:0013` is explicit that a claim about a harness that was reasoned rather than read does not belong in this repository
  - [[what-a-harness-loads]], read from each harness own source. Entry file, convention directory, MCP configuration and interception for all three, each line cited to the file it came from.
  - **It overturned this plan premise.** The plan says the convention is portable and the gate is not, and reserves 3.1 for scaffolding nothing where a harness cannot intercept. All three can: Codex has `PreToolUse` carrying `should_block` and names `apply_patch` in the blocked path, and opencode refuses through `permission.ask`. What varies is the mechanism — a hook in JSON, a hook in TOML, a JavaScript plugin.
  - **And opencode hook that can refuse is not the obvious one.** `tool.execute.before` returns `Promise<void>` and its output carries only `args`, so it can rewrite what a tool was asked to do and cannot refuse it. A plugin written against it would silently permit everything.
  - **Two of the three read `CLAUDE.md`** — opencode names it directly, Codex can be configured to. A project scaffolded for more than one harness can load the same convention twice under two names, which 2.2 has to decide about rather than discover.
  - The exercise is the point: `adr:0013` exists because a claim about a harness was reasoned rather than read, and was wrong. Second time asked, second time reading beat reasoning.
- [x] 1.2 (Unit) An ADR: the convention ships to every harness, the gate degrades per harness, and a project may carry more than one. It narrows `adr:0015` — which said the convention ships as skills, in the singular — rather than superseding it, and it is hard to reverse because it decides what is committed into every project this product touches. It is the *mechanics*; the stance it applies is already recorded in `adr:0020-decisions-are-made-for-every-harness`, which deliberately left these questions to this task
  - `adr:0024-the-convention-ships-to-every-harness`. It narrows `adr:0015` rather than superseding it: the convention still ships as skills wherever a harness has a skills directory, and ships the same text under whatever that harness reads where one does not.
  - **It says "scaffolded per harness", not "degrades".** That word assumed a hierarchy 1.1 did not find. Where a harness offers interception the strongest one is scaffolded; the branch for a harness offering none stays, because it is a claim about the future rather than about these three.
  - **`ow write` is the documented path in every regime**, not only where hooks are absent. It is the one path that is the same everywhere, and a convention recommending it conditionally has to explain the condition.

## 2 — One template set, three renderings

- [ ] 2.1 (Unit) A harness profile: entry filename, convention directory, MCP configuration path, and what the gate degrades to. Data, not branches — the same move that let `scc` delete its per-harness template tree instead of growing two more
- [ ] 2.2 (TDD) Render the convention through the profile, and prove no rendered file for one harness names another's directory. Test-first because that is the failure that ships quietly: a skill that tells a Codex user to look in `.claude/` is wrong in a way nothing errors on
- [ ] 2.3 (Unit) `ow init` with a harness named — `--claude`, `--codex`, `--opencode`, and more than one accepted — scaffolds it and asks nothing
- [ ] 2.4 (Unit) `ow init` with none named and a terminal attached opens a picker: the three harnesses, multi-select, nothing preselected. Multi-select is why this is a screen rather than a numbered prompt, and whatever it costs in dependencies is a `docs/stack.md` line like any other
- [ ] 2.5 (Unit) `ow init` with none named and **no** terminal refuses, and names the flags. It does not guess — see below
- [ ] 2.6 (Unit) The launcher and first run offer the same choice as a form, not a picker — the desktop has no terminal, and 8.12 already learned that lesson when a chain of `prompt()` calls answered nothing in a packaged build. Same scaffolder underneath, because a project is the same project whichever door it came through
- [ ] 2.7 (Unit) The generated entry file carries the same content under whichever name, including the content language of 8.12 — and is regenerated per harness when that setting changes, since it is generated and the skills are not

## 3 — The gate, per harness

- [ ] 3.1 (Unit) Scaffold the strongest interception 1.1 found for each harness, and where there is none, scaffold nothing and say so rather than writing a file that looks like a gate and is not
- [ ] 3.2 (Unit) The `ow write` verb is the documented path wherever hooks are absent, and the convention text says which regime this project is under — a user who believes they are protected and is not is worse off than one who knows they are not
- [ ] 3.3 (Unit) 9.6's refusal — no agent-mediated write reaches `.claude/`, `.mcp.json` or `CLAUDE.md` — extends to every harness's equivalent paths. The reason is unchanged and applies exactly: it is the gate's own configuration, and a write path that reaches it edits away its own restraint through a change that reads as documentation

## 4 — MCP configuration, per harness

- [ ] 4.1 (Unit) `ow consult add` writes to the configuration each harness actually reads, at the shape it actually reads — today it writes `.mcp.json` and nothing else. `adr:0018` made the entry an HTTP URL with a bearer token from the environment, so what varies per harness is the file and its schema, not the server
- [ ] 4.2 (Unit) A project configured for more than one harness gets the entry in each, from one source, so that adding a consulted project is one act rather than one per harness

## 5 — `ow update`

- [ ] 5.1 (TDD) Hash every managed file against what this build renders and against what the manifest records as last written, separating unchanged, updatable, and edited-by-the-user. Test-first: the whole value is in the third bucket, and a wrong answer there overwrites something somebody wrote by hand
- [ ] 5.2 (Unit) An edited file is kept and named, never merged and never silently replaced, and stays recorded at the version last written — which is the base revision a three-way merge would need later
- [ ] 5.3 (Unit) Print the plan grouped by outcome and ask before applying, with the confirmation given up front for unattended callers and a mode that reports and stops
- [ ] 5.4 (Unit) A project scaffolded for one harness can gain another through the same verb, which is what makes 2.3's plural choice something a user can change their mind about

---

## Notes

**Order.** 1.1 blocks group 3 entirely and informs group 2's profile. Nothing else is
sequenced.

**This is the second time this repository has needed a harness profile**, and the first
was `adr:0013` discovering that a `CLAUDE.md` outside the project does not load. Both
times the fact was only available by reading the tool rather than the documentation,
and both times reasoning about it produced a wrong answer first. That is the standing
lesson and 1.1 exists to honour it.

**What stays Claude Code's alone.** The plugin of 10.6 is Claude Code's packaging
format, and there is nothing to ship in its place for the others — the CLI already
covers them. Nothing here promises feature parity; it promises the convention is
readable and the gate's regime is stated.

**`scc` is a dependency of the methodology, not of the product.** Adopting
`spec-claude-code#6` in *this* repository — the sharpened review agents, the six-way
`update` — is a separate act, blocked on a release: the PR merged on 2026-08-02 and the
latest published version is v0.0.2 from 2026-08-01, which has neither. That is a
`scc update` to run when it ships, and it changes nothing a user of Open Wiki sees.
