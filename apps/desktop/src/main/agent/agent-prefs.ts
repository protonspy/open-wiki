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
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<AgentPrefs>;
  return normalize(raw);
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

/** A prefs shape read off disk may be partial or malformed; coerce to valid. */
function normalize(raw: Partial<AgentPrefs>): AgentPrefs {
  const models = Array.isArray(raw.models)
    ? raw.models.filter((m): m is string => typeof m === "string")
    : [];
  const selectedModel =
    typeof raw.selectedModel === "string" && raw.selectedModel.length > 0
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
