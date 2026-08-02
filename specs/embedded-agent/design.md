# Embedded agent — design

## What changes

A chat pane is added to the desktop shell, and an embedded agent runs behind it in the
Electron main process. The agent is a langchain `createAgent` graph with an explicit deepagents
middleware stack, scoped to the open project, that reads the project with the harness set and
writes `wiki/` only through the validated store. `adr:0019` decided that this may exist; this
design is how.

Three new things, and each is load-bearing:

1. **A `BackendProtocolV2` implementation that is the guardrail by scope** —
   `apps/desktop/src/main/agent/wiki-gate-backend.ts`. It implements `BackendProtocolV2`:
   `ls`, `read`, `readRaw`, `write`, `glob`, and `grep` (required) and `edit` (inherited from
   the v1 protocol); `delete` is optional and is not implemented (the custom `delete_page`
   tool uses the access primitive below, not `backend.delete`). (The bare `BackendProtocol`
   export is the deprecated v1 alias; `WikiGateBackend` implements v2.) Reads
   (`ls`/`read`/`readRaw`/`glob`/`grep`) operate on the real project directory, every path
   confined with `assertWithin(projectRoot)` from `@open-wiki/access`, and every read taken
   through one guarded helper: stat, refuse a directory or a non-regular file, refuse a file
   over the read limit, and never throw (R3.3). One helper rather than a check per call site,
   because these run in the desktop's **main** process — an unbounded read is the
   application's memory, and an exception raised out of the backend is a failure the tool
   surface has no way to report. Writes (`write`/`edit`)
   accept only paths that resolve inside `<projectRoot>/wiki/` and route them through the
   store: `gateWrite` to validate, then `writePage(projectRoot, pagePath, content, "agent")` to
   write atomically, log the operation with origin `agent`, and leave it undoable. `edit` is a
   logical replacement, not a partial write: the backend reads the page, applies the
   exact-string replacement (`replace_all` supported), and writes the full resulting page
   atomically through `writePage` — the gate validates the whole new page, not the diff. A
   write to any other path returns an error and writes nothing. `execute` is not implemented,
   so `WikiGateBackend` is not a sandbox backend (`isSandboxBackend` is false) and the
   DeepAgents middleware filters the `execute` tool.

   The built-in `write_file`/`edit_file` tools are **kept and re-pointed** at this backend,
   not removed. ADR 0019 excludes "an agent toolkit's filesystem surface — `write_file`,
   `edit_file`, `execute`" as "a second writer with direct disk access." The exclusion is
   the _direct disk access_, not the names: backed by the gate, `write_file` and `edit_file`
   are the same door the editor uses (`writePage` with an origin), and `edit_file`'s
   exact-string replace is the optimized edit the product wants — it sends `old_string` and
   `new_string`, never the whole page. `execute` and `task` stay excluded (R4.4): `execute`
   because the backend does not implement it (the middleware then hides it; shell escapes any
   path rule anyway — the middleware itself refuses to combine `permissions` with an
   execution-capable backend), `task` because `adr:0019` names subagents dangerous and v1 is
   one agent.

   The middleware's own large-result eviction is also confined by this. When a tool result
   exceeds the token threshold, the filesystem middleware evicts it by calling
   `backend.write("/large_tool_results/<id>.txt", …)` (and human messages to
   `/conversation_history/<id>`) — the _same_ `WikiGateBackend.write`. Those paths lie outside
   `wiki/`, so the gate rejects them: the write returns an error, no file is created, and the
   model receives a truncated preview plus "the result could not be saved." The eviction path
   therefore fails closed through the gate — it is not a second writer. The eviction threshold
   is set to `null` on the filesystem middleware (`toolTokenLimitBeforeEvict: null`), so the
   attempt to write the overflow to disk is skipped entirely; the gate would reject the
   eviction path regardless.

