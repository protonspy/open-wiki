/**
 * The store dates a write by the day it happened, in the one format the page
 * schema accepts. Shared by the CLI verbs and the hook handlers so a page
 * written through either door carries the same `updated` value.
 */
export function today(now: Date = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}
