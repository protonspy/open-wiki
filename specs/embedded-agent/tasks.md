# Embedded agent — tasks

## 1 · The wiki-gate backend

- [x] 1.1 (Unit) Implement `WikiGateBackend.ls` over the project directory, confining every path with `assertWithin(projectRoot)` from `@open-wiki/access` — R3.1, R3.2
- [x] 1.2 (Unit) Implement `WikiGateBackend.read` (offset/limit, line-numbered) over the project directory, confined with `assertWithin` — R3.1, R3.2
- [x] 1.3 (Unit) Implement `WikiGateBackend.glob` and `grep` (literal, passage-level) over the project directory, confined with `assertWithin` — R3.1, R3.2
- [x] 1.4 (TDD) Implement `WikiGateBackend.write` to accept only paths inside `wiki/` and route them through `gateWrite` + `writePage(projectRoot, pagePath, content, "agent")` + `appendOperation`; watch red on a non-wiki path, then green when it returns an error and writes nothing — R4.1, R4.3, R4.5, R6.1
- [x] 1.5 (TDD) Implement `WikiGateBackend.edit` as exact `old_string`→`new_string` replace (`replace_all` supported) over a wiki page, routing through the store; assert it never rewrites the whole page and that a non-wiki path fails — R4.1, R4.3, R6.1
- [x] 1.6 (Unit) Omit `execute` from `WikiGateBackend` so it is not a sandbox backend and the DeepAgents middleware hides the `execute` tool — R4.4
- [x] 1.7 (Unit) Extend the `Origin` union in `@open-wiki/access` with the string variant `"agent"`, alongside `"editor" | "cli" | "hook" | "observer"`, so the operation log distinguishes an agent write — R4.5
- [x] 1.8 (Unit) Add gated, atomic `deletePage(projectRoot, pagePath, origin)` and `renamePage(projectRoot, oldPath, newPath, origin)` primitives to `@open-wiki/access`, each a single operation (snapshot affected pages, gate + write, one log entry, rollback on failure); deletion is gated removal (snapshot + unlink, one operation, undoable — the codebase convention, not supersession); rename marks the old page superseded by the new one; the desktop's existing `deletePage` calls `node:fs` with a hardcoded origin and shall not be reused — R4.2, R4.5
- [x] 1.9 (Unit) Implement `WikiGateBackend.readRaw` (confined with `assertWithin`, returning `FileData` as a `ReadRawResult`) — the required `BackendProtocolV2` read method — R3.1, R3.2
- [x] 1.10 (Unit) Roll `renamePage` back when any step after the first write fails, restoring both pages from the operation's snapshot and reporting the failure, so a rename is never half-applied — R4.7
- [x] 1.11 (Unit) Extend that rollback to every file the rename writes — `wiki/log.md`, `wiki/changelog.md`, `wiki/index.md` — backed up separately from the operation's snapshot, so a later `undo` of an old rename does not roll the changelog back over everything written since; and report a rollback that itself throws rather than claiming the wiki is intact — R4.7
- [x] 1.12 (Unit) Route every `WikiGateBackend` read through one guarded helper — stat, refuse a directory or a non-regular file, refuse a file over the read limit, and never throw — so `readRaw` and `edit` stop raising `EISDIR` out of the backend, one unreadable file no longer discards a whole `grep`, and no read pulls an arbitrary amount into the main process — R3.1, R3.3
- [x] 1.13 (TDD) Refuse an `edit_file` whose `old_string` is empty: `split("").join(s)` inserts between every character and the non-global branch prepends, so both branches rewrite the page — and `previewReplace` renders nothing for it, so the human would approve the most destructive edit there is with no preview shown — R4.8, R5.2

## 2 · The agent runtime

