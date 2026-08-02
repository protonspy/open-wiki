import type { LucideIcon } from "lucide-react";

/**
 * The three icon sizes the draft draws, and nothing between them (plan 2.3).
 *
 * Lucide takes a pixel size rather than a class, so the scale lives here as
 * numbers instead of in `globals.css` as rules. Three, because a fourth size
 * is how an icon set stops looking like one set: 13 beside small text, 15 in a
 * control, 18 where an icon is the subject rather than a label's companion.
 */
export const ICON_SM = 13;
export const ICON_MD = 15;
export const ICON_LG = 18;

/**
 * An icon, as every primitive here takes one: the component itself, not a
 * rendered element. Passing `<Mic />` instead would let a caller set the size
 * and the colour, and the whole point of a scale is that they cannot.
 */
export type Icon = LucideIcon;
