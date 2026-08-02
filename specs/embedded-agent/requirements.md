---
autonomy: auto
ci: wait
---

# Embedded agent — requirements

Enabled by `adr:0019-an-embedded-agent-that-reads-freely-and-writes-through-the-gate`,
which narrowed `adr:0013` to allow the application to run an embedded agent. This spec
is the first thing that record's "Consequences" call for.

## Purpose

A chat pane in the desktop application, backed by a DeepAgents agent that reads the open
project the way a harness does and writes the wiki only through the validated store. It is
the lesser door, for the user who downloaded the installer and has no harness — not an
equivalent to one. The agent consults (list, glob, grep, read) and maintains the wiki
(create, edit, rename, delete), with every wiki write paused for human approval before it
lands.

## R1 · The chat pane

- **R1.1** The desktop application shall present a chat pane in the shell rail, alongside
  wiki, sources, and checks.
- **R1.2** While a Groq credential is configured, the chat pane shall let the user send a
  message and shall stream the embedded agent's response into the pane.
- **R1.3** While no Groq credential is configured, the chat pane shall show an empty state
  that names the Groq key as the requirement and links to settings, and shall not accept a
  message.
- **R1.4** If an agent run errors, then the chat pane shall surface the error in place and
  preserve the conversation that produced it.
- **R1.5** The chat pane shall replace the "there is no model behind this window" copy
  shipped today with the empty state in R1.3, in any release that carries this feature.

## R2 · The embedded agent runtime

- **R2.1** The embedded agent shall run in the Electron main process, scoped to the open
  project directory, and the renderer shall reach it only over IPC.
- **R2.2** The embedded agent shall use Groq as its model, via `ChatGroq`, with the same
  Groq credential the recorder uses for transcription; no second credential shall be
  introduced.
- **R2.3** The embedded agent's instructions shall be the project's harness entry file —
  the file the project was scaffolded for its harness to read — and the scaffolded skills,
  carried in unchanged; no hand-written system prompt shall be added beside them. A project
  scaffolded for more than one harness carries more than one entry file, and they are
  renderings of one convention, so the embedded agent shall read one and shall not
  duplicate the convention in its prompt.
- **R2.4** While the project has no Groq credential, the desktop application shall disable
  the embedded agent and state in the settings screen that a Groq key is required for the
  agent and serves transcription and the agent both.
- **R2.5** The settings screen shall offer a curated model selection for the agent, not the
  raw provider model list, with one default chosen for tool-calling reliability.

## R3 · Reading — unrestricted within the project

- **R3.1** The embedded agent's read tools (`ls`, `read_file`, `glob`, `grep`) shall read
  the project directory, and every path they touch shall be confined with `assertWithin` to
  the project root.
- **R3.2** If a read path resolves outside the project, then the embedded agent shall return
  an error and deny the request.

## R4 · Writing — only through the gate

- **R4.1** The embedded agent's `write_file` and `edit_file` tools shall write into `wiki/`
  only, through the validated store — `gateWrite` then `writePage` with origin `agent` —
  which validates frontmatter, resolves wikilinks and citations, writes atomically, logs the
  operation, and leaves it undoable.
- **R4.2** The embedded agent shall have `rename_page` and `delete_page` tools that act on
  wiki pages through the same store, and that supersede a page rather than editing one when
  the operation is a supersession.
- **R4.3** If a write path resolves outside wiki, then the embedded agent shall return an
  error and write nothing.
- **R4.4** The embedded agent shall not expose the `execute` (shell) or `task` (subagent)
  tools; no shell command shall run and no subagent shall spawn from the embedded agent.
- **R4.5** The embedded agent shall carry the origin `agent` on every wiki write it makes,
  recorded in the operation log, so a bad run is one undo rather than an archaeology.

## R5 · Human-in-the-loop approval

- **R5.1** When the embedded agent calls a write tool, the embedded agent shall pause the
  run before the write executes and wait for a human decision.
- **R5.2** While a write is paused, the chat pane shall show the proposed change — the page
  slug, and the old and new content (or the rename/delete target) — and shall offer approve,
  reject, and edit.
- **R5.3** When the user rejects a paused write, the tool shall not execute and the agent
  shall be told the write was rejected and not to retry it unless asked.
- **R5.4** When the user edits the arguments of a paused write, the tool shall execute with
  the edited arguments, and the gate shall validate them as if the agent had proposed them.

## R6 · The line is proved, not configured

- **R6.1** The embedded agent shall be unable to write to disk except through the validated
  store, so that no permissive configuration can let a write escape the gate; the `execute`
  and `task` tools shall not be exposed.

## R7 · Conversation state

- **R7.1** The embedded agent shall keep conversation state in memory, keyed by a thread id,
  one per conversation, and shall resume a paused run from the same thread.

## Out of scope

- Durable conversation persistence across application restarts (in-memory for v1; a
  checkpointer on disk is a later spec).
- Subagents (`task`) and shell execution (`execute`) — excluded by R4.4 and by `adr:0019`.
- A second LLM provider (OpenAI, Anthropic). Groq only for v1, per `adr:0019`'s "second
  credential purpose."
- MCP-over-HTTP (`adr:0018`, unbuilt). The embedded agent reads the project directly; it does
  not go through the MCP server.
- Re-authoring the convention. The system prompt stays the generated `CLAUDE.md` plus the
  scaffolded skills.