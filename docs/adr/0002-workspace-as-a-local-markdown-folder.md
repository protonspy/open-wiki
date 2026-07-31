---
status: accepted
---

# 0002 · The workspace is a local markdown folder, unversioned

## Context

The product accumulates a project's documentation and has to answer "what is the current
state of project X, and how did we get here?". Where that content lives decides almost
everything downstream: who can read it, what happens when it changes, and what can be
recovered when someone gets it wrong.

The options were an embedded database, a service, or files. And within files there was
the sub-choice of versioning the folder with git — which would give per-line history for
free.

## Decision

The workspace is a folder on the user's disk, with one directory per project. Inside each
project, `raw/` holds the original sources, immutable once written, and `wiki/` holds the
pages in markdown.

Nothing in the application creates, reads or writes a git repository.

What replaces the history git would have given:

- **Every write is atomic** — temporary file plus rename — so that an application killed
  midway does not leave half a page behind.
- **Every write snapshots first** the pages it is about to touch, into a `.state/` folder
  that is not content.
- **Every write enters an operation log** with origin and timestamp, and any operation can
  be undone by its id.

## Consequences

The user owns their data in a format that Obsidian, VS Code, `grep` and any agent already
read. There is no tool to install and no repository concept for someone who is not a
developer, and the product stays simple to explain: it is a folder.

What is lost, without softening it:

- **There is no per-file history.** Nothing answers "when did this sentence appear and
  from which source" except what is written in the text itself — dates, provenance links,
  `log.md`. The supersession rules stop being the readable layer over the history and
  become **the** history.
- **There is no synchronisation and no implicit backup.** The workspace lives where the
  user put it. If they want to version or synchronise it themselves, the folder is
  compatible with that — but the application knows nothing about it.
- **The snapshot is the only net.** There is no merge, no branch, and no history to fall
  back to beyond the last recorded operation.

The corollary that sets the tone for the rest of the project: **since there is nowhere to
go back to, the defence has to be at the entrance.** That is what makes write-time
validation (`adr:0003-mcp-as-the-only-bridge-to-the-llm`) structural rather than hygienic.

The source repository of this project stays in git. Git is a tool for whoever develops the
application, not part of what the application ships.
