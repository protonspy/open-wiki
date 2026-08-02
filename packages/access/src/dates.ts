/**
 * The one date shape this project writes, and the one place it is spelled.
 *
 * A page's `updated`, a supersession's date, a changelog entry and a source's
 * processed declaration are all the same `YYYY-MM-DD`. The regex had been
 * copy-pasted into three modules before a fourth wanted it — and four copies of
 * a validator are four chances for one of them to accept `2026-13-40` after
 * somebody tightens the others.
 */

/** `YYYY-MM-DD`, with the month and day bounded. */
export const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** True when `value` is a string in that shape. */
export function isDate(value: unknown): value is string {
  return typeof value === "string" && DATE.test(value);
}

/** Today, as the store writes it. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
