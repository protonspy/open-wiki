/**
 * The questions this window asks, and what an answer to one means (plan 1.1).
 *
 * **Electron implements none of what stood here.** `window.prompt` does not
 * exist at all — the call answers `undefined`, the button does nothing, and
 * nothing appears on screen to say so; `alert` and `confirm` do exist and are
 * native modals that block the main process while they are open. 8.12 found
 * this once and rebuilt the language picker as a form (`Launcher.tsx`); the
 * other four call sites were left, which is why there was no way to create a
 * page in the shipped application.
 *
 * The components in `Dialogs.tsx` arrange these and decide nothing. What is
 * here is the part a test can reach: what each question says, which button
 * says what, and what closing the box means.
 */

/**
 * The `returnValue` a submitting button leaves on the `<dialog>`.
 *
 * Escape leaves it empty — that is the platform's own signal for "closed
 * without answering", and it is why `answerOf` can treat every exit the same
 * way instead of tracking which of three paths was taken.
 */
export const ANSWERED = "answered";

export interface Question {
  /** A prompt takes an answer; a confirm takes a yes. */
  kind: "prompt" | "confirm";
  title: string;
  /** The sentence under the title: what is about to happen, in full. */
  detail: string;
  /** Prompt only — the label on the box. */
  label?: string;
  initial?: string;
  placeholder?: string;
  /**
   * The affirmative button. It says what it does rather than "OK", so the
   * button and the sentence above it agree.
   */
  confirmLabel: string;
  /** The other button. It says what *it* does too — see `occasionQuestion`. */
  cancelLabel: string;
  /**
   * Whether an empty box may be submitted. A page with no slug is not a page;
   * a recording with no occasion is a recording named by its timestamp (4.16).
   */
  emptyMeans: "refuse" | "accept";
  /** Draws the affirmative button as destructive. */
  danger?: boolean;
}

/** Creating a page — the control that did nothing at all. */
export function newPageQuestion(): Question {
  return {
    kind: "prompt",
    title: "New page",
    detail:
      "The slug is the file name — wiki/<slug>.md — and it is what links point at. " +
      "The page is created with the frontmatter the schema asks for and an empty body.",
    label: "Slug",
    placeholder: "the-thing",
    confirmLabel: "Create the page",
    cancelLabel: "Cancel",
    emptyMeans: "refuse",
  };
}

/** Renaming a page. The links follow, which is the part worth saying. */
export function renameQuestion(slug: string): Question {
  return {
    kind: "prompt",
    title: `Rename ${slug}`,
    detail:
      "The file moves to the new name and every link pointing at this page is repointed. " +
      "Both are recorded as one operation, so both undo together.",
    label: "New slug",
    initial: slug,
    confirmLabel: "Rename the page",
    cancelLabel: "Cancel",
    emptyMeans: "refuse",
  };
}

/**
 * Deleting a page. The links that pointed here are left alone on purpose —
 * they are the record that something was expected to be there, and 7.1 reports
 * them — so the dialog says that rather than letting it be a surprise.
 */
export function deleteQuestion(slug: string): Question {
  return {
    kind: "confirm",
    title: `Delete ${slug}?`,
    detail:
      "Links pointing at it stay where they are, and the checks will report them as broken. " +
      "The delete is recorded, so it can be undone from the history.",
    confirmLabel: "Delete the page",
    cancelLabel: "Keep it",
    emptyMeans: "accept",
    danger: true,
  };
}

/**
 * Retitling a source (6.7) — the correction that makes a frozen id bearable
 * (`adr:0011`). It never moves the directory and never touches a citation, and
 * saying so is what stops it reading like a rename that might break something.
 */
export function retitleQuestion(title: string): Question {
  return {
    kind: "prompt",
    title: "Title for this source",
    detail:
      "The title is what you read. The id stays frozen, the directory does not move, " +
      "and every citation keeps pointing exactly where it pointed.",
    label: "Title",
    initial: title,
    confirmLabel: "Rename the source",
    cancelLabel: "Cancel",
    emptyMeans: "refuse",
  };
}

/**
 * Naming a recording before it starts (4.16).
 *
 * **Both buttons record.** An empty occasion falls back to the timestamp
 * rather than refusing to capture — `recordingId` is explicit that a recording
 * that started is worth more than a naming rule — so the other button says
 * that instead of saying "Cancel" and doing it anyway.
 */
export function occasionQuestion(): Question {
  return {
    kind: "prompt",
    title: "What are you recording?",
    detail:
      "The occasion names the recording's directory, which is how you find it later. " +
      "Without one it is named by the moment it started.",
    label: "Occasion",
    placeholder: "weekly sync",
    confirmLabel: "Start recording",
    cancelLabel: "Record without a name",
    emptyMeans: "accept",
  };
}

/**
 * What closing the box meant.
 *
 * `null` is "the question was not answered" — Escape, the cancel button, or
 * the window taking the dialog away. Anything else is the typed answer,
 * trimmed, because a page named " " is not a page anyone asked for.
 */
export function answerOf(returnValue: string, typed: string): string | null {
  return returnValue === ANSWERED ? typed.trim() : null;
}

/**
 * The occasion to start a recording with (4.16).
 *
 * Not answering is not a refusal here — it is an unnamed recording, and
 * `recordingId` turns an empty occasion into the timestamp. This is the one
 * call site where a cancelled dialog still does the thing.
 */
export function occasionOf(answer: string | null): string {
  return answer ?? "";
}

/** Whether the affirmative button may be pressed with what is in the box. */
export function canAnswer(question: Question, typed: string): boolean {
  if (question.kind === "confirm") return true;
  return question.emptyMeans === "accept" || typed.trim() !== "";
}

export interface DialogButton {
  /** What it leaves on `returnValue`, which is how `answerOf` reads the exit. */
  value: string;
  label: string;
  /**
   * Whether it submits the form.
   *
   * **Exactly one button submits, and it is the one that answers.** Pressing
   * Enter in a text field submits through the form's *default button* — the
   * first submit button in tree order, not the one anybody has focused — so a
   * cancel button that also submits swallows the answer of everyone who fills
   * in a one-field form the ordinary way. It closed the box with the cancel
   * button's empty `returnValue` and the typed slug went nowhere, which is the
   * dead control of 1.1 in a new costume.
   */
  submits: boolean;
  danger: boolean;
}

/**
 * The buttons, in the order they are rendered.
 *
 * Here rather than in the JSX because the order and the types are a decision —
 * see `submits` — and a decision in a component is a decision no test reaches.
 */
export function buttonsFor(question: Question): DialogButton[] {
  return [
    { value: "", label: question.cancelLabel, submits: false, danger: false },
    {
      value: ANSWERED,
      label: question.confirmLabel,
      submits: true,
      danger: question.danger === true,
    },
  ];
}
