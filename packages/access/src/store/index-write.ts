import { mkdirSync, writeFileSync } from "node:fs";
import { assertWithin } from "../paths.js";
import { readIndex, isIndexed, PAGES_SECTION } from "./index.js";

/**
 * Register a page in the index if it is not already reachable (plan 5.7). Adds
 * a `## Pages` section the agent is expected to relocate, and is idempotent.
 * Returns true if it added a link, false if the page was already indexed.
 *
 * Separated from `index.ts` so the read surface the MCP process imports
 * (plan 9.9) pulls no write code — this is the only thing here that writes.
 */
export function registerInIndex(projectRoot: string, slug: string, title?: string): boolean {
  const file = assertWithin(projectRoot, `${projectRoot}/wiki/index.md`);
  const text = readIndex(projectRoot);
  // `readIndex` creates nothing — it is a read. Making the directory is this
  // side's job, because this is the side that writes.
  mkdirSync(`${projectRoot}/wiki`, { recursive: true });
  if (isIndexed(text, slug)) return false;

  const bullet = title ? `- [[${slug}]] — ${title}` : `- [[${slug}]]`;
  const lines = text.split("\n");
  const sectionIdx = lines.findIndex((l) => l === PAGES_SECTION);

  let next: string;
  if (sectionIdx >= 0) {
    let insertAt = sectionIdx + 1;
    while (insertAt < lines.length && lines[insertAt] === "") insertAt++;
    lines.splice(insertAt, 0, bullet);
    next = lines.join("\n");
  } else {
    const tail = text.endsWith("\n") ? text : `${text}\n`;
    next = `${tail}${PAGES_SECTION}\n\n${bullet}\n`;
  }
  writeFileSync(file, next.endsWith("\n") ? next : `${next}\n`, "utf8");
  return true;
}
