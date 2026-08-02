import clsx from "clsx";

/**
 * A row of mutually exclusive choices (desktop-ui 6.1), as the draft's `.seg`.
 *
 * **Buttons with `aria-pressed`, not a `<select>` and not radios.** The draft
 * uses it where the options are few, named, and worth reading at a glance —
 * three languages, two transcription providers. A dropdown hides two of three
 * answers behind a click; radios spend a line each on a choice that fits on
 * one.
 *
 * The pressed one is the state, and it is announced as well as drawn: colour
 * alone is not a state anyone should be asked to rely on, which is the same
 * rule the rail and the tree follow.
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function segmentClass(pressed: boolean, extra?: string): string {
  return clsx("seg__option", pressed && "seg__option--on", extra);
}

export interface SegmentedProps<T extends string> {
  /** Read aloud in place of the visual heading beside it. */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: SegmentedProps<T>): React.JSX.Element {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={segmentClass(option.value === value)}
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
