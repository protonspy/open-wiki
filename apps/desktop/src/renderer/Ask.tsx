import { useCallback, useEffect, useRef, useState } from "react";
import { ANSWERED, answerOf, canAnswer, type Question } from "./dialogs.js";

/**
 * Asking a question, in the renderer, because the platform will not (plan 1.1).
 *
 * **A native `<dialog>` opened with `showModal`.** Chromium puts it in the top
 * layer, makes the rest of the document inert, moves focus into it, traps
 * focus there, closes it on Escape and returns focus to where it came from.
 * Every one of those is what "focus-trapped and Escape-dismissable" asks for,
 * and every hand-rolled version of them is a list of the ones it forgot.
 *
 * The form is `method="dialog"`, so Enter submits and the pressed button's
 * `value` lands on `returnValue`. That gives one exit path — `onClose` — for
 * the three ways out, rather than three handlers that have to agree.
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
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState(question.initial ?? "");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="ask"
      aria-labelledby="ask-title"
      aria-describedby="ask-detail"
      // The one exit. Escape leaves `returnValue` empty, a button leaves its
      // own value, and `answerOf` reads the difference.
      onClose={(event) => onAnswer(answerOf(event.currentTarget.returnValue, typed))}
    >
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
          {/* An empty value: Escape's own, so the cancel button and Escape are
              indistinguishable to `answerOf` rather than two paths to keep in
              step. */}
          <button value="">{question.cancelLabel}</button>
          <button
            value={ANSWERED}
            className={question.danger ? "danger" : undefined}
            disabled={!canAnswer(question, typed)}
          >
            {question.confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
