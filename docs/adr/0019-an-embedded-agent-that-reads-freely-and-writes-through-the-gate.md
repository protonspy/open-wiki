---
status: accepted
---

# 0019 · An embedded agent that reads freely and writes through the gate

## Context

`adr:0003-mcp-as-the-only-bridge-to-the-llm` decided that **the application does not
call an LLM**. `adr:0013-the-project-directory-is-the-unit` superseded that record but
kept three of its clauses, calling them the substance of it: the application does not
call an LLM, the agent writes the pages, and write-time validation is what replaces the
writer.

The argument for the first clause was competition, and it was a good argument: the user
already pays for an agent, already configured it, already trusts it. A second writing
engine inside the application is duplicated work that delivers less.

**What changed is who installs the application.** 0003 was written for a user who
already had a harness open — for them the argument still holds completely, and this
record does not touch it. But the product now ships a signed installer, and somebody who
downloads it and has no harness has nothing: a window that scaffolds a project, validates
what is written into it, records every write, and cannot write a single page. The desktop
application says so on screen in as many words — *there is no model behind this window* —
which is honest and is also a description of a dead end.

The user with a harness is served, and `plans/harness-portability.md` is about serving
them better — `ow init` taking harnesses plural, so a project reaches whoever clones it
whichever one they use. That plan is written and not yet built; either way it is about
somebody who already has an agent. The user with none is the whole of what is left, and
nothing in this repository is addressed to them.

**And the reason the methodology works turns out to be a constraint on the answer.** The
LLM-Wiki convention works in Claude Code because the agent can explore: grep for a term
before coining a second name for it, glob the tree to see how pages are organised, read a
neighbouring page before writing one beside it.

The project already answers part of that. `ow search` is a lexical scan over every page's
title and body, and `ow graph` walks the structure. But `runSearch` returns
`{ slug, title, matches }` — **which pages mention a term and how many times, not the
passage**. `adr:0010-a-derived-index-engine-behind-a-cli` described "lexical hits with
page or source, passage, anchor"; what was built is narrower, and the difference decides
this. An agent told "three pages mention *cutover*" must read all three in full to learn
how the term is used there; `grep` hands it the line. For the cheap models this door
exists for, that is the context window.

So the gap is not that content search is missing. It is that one query returning counts
is not a discovery loop, and discovering that a concept already has a name is the exact
failure `docs/glossary.md` exists to prevent.

## Decision

**The application may run an embedded agent. It reads the project the way a harness
does, and it writes only through the path the editor writes through.**

Three parts, and the split between the first two is the whole record.

**Reading is unrestricted within the project.** The agent gets the harness set — list,
glob, grep, read — over the project directory, every path confined with `assertWithin`
the way `packages/mcp` already confines its own. This is a reversal of nothing: reads
were never what the guarantees rested on.

**MCP's read-only rule does not transfer, and is not the reason for the next paragraph.**
That rule exists because one resident process serves *many* projects to a caller it does
not know, so the blast radius is every wiki on the machine and read-only has to be what
the process *can* do. The embedded agent is scoped to the project this window opened, in
this process, started by the person who clicked. Neither half of that reasoning applies.

**What does apply is the store's own invariant: nothing enters `wiki/` unvalidated.**
That is not distrust of the agent — the human typing in the editor goes through the same
door, and so does every hook. Frontmatter against the schema, wikilinks that resolve,
citations that point at a source and an instant that exist, the write atomic, the
operation logged with its origin and undoable. So the agent creates, edits, renames and
deletes pages through tools that do those things, and **no tool writes into `wiki/`
without passing through them**. Nothing is taken from the agent by this: `write_file` and
`writePage` are the same act, and only one of them is recoverable.

Outside `wiki/` the rule does not apply. A scratchpad — in memory, or under the
application's own temp — is where a proposal lives before anyone has approved it, and
that is a place the agent may write freely.

`adr:0003` closed by naming the shape that would preserve its decision if this day came:
"an embedded agent speaking the same MCP tools — **not a second writer with direct disk
access**". MCP is no longer the bridge, so the first half is now "the same tools the
external agent gets"; the second half is untouched and is the load-bearing half of this
record. An agent toolkit's default filesystem surface — `write_file`, `edit_file`,
`execute` reaching the real disk — is exactly what it excludes, and that surface is the
ergonomic default of every such toolkit rather than a corner of one.

