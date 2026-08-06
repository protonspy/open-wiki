---
autonomy: auto
ci: wait
---

# Embedded agent — requirements

Enabled by `adr:0019-an-embedded-agent-that-reads-freely-and-writes-through-the-gate`,
which narrowed `adr:0013` to allow the application to run an embedded agent. This spec
is the first thing that record's "Consequences" section calls for.

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
- **R1.6** (ADDED) The chat pane shall show which model the embedded agent is running,
  and shall offer starting a new conversation.
- **R1.7** (ADDED) While a run is in flight, the chat pane shall show that it is, in the
  transcript rather than as a hint that disappears when the user types.

## R2 · The embedded agent runtime

- **R2.1** The embedded agent shall run in the Electron main process, scoped to the open
  project directory, and the renderer shall reach it only over IPC.
- **R2.2** The embedded agent shall use Groq as its model, via `ChatGroq`, with the same
  Groq credential the recorder uses for transcription; no second credential shall be
  introduced.
- **R2.3** (MODIFIED) The embedded agent's `system` slot shall carry a fixed,
  application-authored system prompt that frames what the wiki is and how the agent shall
  behave within it — product-level framing the project cannot override — and the project's
  harness entry file and scaffolded skills shall be carried in unchanged as the agent's
  **first user message** and its skill source, not as the system prompt. The harness entry is
  the user's instruction, not the system's rules: a project's `CLAUDE.md` can direct the
  agent's work, but it does so from the lesser trust position of a user message, and the
  fixed system prompt is the only hand-authored prompt the agent carries. (Replaces the
  earlier "no hand-written system prompt shall be added beside them": the fixed prompt is now
  application code, not project content, and is what the agent is before any project is
  opened.) The scaffolded skills are loaded by the middleware's `read_file` unchanged, as
  before; only the harness entry's slot moves, from `system` to the first user message.
- **R2.9** (ADDED) The embedded agent shall assemble each conversation in this order: the
  fixed system prompt, then the project's harness entry file as the first user message of the
  thread, then the conversation history. The harness entry shall be injected once per
  conversation — on the first turn of a thread, ahead of the user's first message — and
  carried by the checkpointer for every subsequent turn, so it is neither re-sent on later
  turns nor lost across the turns of one conversation. The embedded agent shall resolve the
  harness entry deterministically: `CLAUDE.md` at the project root when it is present,
  otherwise `AGENTS.md` when no `CLAUDE.md` is present — both are renderings of one
  convention, and the precedence is fixed rather than ambiguous. A project that carries
  neither sends no first user message, leaving the fixed system prompt alone with the
  conversation.
- **R2.4** While the project has no Groq credential, the desktop application shall disable
  the embedded agent and state in the settings screen that a Groq key is required for the
  agent and serves transcription and the agent both.
- **R2.5** The settings screen shall offer the agent's model as a selection the user
  chooses, drawn from the models the saved Groq key can access — the list Groq's
  `/models` endpoint returns — with `openai/gpt-oss-120b` as the default when it is
  available.
- **R2.6** The embedded agent shall send project content only to Groq; it shall not read
  tracing or telemetry environment variables, shall set tracing disabled before the agent's
  dependencies are imported (so library-level auto-initialization does not fire), and shall
  not transmit prompts, tool calls, or tool results to any third party.
- **R2.7** When the user saves a Groq key, the desktop application shall fetch the
  `/models` list as the key's validation, persist the returned list and the user's
  chosen model in the application data directory keyed by project, and shall not
  write either into the project directory or the repository.
