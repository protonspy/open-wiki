---
status: accepted
---

# 0003 · MCP is the only bridge between the wiki and the LLM

## Context

Turning the text of a source into wiki pages is language-model work. There were two ways
to do it, and for a while the design had both at once: the application calling an LLM
internally, and an MCP server handing the finished wiki to an external agent.

Two bridges mean two authors for the same content, two credentials, two notions of what a
good page is, and no good answer for who wins when they disagree.

They also mean competing with the harness the user already has open. They already pay for
an agent, already configured it and already trust it. A second writing engine inside the
application is duplicated work that delivers less.

## Decision

**The application does not call an LLM.** It receives sources, reduces each one to
`text.md` with provenance anchors, stores the wiki and serves all of it over MCP. Reading
the text, applying the LLM-Wiki methodology and writing the pages is the user's agent.

The MCP server exposes read, search, ingest and write. It runs over HTTP on the loopback,
is started and stopped by the application, and **serves exactly one project at a time,
chosen by the application** — no tool takes a project parameter, and the address does not
change when the project does. What base the agent can reach is decided by the application,
never by the agent.

**What replaces the code that would have written the pages is write-time validation.**
Every write — from the editor or from MCP — is refused if the frontmatter departs from the
schema, if a wikilink does not resolve, or if a citation points at a source or an instant
that does not exist. The application does not guarantee the page is good; it guarantees it
is well formed, and returns an error the agent can read in order to try again.

The only credential the application stores is the transcription one.

## Consequences

The application does one thing and stays small: gone are the LLM client, the structured
extraction, the entity resolution, the page writing and the diff approval. Gone with them
is the competition with the harness — the product becomes infrastructure it needs, instead
of a worse competitor to it.

Three real losses:

**There is no recompilation.** Rebuilding `wiki/` from `raw/` required exactly the LLM the
application does not have. `wiki/` stops being derivable and becomes primary content —
which promotes the snapshot and the log of
`adr:0002-workspace-as-a-local-markdown-folder` from a comfort to a foundation.

**The convention left the code and moved into prose.** The page format used to live in a
writer tested by fixtures in CI. Now it lives in the `CLAUDE.md` generated in the project,
which is a text a model interprets. If it is vague, two agents write two different wikis in
the same folder and nothing breaks. Validation holds the form; it does not hold the
meaning. A well-formed and wrong page passes.

**Supersession depends on the agent.** That a replaced decision ends up struck through,
dated and linked to the one replacing it used to be a rule enforced by code; now it is an
instruction. The validator reports broken links and orphan pages, but it cannot report
"this page silently overwrote a decision" — that would require understanding the content.

Two operational consequences that become requirements:

- **The port is local, not private.** Any process on the machine reaches the loopback, and
  there is ingest and write behind it. A mandatory token on every request and confinement
  to the served project are the difference between a tool and a vector.
- **Switching projects drops the connections.** Since the address is the same, a connected
  harness would go on talking to what it believes is the previous base.

If one day it makes sense to bring distillation back into the application, the path that
preserves this decision is an embedded agent speaking the same MCP tools — not a second
writer with direct disk access.