- [x] 2.1 (Unit) Build the agent in `apps/desktop/src/main/agent/agent.ts` with langchain `createAgent` and an explicit deepagents middleware stack: `model = new ChatGroq({ model: <selected>, apiKey })` (selected from the per-project agent prefs, default `openai/gpt-oss-120b`; `apiKey` from `readSecrets`, never `process.env`), `middleware = [createFilesystemMiddleware({ backend: wikiGateBackend, toolTokenLimitBeforeEvict: null }), createSkillsMiddleware({ backend, sources: [".claude/skills/"] }), createSummarizationMiddleware({ backend }), createPatchToolCallsMiddleware(), humanInTheLoopMiddleware({ interruptOn })]`, `checkpointer = new MemorySaver()` keyed by `thread_id`, `systemPrompt` = the resolved harness entry file, and `tools = [renamePageTool, deletePageTool]` as tool objects; the filesystem tools come from `createFilesystemMiddleware` and re-point at the backend — R2.1, R2.2, R2.3, R2.5, R2.7, R4.4, R7.1
- [x] 2.2 (Unit) Resolve the project's harness entry file (today `CLAUDE.md`, plural once `plans/harness-portability.md` lands) deterministically — from scaffold metadata or the active harness, rejecting ambiguity — and read it with `assertWithin` + a real-path check; use it as `systemPrompt` and the scaffolded skills as `skills`, both carried in unchanged; assert no hand-written prompt is appended beside them — R2.3
- [x] 2.3 (Unit) Implement `rename_page` and `delete_page` tools over the new atomic `renamePage`/`deletePage` primitives with origin `"agent"`; `rename_page` refuses to clobber an existing target and refuses the wiki index, changelog, and log; `delete_page` refuses the same set — R4.2, R4.5, R4.6
- [x] 2.4 (Unit) Make the `task` (subagent) tool genuinely absent by not including subagent middleware in the stack — `createDeepAgent` makes `SubAgentMiddleware` required (so `task` is always emitted) and its `registerHarnessProfile` switch does not reach a `ChatGroq` instance (`getModelProvider` has no `ChatGroq` mapping → the profile is always `EMPTY_HARNESS_PROFILE`), so the agent is built with `createAgent` + deepagents middleware and no subagent middleware; assert `task` is not in the agent's tool set — R4.4
- [x] 2.5 (Unit) Set `interruptOn` for `write_file`, `edit_file`, `rename_page`, `delete_page`, and emit a `chat:event` interrupt carrying the proposed change — R5.1
- [x] 2.6 (Unit) Stream `agent.streamEvents(input, { version: "v3" })` and forward token and tool-call events to the renderer; resume a paused run with `Command({ resume: { decisions } })` on the same `thread_id`, referencing the `interrupt_id` — R1.2, R5.3, R5.4, R5.5, R7.1, R7.2
- [x] 2.7 (Unit) Run all agent invocations in the desktop main process; assert the renderer cannot reach the model or the credential directly — R2.1
- [x] 2.8 (Unit) Disable tracing/telemetry for the agent's runs — set `LANGCHAIN_TRACING_V2=false` and unset `LANGSMITH_*` before the agent's dependencies are imported (at the start of main), and read no `LANGCHAIN_*` / `LANGSMITH_*` env var, so library-level auto-initialization does not fire and project content is sent only to Groq — R2.6

- [x] 2.9 (Unit) Import `tracing.js` as the first line of **every** module that pulls in `langchain` / `@langchain/*` — `agent.ts`, `chat-control.ts`, `page-guard.ts`, and the `index.ts` entry — since ES modules evaluate imports in written order and one file holding the guard does not save a sibling that imports langchain on its own account; assert the invariant over the source so a new importer fails the suite — R2.6
- [x] 2.10 (Unit) Rebuild the agent when the resolved credential or model changes, so a rotated key stops being used without a restart — R2.2, R2.5
- [x] 2.11 (Unit) Force every tracing switch `@langchain/core` reads — `LANGSMITH_TRACING_V2`, `LANGCHAIN_TRACING_V2`, `LANGSMITH_TRACING`, `LANGCHAIN_TRACING` — to `"false"`, since any one of them reading `"true"` turns tracing on; and clear the alternative transports `langsmith` reads (`LANGSMITH_TRACING_MODE`, `LANGSMITH_OTEL_ENABLED`, `OTEL_ENABLED`) plus the replica-endpoint list `LANGSMITH_RUNS_ENDPOINTS` — R2.6
- [x] 2.12 (Unit) Key the page guard's expectation map by thread id and path, not path alone: one agent is cached per window and every thread shares the closure, so two threads writing one page swap hashes and leave the guard off for both — R5.5, R7.1
- [x] 2.13 (Unit) Answer an unparseable agent-prefs file the way an absent one is answered, so a truncated write does not throw out of `readAgentPrefs` and into the renderer as an unhandled rejection — R2.5, R2.7
- [x] 2.14 (TDD) Clear a thread's uncollected page-guard expectations at the start of its next turn: only the tool's own execution consumes one, and `chat:cancel` and a run error both end a turn without reaching the tool, so the map otherwise grows for the window's whole life — R5.5, R7.1

