import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultAppDataDir, secretsFile } from "@open-wiki/access/secrets";

/**
 * The agent's per-project preferences — the model list captured at
 * credential-save time and the model the user picked from it
 * (specs/embedded-agent, R2.5, R2.7).
 *
 * **A sibling to the secrets file, not part of it.** The model list is fetched
 * from Groq's public `/models` endpoint and is not a secret, so it lives in a
 * separate file beside the secrets file (same project-keyed directory) rather
 * than inside it. Keeping it out of the secrets file is what lets `credentialState`
 * stay "whether a key is stored, never what it is" without the model list
 * dragging the key's file-mode along with it.
 *
 * Pure on purpose: no Electron, no langchain. The settings module and the agent
 * both read from here, and a test reaches it without standing either up.
 */

/**
 * The default model the agent runs when the saved list contains it. Falls back
 * to the first model in the list when it does not (R2.5).
 *
 * Canonical here rather than in `agent.ts` so the settings module — which must
 * not import langchain — can read the default without pulling the agent's graph
 * into the credential path. `agent.ts` re-exports it to keep its public surface.
 */
export const DEFAULT_MODEL = "openai/gpt-oss-120b";

/**
 * The only models the chat agent may run. The settings dropdown offers these
 * alone — intersected with what Groq actually serves, so a model here that
 * Groq no longer lists simply does not appear, and a model Groq offers that is
 * not here is refused before it reaches the agent.
 *
 * The list is the dropdown's order too, not Groq's catalogue order: a deliberate
 * sequence rather than whatever `/models` happened to return first.
 */
export const ALLOWED_MODELS = [
  "allam-2-7b",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.6-27b",
] as const;

/**
 * The models the agent may run, in the order the dropdown shows them: the
 * allowlist intersected with what was offered, keeping the allowlist's order.
 * Pure, so the settings module and the agent both reach it without langchain.
 */
export function filterAllowed(models: string[]): string[] {
  const offered = new Set(models);
  return ALLOWED_MODELS.filter((m) => offered.has(m));
}

export interface AgentPrefs {
  /** The Groq `/models` list captured when the credential was saved. */
  models: string[];
  /** The model the user picked; defaults to {@link DEFAULT_MODEL} when present. */
  selectedModel: string;
}

/**
 * The prefs file: the secrets file's path with `.agent.json` in place of the
 * extension. Same project-keyed directory, distinct file — a sibling, not a
 * tenant of the secrets file.
 */
export function agentPrefsFile(
  projectRoot: string,
  appDataDir: string = defaultAppDataDir(),
): string {
  return secretsFile(projectRoot, appDataDir).replace(/\.json$/, ".agent.json");
}

export function readAgentPrefs(
  projectRoot: string,
  appDataDir: string = defaultAppDataDir(),
): AgentPrefs | undefined {
  const file = agentPrefsFile(projectRoot, appDataDir);
  if (!existsSync(file)) return undefined;
  // A truncated write or a hand edit leaves a file that is not JSON at all, and
  // `normalize` never sees it — `JSON.parse` throws first. The throw would climb
  // through `agentModels` in the settings module and out into the renderer as an
  // unhandled rejection, so it is answered here the same way an absent file is:
  // no prefs, and the caller falls back to the default model.
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
  // Valid JSON that is not an object (`null`, a number, a list) reaches
  // `normalize` as something with no fields to read; coerce it to the empty
  // shape rather than dereferencing it.
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return normalize({});
  return normalize(raw as Partial<AgentPrefs>);
}

/**
 * Persist the prefs. Not a secret, so no `0600` — the model list is public, and
 * a restrictive mode would imply a sensitivity the file does not have.
 */
export function writeAgentPrefs(
  projectRoot: string,
  prefs: AgentPrefs,
  appDataDir: string = defaultAppDataDir(),
): void {
  const file = agentPrefsFile(projectRoot, appDataDir);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(prefs, null, 2) + "\n", "utf8");
}

/**
 * The model the agent should run (R2.5). The selected model wins when it is in
 * the list; otherwise the default, when it is in the list; otherwise the first
 * model in the list; otherwise the default alone. A prefs file written before a
 * model was removed from Groq's catalogue must not silently pick a model the
 * user never chose.
 */
export function resolveModel(prefs: AgentPrefs | undefined, fallback = DEFAULT_MODEL): string {
  const models = prefs?.models ?? [];
  if (models.includes(prefs?.selectedModel ?? "")) return prefs!.selectedModel;
  if (models.includes(fallback)) return fallback;
  if (models.length > 0) return models[0]!;
  return fallback;
}

/**
 * A prefs shape read off disk may be partial or malformed; coerce to valid.
 *
 * Filters the list to {@link ALLOWED_MODELS} on every read, so a prefs file
 * written before the allowlist existed — or one a model Groq has since dropped
 * left a stale entry in — never offers the agent a model it may not run. The
 * selection is re-resolved against the filtered list when it is no longer in
 * it, so a stored selection that fell off the allowlist does not survive as a
 * model the agent would refuse.
 */
function normalize(raw: Partial<AgentPrefs>): AgentPrefs {
  const parsed = Array.isArray(raw.models)
    ? raw.models.filter((m): m is string => typeof m === "string")
    : [];
  const models = filterAllowed(parsed);
  const selectedModel =
    typeof raw.selectedModel === "string" &&
    raw.selectedModel.length > 0 &&
    models.includes(raw.selectedModel)
      ? raw.selectedModel
      : resolveModel({ models, selectedModel: "" });
  return { models, selectedModel };
}

/**
 * Read the `/models` response body into a list of model ids. Groq's endpoint is
 * OpenAI-shaped — `{ data: [{ id, ... }] }` — so the ids are read defensively:
 * anything that is not the expected shape yields an empty list rather than a
 * crash, and a credential that checked out with no parseable list still saves.
 */
export function parseModelList(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data
    .filter((m): m is { id?: unknown } => typeof m === "object" && m !== null)
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}
