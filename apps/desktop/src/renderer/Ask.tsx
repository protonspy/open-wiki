import { useCallback, useEffect, useRef, useState } from "react";
import { answerOf, buttonsFor, canAnswer, type Question } from "./dialogs.js";
import { Button } from "./ui/Button.js";
import { Dialog } from "./ui/Dialog.js";

/**
 * Asking a question, in the renderer, because the platform will not (plan 1.1).
 *
 * The modal itself is `ui/Dialog` (2.3) — the same one the sheet and the
 * drawer are, so the focus trap, Escape and the return of focus are settled in
 * one place rather than three. What is left here is the question: a form that
 * is `method="dialog"`, so the submitting button's `value` lands on
 * `returnValue` and every way out arrives at one handler. Which button submits
 * is not decoration; `buttonsFor` says why.
 */

export interface Dialogs {
  /** A question with a box. Resolves with the trimmed answer, or null. */
  ask(question: Question): Promise<string | null>;
  /** A question with a yes. Resolves false when it was not answered. */
  confirm(question: Question): Promise<boolean>;
  /** Render this where the component tree can reach it — it is a modal, so where does not matter. */
  element: React.JSX.Element | null;
}

interface Pending {
  id: number;
  question: Question;
  settle: (answer: string | null) => void;
}

/**
 * One dialog at a time, held by whichever component asks.
 *
 * There is no provider and no context: a modal is in the top layer wherever it
 * sits in the DOM, so a component that asks questions can own its own without
 * arranging anything with the shell around it.
 */
export function useDialogs(): Dialogs {
  const [pending, setPending] = useState<Pending | null>(null);
  const next = useRef(0);

  // The same rule as replacing an open question, for the other way a question
  // stops being answerable: the component that asked it went away — navigating
  // out of Sources with a retitle box open, say. Nothing is left awaiting a
  // promise that can no longer be settled by anything on screen.
  const open = useRef<Pending | null>(null);
  open.current = pending;
  useEffect(() => () => open.current?.settle(null), []);

  const ask = useCallback(
    (question: Question) =>
      new Promise<string | null>((resolve) => {
        next.current += 1;
        const id = next.current;
        setPending((current) => {
          // A question arriving while one is open cannot be answered — the open
          // one has the focus and the pointer. The one being replaced is
          // settled as unanswered rather than left to hang forever, because an
          // awaited promise that never resolves is a button that never returns.
          current?.settle(null);
          return { id, question, settle: resolve };
        });
      }),
    [],
  );

  const confirm = useCallback(
    (question: Question) => ask(question).then((answer) => answer !== null),
    [ask],
  );

  const element = pending ? (
    <Ask
      // Keyed by the question, so the box starts from the new question's
      // `initial` rather than keeping what was typed into the last one.
      key={pending.id}
      question={pending.question}
      onAnswer={(answer) => {
        setPending(null);
        pending.settle(answer);
      }}
    />
  ) : null;

  return { ask, confirm, element };
}

function Ask({
  question,
  onAnswer,
}: {
  question: Question;
  onAnswer: (answer: string | null) => void;
}): React.JSX.Element {
  const [typed, setTyped] = useState(question.initial ?? "");

  return (
    <Dialog
      className="ask"
      labelledBy="ask-title"
      describedBy="ask-detail"
      // The one exit. Escape leaves `returnValue` empty, the answering button
      // leaves its own, and `answerOf` reads the difference.
      onClose={(returnValue) => onAnswer(answerOf(returnValue, typed))}
    >
      {(close) => (
        <form method="dialog" className="ask__form">
          <h2 id="ask-title" className="ask__title">
            {question.title}
          </h2>
          <p id="ask-detail" className="ask__detail">
            {question.detail}
          </p>
          {question.kind === "prompt" ? (
            <label className="ask__field">
              {question.label}
              <input
                className="editor__source"
                value={typed}
                placeholder={question.placeholder}
                autoFocus
                onChange={(event) => setTyped(event.target.value)}
              />
            </label>
          ) : null}
          <div className="ask__buttons">
            {buttonsFor(question).map((button) => (
              <Button
                key={button.value}
                // The one that answers submits; the one that cancels closes the
                // dialog itself. Both leave the `returnValue` they would have
                // left as submit buttons — the cancel button's is Escape's own
                // empty string, so `answerOf` cannot tell those two exits apart
                // and does not have to.
                type={button.submits ? "submit" : "button"}
                value={button.value}
                variant={button.danger ? "danger" : "default"}
                disabled={button.submits && !canAnswer(question, typed)}
                onClick={button.submits ? undefined : () => close()}
              >
                {button.label}
              </Button>
            ))}
          </div>
        </form>
      )}
    </Dialog>
  );
}
