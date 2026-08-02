/**
 * The first run's four steps (desktop-ui 6.3), as data.
 *
 * **Step 1 picks a project, not a workspace.** The draft's first step chose a
 * folder that would hold every project, which was an architecture the pivot
 * dropped: a project *is* the directory `ow` opened
 * (`adr:0013-the-project-directory-is-the-unit`), and the registry is a cache
 * and never truth (2.2). The plan's table says the plan wins here, and this is
 * where that lands.
 *
 * The steps are a list rather than four components with `next` wired between
 * them, so what order they come in and when one may be left are answerable
 * without rendering anything.
 */

export type StepId = "project" | "language" | "transcription" | "done";

export interface Step {
  id: StepId;
  title: string;
  /** What this step is for, in one sentence. */
  detail: string;
}

export const STEPS: readonly Step[] = [
  {
    id: "project",
    title: "Create your first project",
    detail:
      "A project is a directory. Its own sources, its own pages, its own history — and the " +
      "wiki lives inside it, which is why your agent can already read it.",
  },
  {
    id: "language",
    title: "What language should the pages be written in?",
    detail:
      "The transcription hint, and what the generated CLAUDE.md tells your agent to write in. " +
      "The page schema stays English either way, and this is changeable later.",
  },
  {
    id: "transcription",
    title: "How should meetings be transcribed?",
    detail:
      "The only credential this application holds. Skip it if you are not recording anything " +
      "yet — the settings sheet asks again, and nothing else needs it.",
  },
  {
    id: "done",
    title: "That is everything",
    detail:
      "The pages are your agent's to write: open the project in your harness and ask it for one. " +
      "This window scaffolds, validates, records and shows you the result.",
  },
];

/** Which step comes after this one, or null at the end. */
export function nextStep(id: StepId): StepId | null {
  const at = STEPS.findIndex((step) => step.id === id);
  return STEPS[at + 1]?.id ?? null;
}

/** How far along, for the progress line. 1-based, because a person reads it. */
export function stepNumber(id: StepId): number {
  return STEPS.findIndex((step) => step.id === id) + 1;
}

/**
 * Whether a step may be left.
 *
 * **Only the first one refuses.** A project needs a name and a directory or
 * there is nothing to create; a language always has one chosen (`adr:0008`
 * makes English the default rather than an empty state); and the transcription
 * step is skippable on purpose — somebody who is not recording today should not
 * be made to produce an API key to reach a wiki.
 */
export function canLeave(id: StepId, project: { name: string; directory: string }): boolean {
  if (id !== "project") return true;
  return project.name.trim() !== "" && project.directory.trim() !== "";
}
