import clsx from "clsx";

/**
 * A text field (uxpass 7.1).
 *
 * **There was no input component at all.** Ten raw `<input>`s, and the class
 * four of them borrowed was `editor__source` — the markdown editor's monospace
 * textarea style — on the project name, the directory, the API key and the New
 * page slug. So the one control somebody types their project's name into was
 * dressed as a code editor, and the four fields that shared a look shared it by
 * accident.
 *
 * Text-like only: `checkbox` and `radio` are a different control that the
 * browser draws and this window does not restyle, so they stay `<input>`s inside
 * their own labels. A component that rendered both would have to be two
 * components wearing one name.
 */
export type InputType = "text" | "password" | "search";

/** The classes a text field wears. */
export function inputClass(extra?: string): string {
  return clsx("input", extra);
}

export interface InputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "size"
> {
  type?: InputType;
}

export function Input({ type = "text", className, ...rest }: InputProps): React.JSX.Element {
  return <input type={type} className={inputClass(className)} {...rest} />;
}