## 3 · IPC channels

- [x] 3.1 (Unit) Add `chat:send({text, thread_id})`, `chat:resume({decisions, interrupt_id, run_id})`, `chat:cancel({run_id})` and the `chat:event({kind, thread_id, run_id, ...})` push channel (discriminated by `kind`: token/tool/interrupt/done/error) in `channels.ts`; expose in `preload.ts`, type in `bridge.ts` `OwBridge`, and route in `dispatch` — R1.2, R5.2, R5.3, R5.4, R5.5, R7.2
- [x] 3.2 (Unit) Bind the push channel through the buffered `send()` pattern so events before `did-finish-load` queue rather than drop — R1.2

## 4 · The chat pane

- [x] 4.1 (Unit) Widen `Pane` in `navigation.ts`, add the chat entry to `PANES` in `Rail.tsx`, and render `<Chat/>` in the `App.tsx` pane switch — R1.1
- [x] 4.2 (Unit) Build `Chat.tsx` with `bridge()` + `useEffect` + live-guard, sending over `chat:send` and rendering streamed tokens and tool calls from `chat:event` — R1.2, R1.4
- [x] 4.3 (Unit) Render the interrupt payload (slug, old/new content or the full resulting page for `replace_all`, or the rename/delete target) with approve, reject, and edit controls, dispatching `chat:resume` with the `interrupt_id`; show a fresh proposal when the backend reports the page changed since the interrupt — R5.1, R5.2, R5.3, R5.4, R5.5
- [x] 4.4 (Unit) Show the empty state naming the Groq key requirement and linking to settings while no credential is configured, and disable the composer; this replaces the "there is no model behind this window" copy — R1.3, R1.5
- [x] 4.5 (Unit) Surface a run error in place and preserve the conversation that produced it — R1.4
- [x] 4.6 (Unit) Compute an `edit_file`'s effect in the main process when the interrupt is pushed — every match site with its line, how many of the page's occurrences will be replaced, and the full resulting page — and render it on the interrupt card; the HITL interrupt fires on the model's raw args, so nothing earlier in the stack has counted the matches, and a short `old_string` with `replace_all` would otherwise render exactly like a single-site edit — R5.2
- [x] 4.7 (Unit) Give the preview the write path's reach and no more: refuse to preview a path outside `wiki/` (the backend would refuse the edit anyway, so reading and shipping the file buys nothing), cap the context shown per site, and drop the resulting page when it is too large to carry — keeping the sites, since abandoning the preview on a big page would reopen the hole it closes — R5.2, R4.3
- [x] 4.8 (Unit) Keep the chat pane mounted across pane switches, hidden rather than unmounted: the component holds the transcript and the one-per-window `threadId`, and remounting resets both — leaving a new thread id addressing a thread the main process never checkpointed — R7.1, R1.2
- [x] 4.9 (Unit) Read `file_path` in `proposalOf` (the name the deepagents tools actually use) and key the interrupt card by the interrupt, so a proposal replaced under R5.5 resets the inline editor instead of carrying the superseded proposal's text into the new action's args — R5.2, R5.4, R5.5

## 5 · Credential, model, settings

- [x] 5.1 (Unit) Read the Groq key from `readSecrets` for the agent; assert no second credential store is added — R2.2
- [x] 5.2 (Unit) Add the model selection to the settings screen, drawn from the Groq `/models` list captured at credential-save time and persisted in the application data directory, with `openai/gpt-oss-120b` as the default (falling back to the first model in the list if absent) — R2.5, R2.7
- [x] 5.3 (Unit) Add the two-purpose notice (transcription + agent) and the whisper.cpp no-agent notice to the settings screen — R2.4
- [x] 5.4 (Unit) Capture the Groq `/models` response body in `checkCredential`/`saveCredential` (the validation call doubles as the model-list fetch) and persist the list plus the user's chosen model in the application data directory keyed by project, in a file separate from the secrets file — the model list is not a secret; the agent reads the selected model from there — R2.5, R2.7

## 6 · The line is proved

