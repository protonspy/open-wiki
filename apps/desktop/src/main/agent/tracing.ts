/**
 * Disable LangChain/LangGraph tracing and LangSmith telemetry — R2.6.
 *
 * LangChain and LangGraph auto-initialize a LangSmith tracing client from
 * `LANGCHAIN_*` / `LANGSMITH_*` environment variables at import time, before
 * the agent path runs. A developer who sets them globally would otherwise
 * export the project directory (prompts, tool calls, tool results — file
 * content) to a third party. Disabling tracing **before** the libraries are
 * imported is what closes that, not merely refusing to read the vars in our
 * own code.
 *
 * This module has no `langchain` / `@langchain/*` imports of its own, so
 * importing it can never itself be the thing that loads a tracing client.
 *
 * **The invariant, and why one file is not enough to hold it.** ES modules
 * evaluate each import to completion in written order, so "the agent disables
 * tracing first" only holds if *every* module on the path to a `langchain`
 * import reaches this one first. `agent.ts` having it on line 1 does not save
 * `chat-control.ts`, which imports `@langchain/langgraph` on its own account —
 * that import would be fully evaluated before `./agent.js` were even reached.
 * So the rule is: **any module that imports `langchain` or `@langchain/*`, at
 * any depth, imports this module on its first line.** Today that is `agent.ts`,
 * `chat-control.ts`, `page-guard.ts`, and `index.ts` (the process entry, which
 * imports the chat control). `tests/agent.spec.ts` asserts it over the source —
 * both for those files by name and by sweeping `src/main` for any other
 * langchain importer — so a new one that forgets fails the suite rather than
 * silently leaking.
 *
 * It also exports {@link disableTracing} for tests that construct the agent with
 * the env vars deliberately set.
 */

/**
 * The switches that turn tracing **on**. `@langchain/core`'s `isTracingEnabled`
 * checks all four and enables tracing when *any* reads `"true"`, so setting one
 * of them to `"false"` leaves the other three able to switch it back on. Each is
 * forced to `"false"` rather than deleted, because an explicit `"false"` also
 * survives anything that re-reads the environment later.
 */
const TRACING_SWITCHES = [
  "LANGSMITH_TRACING_V2",
  "LANGCHAIN_TRACING_V2",
  "LANGSMITH_TRACING",
  "LANGCHAIN_TRACING",
] as const;

/**
 * The variables that select a tracing *transport* or carry the credential to
 * reach it. `langsmith` reads `LANGSMITH_TRACING_MODE` first and falls back to
 * the legacy `LANGSMITH_OTEL_ENABLED` / `OTEL_ENABLED` pair, either of which
 * would route spans to an OpenTelemetry collector rather than to LangSmith —
 * a different destination, the same export. `LANGSMITH_RUNS_ENDPOINTS` (plural)
 * is the replica-endpoint list, and it carries its own api keys, so clearing
 * `LANGSMITH_ENDPOINT` alone would not clear the replicas.
 */
const TRACING_VARS = [
  "LANGCHAIN_API_KEY",
  "LANGCHAIN_ENDPOINT",
  "LANGCHAIN_PROJECT",
  "LANGCHAIN_CALLBACKS_BACKGROUND",
  "LANGSMITH_API_KEY",
  "LANGSMITH_PROJECT",
  "LANGSMITH_ENDPOINT",
  "LANGSMITH_RUNS_ENDPOINTS",
  "LANGSMITH_TRACING_MODE",
  "LANGSMITH_OTEL_ENABLED",
  "OTEL_ENABLED",
] as const;

/**
 * Force every tracing switch to `"false"` and clear every transport and
 * credential var, so no tracing client initializes and none has anywhere to
 * send to. Idempotent.
 */
export function disableTracing(): void {
  for (const name of TRACING_SWITCHES) process.env[name] = "false";
  for (const name of TRACING_VARS) delete process.env[name];
}

// Run once on import — before the first langchain import in any importer.
disableTracing();
