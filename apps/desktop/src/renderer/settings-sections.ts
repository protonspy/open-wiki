import type { AgentPrefs } from "../main/agent/agent-prefs.js";
import type { CredentialState } from "../main/settings.js";

/**
 * How the settings page is divided (plan `settings-pane-and-export`, 1.3).
 *
 * The settings were a sheet: one column, every section stacked, scrolled past
 * to reach the one you came for. As a pane they have the whole window, and
 * stacking four independent groups down the left of it wastes exactly the space
 * that made a pane worth having — so they are tabs, and the four groups are the
 * four questions somebody arrives with.
 *
 * **The decisions live here rather than in the component**, which is the rule
 * the rest of this renderer follows: what the sections are, and what the agent
 * section has to say when there is nothing to choose from. A component that
 * decided either would be a decision no test reaches.
 */

export type SettingsSectionId = "project" | "transcription" | "agent" | "files";

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
}

/**
 * In the order somebody meets them: what this project is, how its audio becomes
 * text, what the agent runs on, and where all of it is written down.
 *
 * `files` is last because it is the only one that is not a control — it is what
 * you read when something is wrong, and support for an application with no
 * backend is somebody opening their own configuration.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "project", label: "Project" },
  { id: "transcription", label: "Transcription" },
  { id: "agent", label: "Agent" },
  { id: "files", label: "Files" },
];

/**
 * What the agent section can show, and why it might show nothing.
 *
 * **The section could vanish before and cannot now.** Inside the sheet it was
 * `credential?.provider === "groq" && agent && agent.models.length > 0 ? … :
 * null` — an absent block in a scroll, which reads as "there is nothing to
 * configure here". A tab cannot do that: a tab that appears once a key is saved
 * is a tab nobody knows to wait for, and one that disappears is a control
 * somebody remembers using and cannot find. So it is always there and says
 * which of the three reasons it is empty for.
 */
export type AgentSection =
  | { state: "no-credential" }
  | { state: "not-groq" }
  | { state: "no-models" }
  | { state: "ready"; models: readonly string[]; selected: string };

export function agentSection(
  credential: CredentialState | null,
  agent: AgentPrefs | null,
): AgentSection {
  // Nothing saved at all — including the case where the answer has not come
  // back yet, which is indistinguishable from here and leads to the same
  // sentence: save a Groq credential and this fills in.
  if (!credential?.provider) return { state: "no-credential" };
  // whisper.cpp runs on this machine and the embedded agent does not: R2.4 has
  // one key doing two jobs, so opting out of the third party opts out of both.
  if (credential.provider !== "groq") return { state: "not-groq" };
  // A key is stored and the list is empty. The list is what Groq offered when
  // the key was checked, so this is *"check it again"* rather than *"add one"*.
  if (!agent || agent.models.length === 0) return { state: "no-models" };
  return { state: "ready", models: agent.models, selected: agent.selectedModel };
}
