import clsx from "clsx";
import { ICON_SM, type Icon } from "./icons.js";

/** The classes an icon-only button wears. */
export function iconButtonClass(size: "md" | "sm" = "md", extra?: string): string {
  return clsx("icon-btn", size === "sm" && "icon-btn--sm", extra);
}

export interface IconButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  icon: Icon;
  /**
   * **Required, and not decoration.** An icon-only button with no accessible
   * name is a control nobody using a screen reader can identify, and the
   * titlebar's pause and stop — the two buttons that end a recording of other
   * people's conversation — are exactly the ones that must not be a mystery.
   * It becomes both the label and the tooltip, so what is read aloud and what
   * appears on hover are one string rather than two that drift.
   */
  label: string;
  size?: "md" | "sm";
}

export function IconButton({
  icon: IconGlyph,
  label,
  size,
  className,
  type = "button",
  ...rest
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      className={iconButtonClass(size, className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      <IconGlyph size={ICON_SM} aria-hidden />
    </button>
  );
}
