---
status: accepted
---

# 0020 · Decisions are made for every harness, not for Claude Code

## Context

This product is used from an agent harness, and there are three that matter: Claude
Code, Codex and opencode. Nothing in the repository says so.

What the repository does say, everywhere, is Claude Code.
`adr:0013-the-project-directory-is-the-unit` moved the product inside the harness's
working directory. `adr:0015-the-convention-ships-as-skills` put the convention in
`.claude/skills/`. The write gate's strongest path is `PreToolUse` with
`updatedInput`, and `adr:0013` already recorded what that costs:

> Hooks are also Claude Code's mechanism and nobody else's. In a harness without them
> the gate is whatever the CLI verb enforces, and where neither is in place group 7 is
> the net of record.

That sentence is the whole problem in miniature. The limitation was seen, written
down, and then not carried forward — because nothing obliged the next decision to
carry it.

**The bias is no longer confined to the parts that touch a harness.** Two examples,
both from work that was done carefully:

- `docs/glossary.md` records that `session` "now regularly and correctly means one run
  of Claude Code". That is a **canonical term**, the layer every requirement, page and
  identifier is written from. The vocabulary itself now teaches the bias.
- `specs/embedded-agent` resolves the system prompt from `CLAUDE.md` and loads
  `.claude/skills/`. Its task 2.2 says "today `CLAUDE.md`, plural once
  `plans/harness-portability.md` lands" — the author knew. Knowing is not a
  constraint; the spec shipped single-harness and nothing objected.

`plans/harness-portability.md` exists and names the work of porting the scaffolding.
It is not sufficient on its own, and the reason is structural: **a plan is work and
work finishes.** Its checklist gets ticked, it closes, and every decision taken
afterwards is again free to assume one harness. What is missing is not a task list.
It is a standing constraint on how decisions are made.

## Decision

Every decision recorded in this repository is made for the set — Claude Code, Codex,
opencode — and not for one member of it. Concretely:

**A decision that depends on a capability only one harness has must name that harness,
state what the others get instead, and record that the difference is shipped
behaviour.** `PreToolUse` is the pattern: naming it is fine, naming it without saying
what a Codex user's gate is instead is not. A harness-specific choice with no written
degradation is an unfinished decision, not a pragmatic one.

**A harness's name appearing in a requirement, a design, a canonical term, or anything
scaffolded into a user's project is itself a decision** and is justified where it
appears. This is what would have stopped the glossary entry: nobody decided that the
vocabulary should be Claude Code's, it simply was not a decision anybody had to make.

Two alternatives were real and were rejected.

*Leave it to the plan.* `plans/harness-portability.md` already covers the scaffolding,
so a second record could look redundant. Rejected for the reason above — the plan ends
and the constraint must not. It is also aimed at the wrong layer: the plan ports files,
and the glossary entry is not a file that gets ported.

*Abstract over the harnesses now* — introduce the profile, the plural entry file, the
per-harness gate, ahead of the plan. Rejected because `adr:0013` and the plan both
demand that each harness's capabilities be read from its own source before anything is
designed on them, and none of that reading has happened. An abstraction invented ahead
of the evidence is exactly the invented architecture `.claude/rules/specs.md` warns
about: the next session reads it as a decision somebody made, and honors it.

**What this record does not decide.** It does not say how the convention ships to each
harness, what the gate degrades to for each, or whether a project carries more than one
entry file. Those are `plans/harness-portability.md` task 1.2, which comes after task
1.1 has read the three harnesses' sources. This record decides only that those
questions — and every question after them — are answered for three harnesses rather
than one. It narrows nothing in `adr:0015`; 1.2 is where that narrowing belongs.

## Consequences

**Every future decision costs more.** A harness-specific choice now owes a degradation
story even when no user has asked for Codex support, and that is real overhead on work
that would otherwise be quick. The alternative is paying it later as a migration, on
artifacts already committed into other people's repositories, which
`adr:0013` made irreversible on purpose.

**Nothing already written is retro-fitted, and nothing here is superseded.**
`adr:0013` and `adr:0015` stand exactly as they are; they recorded what was believed
and they are history. What changes is the status of the deviations, not the records:
the glossary's `session` note and the embedded agent's `CLAUDE.md`-only resolution stop
being invisible and become **known deviations, findings against this record**. Neither
is fixed here.

**This is not mechanically checkable.** `scc` validates the shape of artifacts and
never reads intent, so nothing will fail when a decision is quietly made for one
harness. Enforcement is the author's and the reviewer's, the same way
`.claude/rules/specs.md` makes keeping a spec current an obligation rather than a
validator. The one thing that helps is cheap: a harness's name in a new decision is
greppable, and its absence next to a capability claim is what a reviewer looks for.

**A stated stance that is not followed is worse than none**, because it is believed.
This record is worth what the next few decisions demonstrate about it, and if they
demonstrate nothing it should be marked rejected rather than left standing as
decoration.

**One harness may still win a specific argument.** Harness-agnostic is not
harness-equal: if reading the sources shows that only Claude Code can refuse a write
before it lands, the honest decision is that Claude Code users get a gate and the
others get `ow write` and are told so. That outcome satisfies this record completely.
What it forbids is arriving there without noticing.
