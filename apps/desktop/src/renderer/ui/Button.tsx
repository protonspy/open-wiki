import clsx from "clsx";
import { ICON_SM, type Icon } from "./icons.js";

/**
 * A button (plan 2.3), in the four kinds the draft's Components plate draws.
 *
 * **`primary` is the amber one, and a screen gets at most one.** Amber means
 * provenance everywhere else in this window; spending it on a second button
 * is how an accent stops meaning anything. `danger` is not a red primary
 * either — it is dim-filled with light red ink, so the destructive action is
 * legible without being the loudest thing on screen.
 */
export type ButtonVariant = "default" | "primary" | "ghost" | "danger";

/**
 * `sm` is the 22px row-action button — what sits inside a table row without
 * making the row taller than `--row`.
 */
export type ButtonSize = "md" | "sm";

/**
 * The classes a button wears.
 *
 * Exported and computed here rather than written inline in the JSX, because
 * which class means which state is a decision, and a decision inside a
 * component is a decision no test can reach.
 */
export function buttonClass(
  variant: ButtonVariant = "default",
  size: ButtonSize = "md",
  extra?: string,
): string {
  return clsx("btn", variant !== "default" && `btn--${variant}`, size === "sm" && "btn--sm", extra);
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Drawn before the label, at the size the label's text wants. */
  icon?: Icon;
}

export function Button({
  variant,
  size,
  icon: IconGlyph,
  className,
  children,
  // Explicit, because a `<button>` inside a form defaults to submitting it —
  // which is how a dialog's cancel button once swallowed the answer (1.1).
  type = "button",
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button type={type} className={buttonClass(variant, size, className)} {...rest}>
      {IconGlyph ? <IconGlyph size={ICON_SM} aria-hidden /> : null}
      {children}
    </button>
  );
}
