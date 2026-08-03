/**
 * Presentation helpers with **no filesystem in them**, and that is the whole
 * reason this file exists separately.
 *
 * The renderer may not do a value import from `@open-wiki/access` or
 * `@open-wiki/access/read` — the lint rule says so, because either pulls
 * `node:fs` into a bundle that must not have it. But a formatter is not
 * knowledge about the project, it is arithmetic about a number, and the export
 * has two doors that both need the same one. Copying it into each is two
 * answers to one question the first time somebody adjusts the rounding.
 *
 * So: a subpath that imports nothing. Anything added here has to keep that
 * true, or the rule it sits beside stops meaning anything.
 */

/**
 * The longest free text out of a manifest that any surface prints into an
 * agent's context.
 *
 * Generous against anything `ow source describe` will write (2000 characters),
 * and a ceiling on what it will not: `manifest.json` arrives with a `git clone`
 * and `parseManifest` deliberately keeps whatever length it finds, because
 * truncating on the *read* path would destroy somebody's data on a file nobody
 * asked to write.
 */
export const MAX_LISTED = 4000;

/**
 * Bound one field for display, saying where it cut.
 *
 * A **rendering**, which destroys nothing — the stored value is untouched. It
 * exists because a multi-megabyte `description` in a hostile manifest is one
 * source crowding every other out of the reader's context.
 *
 * It does not make the content safe and cannot: a manifest that arrived with a
 * clone can say anything, and the answer to that is the scaffolded skill
 * telling the agent the field is not authoritative. Control characters need no
 * stripping on the paths that use this — each emits through `JSON.stringify`,
 * which escapes them — unlike the check report, which writes raw text to a
 * terminal and has `safe()` for exactly that reason.
 *
 * Here rather than in the CLI because there is more than one such surface: the
 * `ow source list` the local agent reads, and the MCP tools a *consulting*
 * project reads, which is the one this was first missed on.
 */
export function boundedText(text: string, max: number = MAX_LISTED): string {
  return text.length > max ? `${text.slice(0, max)}… (${text.length} characters, truncated)` : text;
}

/**
 * Bytes as something a person reads, which is the only thing a size is for
 * here — the number exists so somebody can decide whether to write the file.
 */
export function humanBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit++;
  }
  return `${unit === 0 ? n : n.toFixed(1)} ${units[unit]}`;
}