**The convention is carried in, never re-authored.** The agent's instructions are the
generated `CLAUDE.md` — or the entry file whichever harness the project was scaffolded
for reads — and the scaffolded skills, unchanged. One convention, two consumers. A system
prompt written by hand beside them would recreate 0003's two-authors problem inside one
product, where it would be harder to see: two agents writing the same folder by two
conventions, both passing every check.

`scaffoldSkills` already writes `.claude/skills/<name>/SKILL.md` with `name` and
`description` in the frontmatter, which is the layout the agent toolkits converged on, so
this is a path to point at rather than a format to convert. That is luck rather than
foresight — `adr:0015-the-convention-ships-as-skills` chose it to be read by Claude Code —
and it is worth naming as luck, because the day the two shapes diverge nothing will fail
loudly.

**Neither the skills nor `CLAUDE.md` name a search tool, and both assume one.** They
instruct the agent to use the project's own term, one page per concept, aliases for the
names to avoid. Obeying that requires finding out which terms are already in use. The
methodology assumed a harness that could look before it wrote, without ever saying so —
which is why this record has to say so.

**This narrows `adr:0013` rather than superseding it.** One of its three surviving
clauses falls — the application may now call an LLM. The other two stand, and the second
stands harder than before: write-time validation was the thing that replaced the writer,
and it is now the only thing standing between a cheap model and the wiki.

**The embedded agent is the lesser door and the product says so.** It exists for the
user who has no harness. It is not positioned as equivalent to Claude Code or Codex, and
where the two disagree the external agent is the one the product was designed around.

Rejected: **a second writer with direct disk access**, which is the ergonomic default of
every agent toolkit and would delete the guarantee the product sells. Rejected: **giving
the agent only the derived index**, which is safe, cheap, and produces an agent that
cannot tell whether a concept already has a name.

## Consequences

**A well-formed and wrong page passes.** 0003 wrote this about the external agent and it
is sharper here, because the models this door is for are the cheap ones. The gate holds
form and cannot hold meaning: a page with three concepts in it, or the non-canonical
term, or a superseded decision quietly overwritten, passes every check the product has.
A wiki can now be filled with plausible material that validates, and the trust that
material destroys is the only thing the product sells. This is the cost of the record and
it is not mitigated by anything in it.

The mitigation is elsewhere and belongs in the plan, not here: distillation proposes and
the user approves, conformance work writes directly, and every write carries its origin
so a bad run is one undo rather than an archaeology.

**A second credential purpose.** `adr:0007-plaintext-credentials-in-the-config` was
walked back to one secret and `adr:0013` made a point of it. The Groq credential now has
two uses, transcription and the agent, which means revoking it breaks two things and the
settings screen has to say so. A project on whisper.cpp has no credential and therefore
no embedded agent — which the settings screen also has to say, before the user finds out
by opening a chat that cannot answer.

**Model choice becomes a product decision.** The provider's model list is not a menu the
user has the information to choose from: most entries are bad at tool calling and none of
them says so. Offering the raw list is handing over a decision and then inheriting the
blame for the wiki it produces.

**Two writers of the wiki now exist, and they are not symmetric.** The external agent has
the better model and the user's trust; the embedded one has the project's index and the
validated write. They must not drift into two conventions, which is why the instructions
are generated rather than written — but nothing enforces it beyond that, and
`SKILLS_VERSION` reporting a stale scaffold is the only signal there is.

**Subagents are dangerous here for a reason already written down.**
`.claude/rules/delivery.md` refuses parallel dispatch because file-disjointness is not
independence: two tasks that touch no common file both need a type that does not exist
yet, each invents one, and the merge is clean. Two subagents distilling two parts of one
recording invent two pages for one concept, or two names for it, and every check passes.
Parallelism across *sources* is the safe split; across chunks of one source it needs a
consolidation step that is not optional.

**The empty state stops being true.** *There is no model behind this window* ships today
and has to change with the first release that carries this.
