import clsx from "clsx";
import { Search } from "lucide-react";
import { ICON_SM } from "./icons.js";

/**
 * The search box in a pane's bar (plan 2.3).
 *
 * The magnifier is inside the box, so the control reads as one thing at the
 * density this window runs at — an icon beside a field would be two objects
 * eight pixels apart. The `<input>`'s own outline is removed and the ring is
 * drawn around the whole box instead (see `globals.css`), which is the one
 * case where removing an outline is not the mistake 2.4 is about: it is moved,
 * not deleted, and it lands where the eye reads the control's edge.
 */
export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  /** What is being searched. Also the accessible name — there is no visible label. */
  label: string;
  placeholder?: string;
  className?: string;
}

export function SearchInput({
  value,
  onChange,
  label,
  placeholder,
  className,
}: SearchInputProps): React.JSX.Element {
  return (
    <div className={clsx("search", className)}>
      <Search size={ICON_SM} aria-hidden />
      <input
        type="search"
        value={value}
        aria-label={label}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
