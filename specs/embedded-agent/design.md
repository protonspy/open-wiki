# Embedded agent — design

## What changes

A chat pane is added to the desktop shell, and an embedded agent runs behind it in the
Electron main process. The agent is a DeepAgents `createDeepAgent` graph, scoped to the open
project, that reads the project with the harness set and writes `wiki/` only through the
validated store. `adr:0019` decided that this may exist; this design is how.

Three new things, and each is load-bearing:

1. **A `BackendProtocol` implementation that is the guardrail by scope** —
   `apps/desktop/src/main/agent/wiki-gate-backend.ts`. It implements the same interface
   `StateBackend` and `FilesystemBackend` implement (`ls`, `read`, `write`, `edit`, `glob`,
   `grep`). Reads (`ls`/`read`/`glob`/`grep`) operate on the real project directory, every
   path confined with `assertWithin(projectRoot)` from `@open-wiki/access`. Writes
   (`write`/`edit`) accept only paths that resolve inside `<projectRoot>/wiki/` and route
   them through the store: `gateWrite` to validate, then `writePage(projectRoot, pagePath,
   content, { kind: "agent" })` to write atomically, log the operation with origin `agent`,
   and leave it undoable. A write to any other path returns an error and writes nothing.
   `execute` is not implemented, so the DeepAgents middleware hides the `execute` tool.

   The built-in `write_file`/`edit_file` tools are **kept and re-pointed** at this backend,
   not removed. ADR 0019 excludes "an agent toolkit's filesystem surface — `write_file`,
   `edit_file`, `execute`" as "a second writer with direct disk access." The exclusion is
   the *direct disk access*, not the names: backed by the gate, `write_file` and `edit_file`
   are the same door the editor uses (`writePage` with an origin), and `edit_file`'s
   exact-string replace is the optimized edit the product wants — it sends `old_string` and
   `new_string`, never the whole page. `execute` and `task` stay excluded (R4.4): `execute`
   because shell escapes any path rule (the DeepAgents middleware itself refuses to combine
   `permissions` with an execution-capable backend), `task` because `adr:0019` names
   subagents dangerous and v1 is one agent.

2. **The agent construction in `apps/desktop/src/main/agent/agent.ts`** —
   `createDeepAgent` with: `model = new ChatGroq({ model: <curated default>, apiKey })` read
   from `readSecrets` (the same Groq key the recorder uses); `backend = wikiGateBackend`;
   `systemPrompt` = the project's harness entry file, resolved at runtime and carried in
   unchanged (today `CLAUDE.md`; `plans/harness-portability.md` will write an entry file per
   harness — Codex, opencode, Claude — and a project may carry several, as renderings of one
   convention, so the resolver reads one and does not duplicate); `skills = [".claude/skills/"]`
   (the shared skills location `adr:0015` chose, loaded by the middleware's `read_file` from
   the same backend); `checkpointer = new MemorySaver()` keyed by a `thread_id` per
   conversation; `interruptOn` set for `write_file`, `edit_file`, `rename_page`,
   `delete_page`. No `subagents`. The convention is carried in, never re-authored —
   `generateClaudeMd` and `scaffoldSkills` already write the on-disk files the agent reads,
   and the harness-portability plan writes the same convention at each harness's paths.

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

Serves R1.1, R1.2, R1.3, R1.4, R1.5, R2.1, R2.2, R2.3, R2.4, R2.5, R3.1, R3.2, R4.1, R4.2,
R4.3, R4.4, R4.5, R5.1, R5.2, R5.3, R5.4, R6.1, R7.1.

## Boundaries and contracts

- **Process boundary.** The agent runs in main; the renderer only sends messages and
  renders events. Keys never cross to the renderer (the existing rule in `settings.ts`).
  The renderer has no `fetch` and the CSP is `default-src 'none'`; the Groq call happens in
  main, so no CSP change is needed.
- **The write boundary is the store, not a second writer.** `write_file`/`edit_file`/
  `rename_page`/`delete_page` call `gateWrite` + `writePage`/`supersedePage` + `appendOperation`
  from `@open-wiki/access` — the same path the editor and the hooks use. The agent never
  calls `atomicWrite` or `node:fs` directly. The `Origin` on every write is `{ kind: "agent"
  }`.
- **The read boundary is `assertWithin`.** Every read path is resolved and checked against
  the project root with the same `assertWithin` `packages/mcp` uses; a path that escapes
  throws `OutsideProjectError`, which the backend returns as a tool error.
- **IPC contract.** `chat:send({ text })`, `chat:resume({ decisions })`,
  `chat:cancel()`, and push `chat:event({ kind, ... })` where `kind` is `token` | `tool` |
  `interrupt` | `done` | `error`. Typed in `bridge.ts` `OwBridge`; the preload parity check
  (`preload.ts:104`) and `dispatch`'s unknown-channel throw (`ipc.ts`) enforce completeness.

## Data

- **`Origin`** — extended (or a new variant) to `{ kind: "agent" }`, alongside the
  existing origins, so the operation log distinguishes an agent write. The log and undo
  machinery (`appendOperation`, `undo`) are unchanged.
- **Conversation state** — a `MemorySaver` holding the LangGraph thread per `thread_id`.
  In memory only for v1; not on disk; not in the project directory.
- **Interrupt payload** — the proposed write: `{ tool, file_path, old_string?, new_string?,
  content? }`, rendered as a diff in the pane. Resume carries `decisions: [{ type:
  "approve" | "reject" | "edit", ... }]`.

## Alternatives considered

- **Own `create_page`/`edit_page` tools instead of re-pointing `write_file`/`edit_file`.**
   Rejected for v1: the product wants the optimized exact-string edit DeepAgents already
   ships, and re-pointing the built-in tools at a gate-backed backend reuses the middleware
   (line numbering, large-result eviction, permission filtering) instead of rebuilding it.
   The ADR's exclusion is honored by what the backend does (route through the store), not by
   the tool names.
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
   at spec time.

The hard-to-reverse choice — adopting DeepAgents as the harness — is already recorded in
`adr:0019`, which names `deepagents@1.12.1` and its allowlist. No new ADR is needed; the
gate-backed backend is reversible (it is our code, not a framework commitment).

## Risks

- **A well-formed and wrong page passes the gate.** This is `adr:0019`'s stated cost; the
  mitigation is the human-in-the-loop approval (R5), not the gate. The interrupt shows the
  proposed change so a human can reject a plausible-but-wrong page.
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