2. **The agent construction in `apps/desktop/src/main/agent/agent.ts`** —
   `createAgent` (langchain) with an explicit middleware stack: `model = new ChatGroq({ model: <selected>, apiKey })` — the selected
   model read from the per-project agent prefs (default `openai/gpt-oss-120b`), the key read
   from `readSecrets` (the same Groq key the recorder uses, injected as `apiKey`, never into `process.env`); `backend = wikiGateBackend`;
   `systemPrompt` = the project's harness entry file, resolved at runtime and carried in
   unchanged (today `CLAUDE.md`; `plans/harness-portability.md` will write an entry file per
   harness — Codex, opencode, Claude — and a project may carry several, as renderings of one
   convention, so the resolver reads one — chosen deterministically from the scaffold metadata
   or the active harness, rejecting ambiguity before the agent is constructed — and does not
   duplicate); `skills = [".claude/skills/"]`
   (the shared skills location `adr:0015` chose, loaded by the middleware's `read_file` from
   the same backend); `checkpointer = new MemorySaver()` keyed by a `thread_id` per
   conversation; `interruptOn` set for `write_file`, `edit_file`, `rename_page`, `delete_page`,
   applied through langchain's `humanInTheLoopMiddleware({ interruptOn })` in the middleware
   stack; `tools = [renamePageTool, deletePageTool]` (the two custom tools, as tool objects —
   `tools` takes tool objects, not a string allowlist).

   The `task` (subagent) tool is absent because the subagent middleware is not in the stack —
   not disabled by a profile. `createDeepAgent` makes `SubAgentMiddleware` required (so `task`
   is always emitted) and its harness-profile switch does not reach a `ChatGroq` instance:
   `getModelProvider` has no `ChatGroq` mapping, so the profile lookup for any Groq instance is
   always `EMPTY_HARNESS_PROFILE`, and `task` plus the general-purpose subagent would always be
   built. Assembling the stack ourselves — langchain `createAgent` with deepagents'
   `createFilesystemMiddleware({ backend, toolTokenLimitBeforeEvict: null })`,
   `createSkillsMiddleware`, `createSummarizationMiddleware`, `createPatchToolCallsMiddleware`,
   and langchain's `humanInTheLoopMiddleware({ interruptOn })` — is what makes `task` genuinely
   absent rather than present-but-dead, and keeps the `ChatGroq` instance so the Groq key is
   injected as `apiKey`, not into `process.env`. `execute` is never built because
   `WikiGateBackend` is not a sandbox backend (`isSandboxBackend` is false), so the filesystem
   middleware filters it. The filesystem tools (`ls`, `read_file`, `write_file`, `edit_file`,
   `glob`, `grep`) are provided by `createFilesystemMiddleware` and re-pointed at `WikiGateBackend`
   because that is the `backend`, so `write_file`/`edit_file` route through the gate. The
   convention is carried in, never re-authored — `generateClaudeMd` and `scaffoldSkills`
   already write the on-disk files the agent reads, and the harness-portability plan writes the
   same convention at each harness's paths.

   No tracing or telemetry is enabled for the agent's runs. The agent path forces every
   switch `@langchain/core` reads — `LANGSMITH_TRACING_V2`, `LANGCHAIN_TRACING_V2`,
   `LANGSMITH_TRACING`, `LANGCHAIN_TRACING` — to `"false"`, because `isTracingEnabled` turns
   tracing on when _any one of them_ reads `"true"`, and clears the transports that would carry
   the same spans elsewhere: `LANGSMITH_TRACING_MODE`, the legacy `LANGSMITH_OTEL_ENABLED` /
   `OTEL_ENABLED` pair, and `LANGSMITH_RUNS_ENDPOINTS` (the replica list, which carries its own
   api keys, so clearing `LANGSMITH_ENDPOINT` alone would not clear it). All of it before the
   agent's dependencies are imported — at the start of main, ahead of any `langchain` / `@langchain/*` import — and
   reads no `LANGCHAIN_*` / `LANGSMITH_*` environment variable; project content the agent reads
   is sent only to Groq. LangChain/LangGraph can auto-initialize LangSmith from those env vars
   at import time, before the agent path runs — disabling tracing before the import is what
   closes that, not merely refusing to read the vars in our own code. (A developer who sets
   them globally would otherwise export the project directory to a third party.)

   "Before the import" is an ordering property of the whole module graph, not of one file:
   ES modules evaluate each import to completion in written order, so `agent.ts` holding the
   guard on line 1 does nothing for a sibling that imports `@langchain/langgraph` on its own
   account and reaches `agent.ts` second. The rule is therefore that **every** module which
   imports `langchain` / `@langchain/*` at any depth imports `agent/tracing.js` on its first
   line, and `tests/agent.spec.ts` asserts it by sweeping `src/main` — a new importer that
   forgets fails the suite rather than leaking quietly.

3. **The IPC surface and the chat pane** — new channels in
   `apps/desktop/src/main/channels.ts`: `chat:send`, `chat:resume`, `chat:cancel`, and a
   push channel `chat:event`. `agent.ts` runs `agent.streamEvents(input, { version: "v3" })`
   and forwards token, tool-call, and interrupt events to the renderer over `chat:event`.
   The renderer's `Chat.tsx` (a new pane component, sibling of `Sources.tsx`) registers in
   `navigation.ts` (widen `Pane`), `Rail.tsx` (`PANES`), and `App.tsx` (the pane switch),
   following the `reloadKey` + `bridge()` + live-guard pattern the other panes use. The
   interrupt event renders the proposed write and the approve/reject/edit controls; the
   user's decision comes back over `chat:resume` as a DeepAgents `Command({ resume: {
