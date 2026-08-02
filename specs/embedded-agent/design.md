# Embedded agent — design

## What changes

A chat pane is added to the desktop shell, and an embedded agent runs behind it in the
Electron main process. The agent is a DeepAgents `createDeepAgent` graph, scoped to the open
project, that reads the project with the harness set and writes `wiki/` only through the
validated store. `adr:0019` decided that this may exist; this design is how.

Three new things, and each is load-bearing:

1. **A `BackendProtocolV2` implementation that is the guardrail by scope** —
   `apps/desktop/src/main/agent/wiki-gate-backend.ts`. It implements `BackendProtocolV2`:
   `ls`, `read`, `readRaw`, `write`, `glob`, and `grep` (required) and `edit` (inherited from
   the v1 protocol); `delete` is optional and is not implemented (the custom `delete_page`
   tool uses the access primitive below, not `backend.delete`). (The bare `BackendProtocol`
   export is the deprecated v1 alias; `WikiGateBackend` implements v2.) Reads
   (`ls`/`read`/`readRaw`/`glob`/`grep`) operate on the real project directory, every path
   confined with `assertWithin(projectRoot)` from `@open-wiki/access`. Writes (`write`/`edit`)
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
   the *direct disk access*, not the names: backed by the gate, `write_file` and `edit_file`
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
   `/conversation_history/<id>`) — the *same* `WikiGateBackend.write`. Those paths lie outside
   `wiki/`, so the gate rejects them: the write returns an error, no file is created, and the
   model receives a truncated preview plus "the result could not be saved." The eviction path
   therefore fails closed through the gate — it is not a second writer. (If `createDeepAgent`
   exposes the eviction threshold, set it to `null` to skip the attempt entirely; either way
   the gate is the line.)

2. **The agent construction in `apps/desktop/src/main/agent/agent.ts`** —
   `createDeepAgent` with: `model = new ChatGroq({ model: <curated default>, apiKey })` read
   from `readSecrets` (the same Groq key the recorder uses); `backend = wikiGateBackend`;
   `systemPrompt` = the project's harness entry file, resolved at runtime and carried in
   unchanged (today `CLAUDE.md`; `plans/harness-portability.md` will write an entry file per
   harness — Codex, opencode, Claude — and a project may carry several, as renderings of one
   convention, so the resolver reads one — chosen deterministically from the scaffold metadata
   or the active harness, rejecting ambiguity before the agent is constructed — and does not
   duplicate); `skills = [".claude/skills/"]`
   (the shared skills location `adr:0015` chose, loaded by the middleware's `read_file` from
   the same backend); `checkpointer = new MemorySaver()` keyed by a `thread_id` per
   conversation; `interruptOn` set for `write_file`, `edit_file`, `rename_page`, `delete_page`;
   `tools = [renamePageTool, deletePageTool]` (the two custom tools, as tool objects — `tools`
   takes tool objects, not a string allowlist).

   The `task` (subagent) tool is removed at construction, not merely unused: `createDeepAgent`
   auto-adds a general-purpose subagent — which provides `task` — unless the harness profile
   disables it, and `subagents: []` alone does **not** suffice. So a Groq harness profile is
   registered once, at module load, via the exported `registerHarnessProfile("groq",
   createHarnessProfile({ generalPurposeSubagent: { enabled: false } }))` — the first argument
   is the provider key `createDeepAgent` resolves for the model (`getModelProvider(ChatGroq)`,
   expected to be `"groq"`; the implementer confirms), so an unknown model that would otherwise
   fall back to `EMPTY_HARNESS_PROFILE` instead gets this profile. With the general-purpose
   subagent disabled, the `task` tool is never built. `execute` is never built because
   `WikiGateBackend` is not a sandbox backend. The filesystem tools (`ls`, `read_file`,
   `write_file`, `edit_file`, `glob`, `grep`) are auto-attached by `createDeepAgent` from the
   harness profile; they are re-pointed at `WikiGateBackend` because that is the `backend`, so
   `write_file`/`edit_file` route through the gate. The convention is carried in, never
   re-authored — `generateClaudeMd` and `scaffoldSkills` already write the on-disk files the
   agent reads, and the harness-portability plan writes the same convention at each harness's
   paths.

   No tracing or telemetry is enabled for the agent's runs. The agent path sets
   `LANGCHAIN_TRACING_V2=false` (and unsets `LANGSMITH_*`) before the agent's dependencies are
   imported — at the start of main, ahead of any `langchain` / `@langchain/*` import — and
   reads no `LANGCHAIN_*` / `LANGSMITH_*` environment variable; project content the agent reads
   is sent only to Groq. LangChain/LangGraph can auto-initialize LangSmith from those env vars
   at import time, before the agent path runs — disabling tracing before the import is what
   closes that, not merely refusing to read the vars in our own code. (A developer who sets
   them globally would otherwise export the project directory to a third party.)

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
`settings.ts` already validates it against `/models`. The settings screen gains the
two-purpose notice and the curated model list. `stack.md` gains `deepagents`,
`@langchain/groq`, `@langchain/langgraph`, `langchain`, and `@langchain/core`.

Serves R1.1, R1.2, R1.3, R1.4, R1.5, R2.1, R2.2, R2.3, R2.4, R2.5, R2.6, R3.1, R3.2, R4.1,
R4.2, R4.3, R4.4, R4.5, R4.6, R5.1, R5.2, R5.3, R5.4, R5.5, R6.1, R7.1, R7.2.

## Boundaries and contracts

- **Process boundary.** The agent runs in main; the renderer only sends messages and
  renders events. Keys never cross to the renderer (the existing rule in `settings.ts`).
  The renderer has no `fetch` and the CSP is `default-src 'none'`; the Groq call happens in
  main, so no CSP change is needed.
- **The write boundary is the store, not a second writer.** `write_file`/`edit_file`/
  `rename_page`/`delete_page` call `gateWrite` + `writePage`/`supersedePage` + `appendOperation`
  from `@open-wiki/access` — the same path the editor and the hooks use. The agent never
  calls `atomicWrite` or `node:fs` directly. The `Origin` on every write is `"agent"`.
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
  half-applied rename. Deletion is supersession (the page is marked superseded, not unlinked,
  so it stays visible in history and is one undo). `renamePage` writes the new page through
  `gateWrite` + `writePage` and marks the old superseded in the same operation, refuses to
  clobber an existing target, and refuses the wiki's index, changelog, and log (`gateWrite`
  passes those `NON_ENTITY_PAGES` with no content validation — R4.6 closes that for the
  agent). `deletePage` refuses the same set.
- **Conversation state** — a `MemorySaver` holding the LangGraph thread per `thread_id`.
  In memory only for v1; not on disk; not in the project directory.
- **Interrupt payload** — the proposed write: `{ tool, file_path, old_string?, new_string?,
  content? }`, rendered as a diff in the pane, plus a content hash of the page at interrupt
  time. For `edit_file` with `replace_all`, the payload carries every match site (or the full
  resulting page), so the human sees the complete effect of the tool call, not only the two
  strings — a short `old_string` that matches in several places must not be smuggled past
  review. Resume carries `decisions: [{ type: "approve" | "reject" | "edit", ... }]` and the
  `interrupt_id` it answers. On resume the backend revalidates the page against the stored
  hash; if another writer changed it in the window between interrupt and resume, the stale
  edit is not applied — the run re-interrupts with a fresh proposal (R5.5).

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
  tracing client (R2.6); a user who sets them globally does not expose the agent's runs.
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