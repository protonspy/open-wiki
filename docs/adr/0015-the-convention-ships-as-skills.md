---
status: accepted
---

# 0015 · The convention ships as skills scaffolded into the project

## Context

`adr:0003-mcp-as-the-only-bridge-to-the-llm` moved the page convention out of code and into
prose, and named the consequence: *"if it is vague, two agents write two different wikis in
the same folder and nothing breaks."* Where that prose lives has been open since: the plan
generated a `CLAUDE.md` inside each project and also said a skill was the rival home, with
one of the two to become a pointer to the other.

`adr:0013-the-project-directory-is-the-unit` changed the evidence twice over. It removed the
argument that a generated `CLAUDE.md` might never load — inside the project it always loads.
And it made the same directory the place a harness already reads `.claude/skills/`.

What decides it is context. A `CLAUDE.md` is loaded into every session whether or not the
session is about writing a wiki page; a skill loads when the concern is live. This project
holds that principle about its own methodology, in its own `CLAUDE.md`: *"every session pays
for it in context, and model accuracy degrades as context grows — non-uniformly, well before
any documented limit."* Applying it to the product and not to ourselves would be incoherent.

## Decision

`ow init` scaffolds the convention as skills in the project's `.claude/skills/` — one for
the **wiki** and one for **codewiki** — and writes neither if it is already there.

This is what `scc` does to this repository, and the product does the same thing to the
user's.

The generated `CLAUDE.md` of task 9.14 is not a second home. Where it says anything about
the page schema or the method, it points at the skill.

## Consequences

The plan's open question is answered, and the drift
`adr:0003-mcp-as-the-only-bridge-to-the-llm` warned about has one home instead of two.

One home means one, which rules out something the distribution plan was reaching for: a
Claude Code plugin that also carries these skills. A plugin-installed skill and a
project-scaffolded skill are two copies of one convention, updated by different mechanisms,
and neither is obviously the pointer — the same drift, with both halves now skills. What a
plugin may carry is the hooks, and the scaffolding command that writes the skills; not the
skills themselves.

Scaffolding **codewiki** into a user's project widens what the product is for. The wiki was
sources, meetings and decisions; it now also narrates the project's code, with sections
citing exact line ranges. Those citations go stale loudly rather than quietly — which is the
point of them — but it means the integrity checks of group 7 need a code-citation variant
beside the provenance one, and the page types grow beyond `projects/`, `people/` and
`topics/`.

**Generating into the project reintroduces the ageing the skill was supposed to avoid.**
The plan's argument against the generated `CLAUDE.md` was that it is "a copy per folder that
ages from the moment it is written", and a skill written by `ow init` is a copy per folder
that ages from the moment it is written. Refusing to overwrite is right — the user edits
these files and losing that is worse — but it means a project scaffolded at v0.3 keeps a v0.3
convention forever, silently, while the validators enforce v0.7.

## The question this record does not answer

**How a scaffolded skill learns it is old.** A version marker in the generated file plus an
`ow init` that reports staleness instead of overwriting is the obvious shape, and there are
others: a skill thin enough to be a pointer at a CLI command that carries the authoritative
text, or an upgrade path that diffs and asks. Nothing here chooses, and until something
does, the ageing above is unmitigated rather than accepted.
