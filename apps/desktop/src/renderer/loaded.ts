/**
 * Three states, told apart (desktop-ui 8.3).
 *
 * **A pane that renders nothing while it waits says "there is nothing here",
 * and a pane that catches a failure into an empty list says it too — more
 * loudly, and wrongly.** The checks pane was the worst of them: a `findings()`
 * that threw became `[]`, which rendered *Nothing to fix.* A wiki nobody
 * checked, reported as a wiki with nothing wrong.
 *
 * So loading, failed and ready are one type rather than a `null` doing the work
 * of two of them, and every pane that fetches goes through it.
 */
export type Loaded<T> =
  { state: "loading" } | { state: "failed"; why: string } | { state: "ready"; value: T };

export const LOADING: Loaded<never> = { state: "loading" };

export function ready<T>(value: T): Loaded<T> {
  return { state: "ready", value };
}

export function failed<T>(error: unknown): Loaded<T> {
  return { state: "failed", why: messageOf(error) };
}

/**
 * What went wrong, as a sentence.
 *
 * A thrown non-`Error` is stringified rather than dropped: an IPC rejection can
 * carry anything, and "undefined" on screen is still more than a pane that
 * silently shows nothing.
 */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  const text = String(error);
  return text === "" ? "something went wrong" : text;
}

/** The value, or undefined while it is not there. For a render that reads it. */
export function valueOf<T>(loaded: Loaded<T>): T | undefined {
  return loaded.state === "ready" ? loaded.value : undefined;
}
