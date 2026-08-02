import clsx from "clsx";

/**
 * A switch (plan 2.3).
 *
 * **A `<button role="switch">` rather than a styled checkbox.** The state is
 * `aria-checked`, and the CSS reads that same attribute to move the knob — so
 * what a screen reader is told and what the eye is shown cannot disagree,
 * because they are one fact. A checkbox hidden under a `<span>` has two, and
 * the day they drift the visible one wins and nobody notices.
 *
 * The label is required for the same reason `IconButton`'s is: what the switch
 * turns on is not written anywhere the control itself carries.
 */
export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  className,
}: SwitchProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={clsx("switch", className)}
      onClick={() => onChange(!checked)}
    />
  );
}
