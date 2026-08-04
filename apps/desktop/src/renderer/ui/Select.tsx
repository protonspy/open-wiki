import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { ICON_SM } from "./icons.js";

/**
 * A dropdown (uxpass 7.1).
 *
 * **`Segmented` first, this second.** Where the options are few, named and worth
 * reading at a glance the draft uses `.seg`, and that is still the rule — this
 * exists for the case `Segmented` cannot serve: a list whose length is not known
 * when the screen is designed, which in this application is the agent's model,
 * drawn from whatever Groq offered when the key was checked.
 *
 * The native control was left bare, so the one dropdown in the window wore
 * Windows' own chrome underneath two `Segmented` controls in the same panel. The
 * open list is still the platform's — it has to be — but the closed control is
 * this window's, which is the part anybody looking at the panel sees.
 */
export function selectClass(extra?: string): string {
  return clsx("select", extra);
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  /** Read aloud in place of the visual heading beside it. */
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export function Select({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
}: SelectProps): React.JSX.Element {
  return (
    <span className={selectClass(className)}>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {/* Ours, because the native one comes off with `appearance: none`. */}
      <ChevronDown size={ICON_SM} aria-hidden className="select__chevron" />
    </span>
  );
}