decisions } })`.

The credential is reused, not duplicated: `readSecrets` already returns the Groq key;
`settings.ts` already validates it against `/models`, and that validation call is where the
agent's model list comes from. The `/models` response body is captured on save and persisted
as the available-models list, with the user's selection, in the application data directory
keyed by project (a sibling file to the secrets file — the model list is not a secret, so it
is not folded into `ProjectSecrets`). The settings screen gains the two-purpose notice and
the model selection drawn from that list, with `openai/gpt-oss-120b` as the default.
`stack.md` gains `deepagents`, `@langchain/groq`, `@langchain/langgraph`, `langchain`, and
`@langchain/core`.

Serves R1.1, R1.2, R1.3, R1.4, R1.5, R2.1, R2.2, R2.3, R2.4, R2.5, R2.6, R2.7, R3.1, R3.2, R4.1,
R4.2, R4.3, R4.4, R4.5, R4.6, R5.1, R5.2, R5.3, R5.4, R5.5, R6.1, R7.1, R7.2.

## Boundaries and contracts

- **Process boundary.** The agent runs in main; the renderer only sends messages and
  renders events. Keys never cross to the renderer (the existing rule in `settings.ts`).
  The renderer has no `fetch` and the CSP is `default-src 'none'`; the Groq call happens in
  main, so no CSP change is needed.
- **The write boundary is the store, not a second writer.** `write_file`/`edit_file`/
  `rename_page` call `gateWrite` + `writePage`/`supersedePage` + `appendOperation` from
  `@open-wiki/access`; `delete_page` is gated removal — snapshot + unlink + `appendOperation`,
  through the new `deletePage` primitive in `@open-wiki/access` (the desktop's `node:fs`
  delete is not reused). The agent never calls `atomicWrite` or `node:fs` directly. The
  `Origin` on every write is `"agent"`.
- **The read boundary is `assertWithin`.** Every read path is resolved and checked against
  the project root with the same `assertWithin` `packages/mcp` uses; a path that escapes
  (including a symlink or junction inside the project that points outside — the realistic
  escape on Windows, the only supported platform) throws `OutsideProjectError`, which the
  backend returns as a tool error. The harness entry file (the agent's system prompt) is
  resolved and read in main with the same `assertWithin` + real-path check, not a bare
  `node:fs` read; the scaffolded skills are loaded by the middleware's `read_file` through the
  backend, so they are confined too.
- **IPC contract.** `chat:send({ text, thread_id })`, `chat:resume({ decisions, interrupt_id,
run_id })`, `chat:cancel({ run_id })`, and push `chat:event({ kind, thread_id, run_id, ... })`
  where `kind` is `token` | `tool` | `interrupt` | `done` | `error`, each carrying the fields
  its kind requires (an `interrupt` carries the tool, file path, old/new content or the full
  resulting page for `replace_all`, or the rename/delete target, plus an `interrupt_id` and a
  content hash of the page at interrupt time; a `tool` event carries the call and its result).
  One `MemorySaver` — and one agent instance — is scoped to the project window, keyed by
  `thread_id`. Typed in `bridge.ts` `OwBridge`; the preload parity check (`preload.ts:104`) and
  `dispatch`'s unknown-channel throw (`ipc.ts`) enforce completeness.

## Data

- **`Origin`** — the `Origin` union in `@open-wiki/access` (today `"editor" | "cli" | "hook"
| "observer"`) is extended with `"agent"`, a string variant alongside the existing ones,
  so the operation log distinguishes an agent write. The log and undo machinery
  (`appendOperation`, `undo`) are unchanged.
- **Gated, atomic rename and delete primitives.** `@open-wiki/access` exports no
  `deletePage` or `renamePage`; the desktop's `deletePage` (`apps/desktop/src/main/edit.ts`)
  calls `node:fs.rmSync` directly and hardcodes `origin: "editor"`, bypassing the gate. New
  `deletePage(projectRoot, pagePath, origin)` and `renamePage(projectRoot, oldPath, newPath,
origin)` primitives are added, each a single atomic operation: snapshot the affected pages,
  gate + write, record one operation with the given origin, and roll back on failure — no
  half-applied rename. Deletion is gated removal: the page is snapshotted then unlinked in
  one operation with the given origin, undoable like any observed write — matching the
  codebase convention, where a deleted page's record is the changelog entry and a dangling
  reference to it is an expected finding (`checks.ts`). Supersession names a real replacement
  (`superseded-by`), which a deletion has none of, so deletion is not supersession.
  `renamePage` writes the new page through
  `gateWrite` + `writePage` and marks the old superseded in the same operation, refuses to
  clobber an existing target, and refuses the wiki's index, changelog, and log (`gateWrite`
  passes those `NON_ENTITY_PAGES` with no content validation — R4.6 closes that for the
  agent). `deletePage` refuses the same set.
- **Conversation state** — a `MemorySaver` holding the LangGraph thread per `thread_id`.
  In memory only for v1; not on disk; not in the project directory. The renderer half of that
  state — the transcript, and the `thread_id` generated once per window — lives in the `Chat`
  component, so the pane is **mounted for the window's life and hidden when you are elsewhere**
  rather than unmounted on a pane switch. Unmounting resets both, and the fresh id then
  addresses a thread the main process has never checkpointed, which puts the conversation
  beyond recovery rather than merely off screen (R7.1).
- **Agent model selection** — the model the agent runs and the list Groq's `/models` returned
  for the saved key, persisted in the application data directory keyed by project (a sibling
  file to the secrets file — the model list is not a secret, so it is not folded into
  `ProjectSecrets`), never in the project directory or the repo. The agent reads the selected
  model and passes it to `ChatGroq`; the default is `openai/gpt-oss-120b` when the list
  contains it, falling back to the first model in the list otherwise.
- **Interrupt payload** — the proposed write: `{ tool, file_path, old_string?, new_string?,
content? }`, rendered as a diff in the pane, plus a content hash of the page at interrupt
  time. For `edit_file`, the payload carries a **preview** — every match site with its line,
  how many of the page's occurrences will be replaced, and the full resulting page — so the
  human sees the complete effect of the tool call, not only the two strings: a short
  `old_string` that matches in several places must not be smuggled past review.

  The preview is computed in the main process (`agent/edit-preview.ts`) at the moment the
  interrupt is pushed, because that is the earliest point it _can_ be. The HITL interrupt
  fires on the model's raw tool-call arguments, ahead of `WikiGateBackend.edit`, so nothing
  in the stack has yet counted the occurrences — rendering the arguments alone is exactly the
  smuggling case. Reading the page at push time also pairs it with the page-guard's hash,
  captured in the same window: if the page changes before the decision the guard refuses the
  write and the model re-proposes, which produces a fresh preview rather than a stale one. Resume carries `decisions: [{ type: "approve" | "reject" | "edit", ... }]` and the
  `interrupt_id` it answers. On resume a **page-guard middleware** (the last in the
  stack, so its `afterModel` runs before the HITL interrupt and its `wrapToolCall`
  runs last, just before the real write) revalidates the page against the hash it
  captured at proposal time; if another writer changed it in the window between
  interrupt and resume, the stale edit is not applied — the tool returns an error
  the model re-proposes from, which interrupts again as a fresh proposal (R5.5).
  The hash is carried in a closure map on the middleware, not in graph state — the
  agent is built once per window and the run loop is sequential for a thread, so a
  map keyed by thread and path survives the pause without a state-schema extension.
  Keyed by path alone it would not: one agent serves every thread in the window, so
  two threads proposing a write to the same page swap hashes, and the guard ends up
  off for both. The thread id is read from the runtime both hooks receive.

## Alternatives considered

- **Own `create_page`/`edit_page` tools instead of re-pointing `write_file`/`edit_file`.**
  Rejected for v1: the product wants the optimized exact-string edit DeepAgents already
  ships, and re-pointing the built-in tools at a gate-backed backend reuses the middleware
  (line numbering, large-result eviction, permission filtering) instead of rebuilding it.
  The ADR's exclusion is honored by what the backend does (route through the store), not by
  the tool names. The large-result eviction, re-pointed at the same backend, is itself
  gate-confined — it cannot reach disk outside `wiki/`.
- **`FilesystemBackend` with `permissions` for read-only project + a separate gate tool.**
  Rejected: `FilesystemBackend` writes to real disk, so `write_file`/`edit_file` would be a
  second writer unless separately disabled, and `permissions` is permissive when no rule
  matches (the failure mode `adr:0019` names). A custom backend makes confinement
  structural — there is no permissive default to misconfigure.
- **A separate `packages/agent` workspace package.** Deferred: the runtime is desktop-only
  for v1 (it lives in main and reads the desktop-held credential). It stays in
  `apps/desktop/src/main/agent/` alongside `recorder.ts` and `transcribe-run.ts`; it can be
  extracted when a second consumer appears.
- **Including `execute` and `task`.** Rejected: `execute` cannot be scope-guarded (shell
  escapes path rules), `task`/subagents are dangerous by `adr:0019`. Decided with the user
  at spec time. `task` is removed by disabling the general-purpose subagent in the Groq
  harness profile (the framework's own switch), not by a custom filter.

The hard-to-reverse choice — adopting DeepAgents as the harness — is already recorded in
`adr:0019`, which names `deepagents@1.12.1` and its allowlist. No new ADR is needed; the
gate-backed backend is reversible (it is our code, not a framework commitment).

## Risks

- **A well-formed and wrong page passes the gate.** This is `adr:0019`'s stated cost; the
  mitigation is the human-in-the-loop approval (R5), not the gate. The interrupt shows the
  proposed change so a human can reject a plausible-but-wrong page.
- **The system prompt is project-controlled.** The agent's instructions are the project's
  `CLAUDE.md` and skills, read from disk. Opening an untrusted project with the agent
  enabled is the trust decision: a malicious `CLAUDE.md` is the agent's rules, not just the
  content it reads, and it can instruct well-formed wrong pages that pass the gate. This is
  the accepted cost of carrying the convention in unchanged; human-in-the-loop is the only
  mitigation. The agent is the lesser door, not a harness.
- **The wiki's index, changelog, and log are `NON_ENTITY_PAGES`.** `gateWrite` passes them
  with no content validation — they are "themselves." R4.6 protects them against
  `rename_page`/`delete_page` (structural removal or replacement) but not against
  `write_file`/`edit_file`: an agent content edit to `wiki/index.md` is gated only by human
  approval, not by the gate's form checks. This is intentional — maintaining the index and the
  changelog is part of wiki maintenance, so the agent may edit them with approval, but may not
  rename or delete them.
- **Tracing exfiltration.** LangChain/LangGraph ship LangSmith tracing that activates on
  `LANGCHAIN_*` / `LANGSMITH_*` env vars and would send prompts, tool calls, and tool results
  (project content) to a third party. The agent path reads none of those env vars and sets no
  tracing client (R2.6); a user who sets them globally does not expose the agent's runs. The
  guard is only as good as its ordering, so it is asserted over the source rather than argued
  for in a comment — see the tracing paragraph above.
- **A rename half-applied.** `renamePage` writes two pages, so an I/O failure between them
  (a full disk, a Windows file lock, an antivirus scan) would leave the new page created
  while the old one still read `active` — one entity live twice, with nothing saying which is
  current, and an operation-log entry describing a state that never existed. The two writes
  and the records that follow them are wrapped: any throw rewinds both pages from the
  snapshot taken for the operation, restores `wiki/log.md`, `wiki/changelog.md` and
  `wiki/index.md` from a backup taken for this failure path only, and reports the failure
  (R4.7). The record pages are deliberately _not_ in the operation's snapshot: that snapshot
  is what `undo` replays, and undoing an old rename must not roll the changelog back over
  every entry written since. A rollback that itself throws is named in the reasons rather
  than swallowed — "rolled back" is a claim about the wiki's state, and a caller told only
  that would believe it.
- **The `/models` list includes models that cannot tool-call.** Groq's endpoint returns every
  model the key can access, not only chat models that tool-call, and it does not advertise
  tool support, so the list cannot be filtered mechanically. The user's explicit choice is
  honored (R2.5); a model that cannot tool-call fails at run time, surfaced in place by R1.4.
  The default `openai/gpt-oss-120b` is tool-capable, so the common path works — this is the
  trade for offering the raw list the user asked for instead of a curated one.
- **The DeepAgents `BackendProtocol` is an internal interface.** It is exported but not
  versioned as a stable public API; a `deepagents` upgrade could change it. Pinned in
  `package.json`; the proof tests (R6.1) would fail on a behaviour change, which is the
  signal to update.
- **Skills/`CLAUDE.md` shapes diverge.** `adr:0019` names this as luck, not foresight;
  `SKILLS_VERSION` is the only staleness signal. Carrying in unchanged means a divergence
  is silent; the agent would still run, reading the older shape.
- **Two writers of the wiki.** The external harness and the embedded agent share one
  convention (the generated files) but nothing enforces they agree at runtime. The
  operation log's `origin` field is the audit trail; concurrent writes are the user's to
  sequence.
