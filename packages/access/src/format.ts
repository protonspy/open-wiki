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
