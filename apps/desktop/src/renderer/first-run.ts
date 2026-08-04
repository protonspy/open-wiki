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

export type StepId = "project" | "harness" | "language" | "transcription" | "done";

export interface Step {
  id: StepId;
  title: string;
  /**
   * One or two words for the stepper (uxpass 8.6).
   *
   * The heading is a sentence, and a row of five sentences is not a stepper. It
   * lives on the step rather than in a lookup beside the component, so a step
   * added later cannot arrive without one.
   */
  short: string;
  /** What this step is for, in one sentence. */
  detail: string;
}

export const STEPS: readonly Step[] = [
  {
    id: "project",
    short: "Project",
    title: "Create your first project",
    detail:
      "A project is a directory. Its own sources, its own pages, its own history — and the " +
      "wiki lives inside it, which is why your agent can already read it.",
  },
  {
    id: "harness",
    short: "Harnesses",
    title: "Which harnesses will read this project?",
    detail:
      "The convention is written into the project and committed, so it reaches everyone who " +
      "clones it. Choose every harness your team uses — one person on Claude Code and one on " +
      "Codex is the normal case, and you can add another later.",
  },
  {
    id: "language",
    short: "Language",
    title: "What language should the pages be written in?",
    detail:
      "The transcription hint, and what the generated CLAUDE.md tells your agent to write in. " +
      "The page schema stays English either way, and this is changeable later.",
  },
  {
    id: "transcription",
    short: "Transcription",
    title: "How should meetings be transcribed?",
    detail:
      "The only credential this application holds. Skip it if you are not recording anything " +
      "yet — the settings sheet asks again, and nothing else needs it.",
  },
  {
    id: "done",
    short: "Done",
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

/**
 * Which classes a step in the stepper wears (uxpass 8.6).
 *
 * Three states — done, here, still to come — because that is what a stepper is
 * for: not *where am I* alone, which the heading already says, but *how much of
 * this is left*. Computed here rather than in the JSX for the reason everything
 * else in this renderer is: a decision inside a component is one no test reaches.
 */
export function stepClass(index: number, current: number): string {
  if (index < current) return "stepper__step stepper__step--done";
  if (index === current) return "stepper__step stepper__step--here";
  return "stepper__step";
}

/** How far along, for the progress line. 1-based, because a person reads it. */
export function stepNumber(id: StepId): number {
  return STEPS.findIndex((step) => step.id === id) + 1;
}

/**
 * Whether a step may be left.
 *
 * **Two of them refuse.** A project needs a name and a directory or there is
 * nothing to create; and a project needs at least one harness or the convention
 * has nowhere to live — the same refusal `ow init` makes headless, for the same
 * reason. A language always has one chosen (`adr:0008` makes English the
 * default rather than an empty state), and the transcription step is skippable
 * on purpose: somebody who is not recording today should not be made to produce
 * an API key to reach a wiki.
 *
 * **Nothing is preselected on the harness step**, so leaving it is a choice
 * rather than a default nobody looked at. That is the plan's third divergence:
 * the convention is committed, so a wrong answer is discovered by a colleague
 * next week rather than by the person giving it.
 */
export function canLeave(
  id: StepId,
  project: { name: string; directory: string; harnesses?: readonly string[] },
): boolean {
  if (id === "project") return project.name.trim() !== "" && project.directory.trim() !== "";
  if (id === "harness") return (project.harnesses ?? []).length > 0;
  return true;
}
