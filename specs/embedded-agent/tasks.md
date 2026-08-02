# Embedded agent — tasks

## 1 · The wiki-gate backend

- [ ] 1.1 (Unit) Implement `WikiGateBackend.ls` over the project directory, confining every path with `assertWithin(projectRoot)` from `@open-wiki/access` — R3.1, R3.2
- [ ] 1.2 (Unit) Implement `WikiGateBackend.read` (offset/limit, line-numbered) over the project directory, confined with `assertWithin` — R3.1, R3.2
- [ ] 1.3 (Unit) Implement `WikiGateBackend.glob` and `grep` (literal, passage-level) over the project directory, confined with `assertWithin` — R3.1, R3.2
- [ ] 1.4 (TDD) Implement `WikiGateBackend.write` to accept only paths inside `wiki/` and route them through `gateWrite` + `writePage(projectRoot, pagePath, content, { kind: "agent" })` + `appendOperation`; watch red on a non-wiki path, then green when it returns an error and writes nothing — R4.1, R4.3, R4.5, R6.1
- [ ] 1.5 (TDD) Implement `WikiGateBackend.edit` as exact `old_string`→`new_string` replace (`replace_all` supported) over a wiki page, routing through the store; assert it never rewrites the whole page and that a non-wiki path fails — R4.1, R4.3, R6.1
- [ ] 1.6 (Unit) Omit `execute` from the backend so the DeepAgents middleware hides the `execute` tool — R4.4

## 2 · The agent runtime

- [ ] 2.1 (Unit) Build the agent in `apps/desktop/src/main/agent/agent.ts` with `createDeepAgent`: `ChatGroq` from the Groq credential, the curated default model, `backend = WikiGateBackend`, `MemorySaver` keyed by `thread_id`, and `tools: ["read_file","ls","glob","grep","write_file","edit_file"]` — R2.1, R2.2, R2.5, R4.4, R7.1
- [ ] 2.2 (Unit) Resolve the project's harness entry file (the file the project was scaffolded for its harness to read; today `CLAUDE.md`, plural once `plans/harness-portability.md` lands) as `systemPrompt`, and the scaffolded skills as `skills`, both read from disk in main and carried in unchanged; assert no hand-written prompt is appended beside them — R2.3
- [ ] 2.3 (Unit) Implement `rename_page` and `delete_page` tools backed by `supersedePage` and the store, with origin `agent` — R4.2, R4.5
- [ ] 2.4 (Unit) Set `interruptOn` for `write_file`, `edit_file`, `rename_page`, `delete_page`, and emit a `chat:event` interrupt carrying the proposed change — R5.1
- [ ] 2.5 (Unit) Stream `agent.streamEvents({ version: "v3" })` and forward token and tool-call events to the renderer; resume a paused run with `Command({ resume: { decisions } })` on the same `thread_id` — R1.2, R5.3, R5.4, R7.1
- [ ] 2.6 (Unit) Run all agent invocations in the desktop main process; assert the renderer cannot reach the model or the credential directly — R2.1

## 3 · IPC channels

- [ ] 3.1 (Unit) Add `chat:send`, `chat:resume`, `chat:cancel` request channels and the `chat:event` push channel in `channels.ts`; expose in `preload.ts`, type in `bridge.ts` `OwBridge`, and route in `dispatch` — R1.2, R5.2, R5.3, R5.4
- [ ] 3.2 (Unit) Bind the push channel through the buffered `send()` pattern so events before `did-finish-load` queue rather than drop — R1.2

## 4 · The chat pane

- [ ] 4.1 (Unit) Widen `Pane` in `navigation.ts`, add the chat entry to `PANES` in `Rail.tsx`, and render `<Chat/>` in the `App.tsx` pane switch — R1.1
- [ ] 4.2 (Unit) Build `Chat.tsx` with `bridge()` + `useEffect` + live-guard, sending over `chat:send` and rendering streamed tokens and tool calls from `chat:event` — R1.2, R1.4
- [ ] 4.3 (Unit) Render the interrupt payload (slug, old/new content, or rename/delete target) with approve, reject, and edit controls, dispatching `chat:resume` — R5.1, R5.2, R5.3, R5.4
- [ ] 4.4 (Unit) Show the empty state naming the Groq key requirement and linking to settings while no credential is configured, and disable the composer; this replaces the "there is no model behind this window" copy — R1.3, R1.5
- [ ] 4.5 (Unit) Surface a run error in place and preserve the conversation that produced it — R1.4

## 5 · Credential, model, settings

- [ ] 5.1 (Unit) Read the Groq key from `readSecrets` for the agent; assert no second credential store is added — R2.2
- [ ] 5.2 (Unit) Add the curated model selection to the settings screen, with one tool-calling-reliable default — R2.5
- [ ] 5.3 (Unit) Add the two-purpose notice (transcription + agent) and the whisper.cpp no-agent notice to the settings screen — R2.4

## 6 · The line is proved

- [ ] 6.1 (TDD) Test that `write_file` to a path outside `wiki/` fails and writes nothing — R4.3, R6.1
- [ ] 6.2 (TDD) Test that `edit_file` to a path outside `wiki/` fails and writes nothing — R4.3, R6.1
- [ ] 6.3 (TDD) Test that `execute` is not in the agent's tool set and a call is rejected — R4.4, R6.1
- [ ] 6.4 (TDD) Test that `task`/subagents are not registered — R4.4, R6.1
- [ ] 6.5 (TDD) Test that a `write_file` whose content the gate rejects (bad frontmatter, dangling wikilink) is denied and writes nothing — R4.1, R6.1
- [ ] 6.6 (TDD) Test that a read outside the project root returns an error and reads nothing — R3.2, R6.1
- [ ] 6.7 (TDD) Test that an approved write lands through the store (validated, logged with origin `agent`, undoable) and a rejected write does not — R4.1, R4.5, R5.3

## 7 · Docs

- [ ] 7.1 (Unit) Add `deepagents`, `@langchain/groq`, `@langchain/langgraph`, `langchain`, and `@langchain/core` to `docs/stack.md` with one line each on why — R2.2
- [ ] 7.2 (Unit) Add canonical terms (embedded agent, chat pane, wiki-gate backend) to `docs/glossary.md` with the synonyms to avoid — R1.1, R2.1