- **R2.8** (ADDED) The desktop application shall restrict the agent's model to an allowlist
  — `allam-2-7b`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.6-27b` — so the
  settings screen offers, and the agent runs, only a model on the allowlist that the saved
  Groq key can access, and shall neither offer nor persist a model Groq offers that is not
  on the allowlist.

## R3 · Reading — unrestricted within the project

- **R3.1** The embedded agent's read tools (`ls`, `read_file`, `glob`, `grep`) shall read
  the project directory, and every path they touch shall be confined with `assertWithin` to
  the project root.
- **R3.2** If a read path resolves outside the project, then the embedded agent shall return
  an error and deny the request.
- **R3.3** If a read fails, then the embedded agent shall return an error and read nothing.
  A read fails when the path is a directory, is not a regular file, or is over the read
  limit. These reads run in the desktop's main process, so an unbounded read is the
  application's memory, and a raised exception is a failure the tool surface cannot report.

## R4 · Writing — only through the gate

- **R4.1** The embedded agent's `write_file` and `edit_file` tools shall write into `wiki/`
  only, through the validated store — `gateWrite` then `writePage` with origin `agent` —
  which validates frontmatter, resolves wikilinks and citations, writes atomically, logs the
  operation, and leaves it undoable.
- **R4.2** The embedded agent shall have `rename_page` and `delete_page` tools that act on
  wiki pages through the validated store with origin `agent`, each a single undoable
  operation. `rename_page` writes the new page through `gateWrite` + `writePage` and marks
  the old superseded by it. `delete_page` is gated removal — snapshot then unlink, one
  operation, undoable — using a gated delete primitive in `@open-wiki/access`. The desktop's
  existing `deletePage` writes with `node:fs` and a hardcoded origin, so it shall not be
  reused.
- **R4.7** If a `rename_page` fails partway, then the embedded agent shall roll back every
  file it wrote — both pages and the wiki's own records — to the content they had before it
  started, and report the failure, naming the rollback separately if that fails too. A
  rename half-applied leaves one entity live twice with nothing saying which is current, and
  a changelog left announcing a rename that never happened is the record a reader trusts.
- **R4.3** If a write path resolves outside wiki, then the embedded agent shall return an
  error and write nothing.
- **R4.4** The embedded agent shall not expose the `execute` (shell) or `task` (subagent)
  tools; no shell command shall run and no subagent shall spawn from the embedded agent.
- **R4.5** The embedded agent shall carry the origin `agent` on every wiki write it makes,
  recorded in the operation log, so a bad run is one undo rather than an archaeology.
- **R4.6** The `rename_page` tool shall refuse to clobber an existing page, and the
  `rename_page` and `delete_page` tools shall refuse to operate on the wiki's index,
  changelog, and log pages.
- **R4.8** If an `edit_file` names an empty `old_string`, then the embedded agent shall return
  an error and write nothing. An empty match is a whole-page rewrite, and it is the one edit
  the preview R5.2 requires cannot render.

## R5 · Human-in-the-loop approval

- **R5.1** When the embedded agent calls a write tool, the embedded agent shall pause the
  run before the write executes and wait for a human decision.
- **R5.2** (MODIFIED) While a write is paused, the chat pane shall show the complete effect
  of the proposed change — the page slug, and the old and new content (or the rename/delete
  target), **with what actually differs between them marked** — and for an `edit_file` with
  `replace_all` shall show every match site (or the full resulting page), and shall offer
  approve, reject, and edit.
- **R5.3** When the user rejects a paused write, the tool shall not execute and the agent
  shall be told the write was rejected and not to retry it unless asked.
- **R5.4** When the user edits the arguments of a paused write, the tool shall execute with
  the edited arguments, and the gate shall validate them as if the agent had proposed them.
- **R5.5** When the user resumes a paused write, the embedded agent shall revalidate that the
  target page is unchanged since the interrupt and, if it has changed, shall return a fresh
  proposal rather than apply a stale edit.
- **R5.6** (ADDED) When a write pauses, the chat pane shall move the focus to the decision
  and shall bind approving and rejecting to the keyboard.
- **R5.8** (ADDED) While the user is editing a paused write's arguments, the chat pane shall not
  act on the approve or reject shortcut.
- **R5.7** (ADDED) While a write is paused, the chat pane shall not accept a message, and
  shall say why in place of the composer's prompt.

R5.2 asked for the _complete effect_ and got it as two blocks of near-identical
prose under **Replace** and **With**, which asks the reader to find the
difference by eye — on the one surface in this application where a person is
deciding whether a write lands. R5.6 and R5.7 are the rest of that same
argument: an approval loop is only worth having if answering it is cheap, and it
was mouse-only, unfocused, and interruptible by a message sent into a run that
had already stopped.

R5.8 is R5.6's own hazard, found by a security review of the change that added
it. The edit box of R5.4 is inside the card the shortcut is bound on, so a
keystroke in it reaches the shortcut — and both chords already mean something in
a text field. `Ctrl+Enter` is the submit reflex, and it approved the **original**
proposal while discarding the edit the user opened the box to make;
`Ctrl+Backspace` is delete-previous-word, and it rejected the whole write. Either
one lands or discards a write the human did not decide on, which is the single
thing R5.1 through R5.5 exist to prevent.

## R6 · The line is proved, not configured

- **R6.1** The embedded agent shall be unable to write to disk except through the validated
  store, so that no permissive configuration can let a write escape the gate; the `execute`
  and `task` tools shall not be exposed.

## R7 · Conversation state

- **R7.1** The embedded agent shall keep conversation state in memory, keyed by a thread id,
  one per conversation, and shall resume a paused run from the same thread.
- **R7.2** The chat channels shall carry a thread id and a run id, one conversation per
  project window, and a resume shall reference the interrupt id it answers; the push events
  shall be discriminated by kind — token, tool, interrupt, done, or error — each with the
  fields its kind requires.

## Out of scope

- Durable conversation persistence across application restarts (in-memory for v1; a
  checkpointer on disk is a later spec).
- Subagents (`task`) and shell execution (`execute`) — excluded by R4.4 and by `adr:0019`.
- A second LLM provider (OpenAI, Anthropic). Groq only for v1, per `adr:0019`'s "second
  credential purpose."
- MCP-over-HTTP (`adr:0018`, unbuilt). The embedded agent reads the project directly; it does
  not go through the MCP server.
- Re-authoring the convention. The harness entry (`CLAUDE.md` / `AGENTS.md`) and the
  scaffolded skills are carried in unchanged; the fixed system prompt (R2.3) frames the wiki
  and the agent's behavior at the product level, and does not re-state or override the
  convention.
