---
status: proposed
---

# 0010 · A derived-index engine as a second Rust binary, behind a CLI

## Context

There is no backend, and there will not be one — `adr:0001-no-backend-byok`. But a wiki
that grows past a few hundred pages has questions nobody can answer by opening files one at
a time: which sources a page rests on, what decision replaced what and when, which pages
nothing reaches, where a claim about this topic actually came from. Those are the questions
the product exists to answer, and today nothing in the plan computes them.

Two things in the plan already circle the same work without naming it. Group 7 walks the
whole project to report broken wikilinks, unreachable pages, sources nobody cited and
provenance that resolves to nothing. Group 9 exposes `search` over pages and source text.
**Those are the same traversal, written twice**, and both are currently unowned code
sitting in the Electron main process.

This record exists because two earlier decisions say the obvious move is not free:

- The plan's out-of-scope list refuses **an inverted index, embeddings or a vector store**,
  allowing only full-text search over the files.
- `adr:0005-wasapi-capture-in-a-minimal-sidecar` says everything that is not audio capture
  lives on the JavaScript side, and predicts this exact moment: *"a new method deserves an
  ADR that supersedes this one, not one more line in an enum."*

The second is not actually violated by what follows — nothing here adds a method to the
recorder, whose contract stays the six calls it has. But the sentence "everything else
lives on the JavaScript side" was written when the only Rust in the project was the
recorder, and it is being narrowed here rather than quietly ignored.

## Decision

**Proposed, not accepted.** Two questions below have to be answered by a person before this
becomes real.

A second Rust binary, `ow.exe`, owns the derived view of a project: a lexical index over
pages and source text, and a graph of entities, wikilinks, provenance edges and supersession
chains. It is driven by a command line, prints JSON, and is called as a subprocess by both
the MCP server and the UI — the same way, so there is one implementation of "what does this
project contain".

```
ow index build <project>            rescan and rebuild; always safe to run
ow index status <project>           what is stale, and why
ow search <project> "cutover"       lexical hits with page or source, passage, anchor
ow graph neighbors <id>             what links here and what this links to
ow graph sources <id>               transitively, which sources this page rests on
ow graph superseded <id>            what was replaced on this page, when, and by what
ow graph orphans                    entities nothing reaches from index.md
ow check <project>                  the integrity findings of group 7
```

Three constraints are the whole decision:

**The index is derived, and never a source of truth.** Anything `ow` holds must be
reproducible by rescanning `wiki/` and `raw/`. Deleting the index directory is a supported
recovery, not a data loss. `adr:0002-workspace-as-a-local-markdown-folder` says the folder
is the product; the moment the index knows something the files do not, editing a page in
Obsidian starts corrupting state and the folder stops being the truth.

**The query surface is structural, never natural language.** `ow` does not interpret a
question. `adr:0003-mcp-as-the-only-bridge-to-the-llm` puts every model call on the agent's
side of the wire, and a binary that turned "how did we get here?" into a query would be an
LLM in the application by another name. The agent composes the query; `ow` answers it.

**The contract is the CLI, and it is small on purpose.** No shared code linked into
Electron, no second protocol. A process boundary with a printed contract is testable
without an application around it, scriptable by the user, and — as
`adr:0005-wasapi-capture-in-a-minimal-sidecar` found for the recorder — the thing that
stops a helper from becoming a second application.

## Consequences

Group 7 stops being separate work: the checks are graph queries, so they are written once
and exposed twice, in the UI and as the MCP tool of 7.6. Group 9's search stops being an
ad-hoc scan. The UI and the MCP server can no longer disagree about what a project
contains, because they ask the same binary.

Rust earns its place here for reasons that are not speed. A CLI invoked per query pays cold
start every time, which rules out a runtime that has to boot; the recorder already puts a
cargo workspace and a Windows build in this repository, so this is not a new language; and
one binary with nothing to install is what `adr:0009-distribution-through-github-releases`
already ships.

**The performance argument is deliberately not being made.** A workspace of two thousand
pages is a few megabytes of text. Node scans that faster than a person notices, and anyone
claiming this engine is needed for speed at MVP scale is wrong. What justifies it is having
one owner for the derived view and a contract narrow enough to test — if that is not
convincing on its own, this record should be rejected rather than propped up with a
benchmark nobody ran.

Costs, stated plainly:

- **A second binary to build, sign, ship and version.** Every release now has two artifacts
  whose versions must agree, and a mismatched pair fails in a way that looks like corrupted
  data rather than a bad install.
- **Staleness becomes a visible state.** A file edited outside the application makes the
  index wrong until something notices. Either the application watches the folder, or every
  query pays a freshness check, or the user sees stale answers. None of the three is free,
  and this is the failure mode most likely to reach a user.
- **The boundary will be pushed on.** The first time a query needs something the CLI does
  not print, passing it over the boundary will look wasteful next to just linking a
  library. That is the pressure `adr:0005-wasapi-capture-in-a-minimal-sidecar` documented,
  and the answer is the same: a new ADR, not a new flag.

## The two questions this record does not answer

**Does an inverted index enter scope?** The plan refuses one today, and lexical search over
a few megabytes genuinely does not need one. Accepting this ADR without answering means
building an engine whose main verb is explicitly out of scope. Embeddings and a vector store
are a separate question again, and nothing here proposes them.

**Which one first?** The graph is where the modelling is hard and where nothing else in the
plan does the work — supersession chains and transitive provenance have no other owner.
Search is the part a scan already handles. Building the search first is the version of this
proposal most likely to be a rewrite of something that already worked.
