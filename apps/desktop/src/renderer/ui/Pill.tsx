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
 *
 * `warning` follows the same rule and was added for the same reason (uxpass
 * 9.1): its marker is a triangle rather than a dot, so an error and a warning
 * are told apart by shape — which is what `ChecksPane` already does with
 * `CircleAlert` and `TriangleAlert`, and what keeps this from reading as
 * `cited`, whose amber means something else entirely.
 */
export type PillTone = "neutral" | "ok" | "error" | "warning" | "cited" | "working" | "uncited";

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
