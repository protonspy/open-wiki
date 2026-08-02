import { useEffect, useRef } from "react";
import clsx from "clsx";

/**
 * The modal every overlay in this window is (plan 2.3).
 *
 * **A native `<dialog>` opened with `showModal`.** Chromium puts it in the top
 * layer, makes the rest of the document inert, moves focus into it, traps
 * focus there, closes it on Escape and returns focus to whatever held it
 * before. Every one of those is what an overlay has to do, and every
 * hand-rolled version of them is a list of the ones it forgot. The sheet, the
 * drawer and the question box (`Ask.tsx`) are this component with a different
 * width and a different edge to sit against.
 *
 * **One exit, `onClose`.** Escape, a button that submits a `method="dialog"`
 * form, and an explicit `close()` all arrive there, carrying `returnValue` —
 * so the three ways out cannot disagree about what happened, which is what
 * three separate handlers would have to be kept doing by hand.
 */
export interface DialogProps {
  /** Where it sits and how wide: `ask`, `sheet`, `drawer`. */
  className?: string;
  /** The id of the element naming this dialog, for `aria-labelledby`. */
  labelledBy?: string;
  describedBy?: string;
  /**
   * What the dialog closed with. Empty is Escape's own — see `dialogs.ts`,
   * which reads the difference for the question box.
   */
  onClose: (returnValue: string) => void;
  /**
   * Rendered with the one thing the caller cannot get at otherwise: closing
   * the dialog on purpose, from a control that is not a submit button.
   */
  children: (close: (returnValue?: string) => void) => React.ReactNode;
}

export function Dialog({
  className,
  labelledBy,
  describedBy,
  onClose,
  children,
}: DialogProps): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className={clsx(className)}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onClose={(event) => onClose(event.currentTarget.returnValue)}
    >
      {children((returnValue = "") => ref.current?.close(returnValue))}
    </dialog>
  );
}
