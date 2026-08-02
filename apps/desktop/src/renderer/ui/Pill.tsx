import clsx from "clsx";

/**
 * A state pill (plan 2.3), in the tones the draft's Components plate draws.
 *
 * **Form carries the state, not only the colour.** Every pill has a dot, and
 * `uncited` — a source no page rests on — is drawn hollow and dashed rather
 * than merely a different colour. Its failure mode is disappearing quietly
 * among the others, and a filled pill in a row of filled pills is precisely
 * how it disappears. It is also the one tone that survives being read by
 * somebody who cannot tell the colours apart.
 */
export type PillTone = "neutral" | "ok" | "error" | "cited" | "working" | "uncited";

/** The classes a pill wears. */
export function pillClass(tone: PillTone = "neutral", extra?: string): string {
  return clsx("pill", tone !== "neutral" && `pill--${tone}`, extra);
}

export interface PillProps {
  tone?: PillTone;
  className?: string;
  children: React.ReactNode;
}

export function Pill({ tone, className, children }: PillProps): React.JSX.Element {
  return <span className={pillClass(tone, className)}>{children}</span>;
}