- [x] 6.1 (TDD) Test that `write_file` to a path outside `wiki/` fails and writes nothing — R4.3, R6.1
- [x] 6.2 (TDD) Test that `edit_file` to a path outside `wiki/` fails and writes nothing — R4.3, R6.1
- [x] 6.3 (TDD) Test that `execute` is not in the agent's tool set and a call is rejected — R4.4, R6.1
- [x] 6.4 (TDD) Test that `task`/subagents are not registered (the general-purpose subagent is disabled for the Groq profile) — R4.4, R6.1
- [x] 6.5 (TDD) Test that a `write_file` whose content the gate rejects (bad frontmatter, dangling wikilink) is denied and writes nothing — R4.1, R6.1
- [x] 6.6 (TDD) Test that a read outside the project root — including a symlink or junction inside the project that points outside — returns an error and reads nothing — R3.2, R6.1
- [x] 6.7 (TDD) Test that an approved write lands through the store (validated, logged with origin `agent`, undoable) and a rejected write does not — R4.1, R4.5, R5.3
- [x] 6.8 (TDD) Test that a write tool call always emits an interrupt before any `writePage`/`supersedePage`/`deletePage` call — R5.1, R6.1
- [x] 6.9 (TDD) Test that a `replace_all` edit's interrupt shows every match site, and that an approved `replace_all` lands exactly as shown and alters nothing else — R5.2, R6.1
- [x] 6.10 (TDD) Test that `rename_page` refuses to clobber an existing target, and that `rename_page` and `delete_page` refuse the wiki index, changelog, and log — R4.6, R6.1
- [x] 6.11 (TDD) Test that a tool result large enough to trigger the middleware's eviction creates no file on disk (under `/large_tool_results/` or `/conversation_history/`) — the gate rejects the eviction path — R4.3, R6.1
- [x] 6.12 (TDD) Test that constructing the agent with `LANGCHAIN_*` / `LANGSMITH_*` env vars set constructs no tracing client and sends nothing to a third party — R2.6, R6.1
- [x] 6.13 (TDD) Test that `readRaw` of a path outside the project returns an error and reads nothing — R3.2, R6.1
- [x] 6.14 (TDD) Test that resuming a paused write against a page changed since the interrupt does not apply the stale edit and re-interrupts with a fresh proposal — R5.5, R6.1

- [x] 6.15 (TDD) Test that a `rename_page` whose later steps fail leaves both pages exactly as they were and reports the rollback — R4.7, R6.1
- [x] 6.16 (TDD) Test that the backend refuses a write to `/large_tool_results/` and `/conversation_history/` directly — 6.11's run cannot trigger an eviction (the limit is `null`), so it proves only half of its own claim — R4.3, R6.1
- [x] 6.17 (TDD) Test each tracing activation variable on its own — one loop setting all four at once would pass with three of them still unhandled — R2.6, R6.1
- [x] 6.18 (TDD) Test that two threads on one agent cannot consume each other's page-guard expectation: thread A proposes, the page changes outside, thread B proposes, and approving A is still refused while approving B still lands — R5.5, R6.1
- [x] 6.19 (TDD) Test the preview against the backend over a page the gate actually accepts, comparing `occurrences` and the written body unconditionally — seeded against a page the gate refused, the cross-check never ran and the suite compared the preview to a re-implementation of itself — R5.2, R6.1
- [x] 6.20 (TDD) Test that `readRaw` and `edit` answer a directory with an error, that a file over the read limit is refused, and that one unreadable file does not discard a `grep`'s collected matches — R3.3, R6.1

## 7 · Docs

- [x] 7.1 (Unit) Add `deepagents`, `@langchain/groq`, `@langchain/langgraph`, `langchain`, and `@langchain/core` to `docs/stack.md` with one line each on why — R2.2
- [x] 7.2 (Unit) Add canonical terms (embedded agent, chat pane, wiki-gate backend) to `docs/glossary.md` with the synonyms to avoid — R1.1, R2.1

## 9 · The UX pass (`plans/desktop-ui-uxpass.md`)

- [x] 9.1 (Unit) Give the pane a bar: its title, the model in use, and a new conversation — R1.6
- [x] 9.2 (Unit) Show a run in flight in the transcript rather than in a placeholder that disappears when anybody types — R1.7
- [x] 9.3 (Unit) Mark what actually differs between `old_string` and `new_string`, word by word — R5.2
- [x] 9.4 (Unit) Move the focus to the decision when a write pauses, and bind approve and reject — R5.6
- [x] 9.5 (Unit) Refuse a message while a run is paused, and say why in place of the composer's prompt — R5.7
