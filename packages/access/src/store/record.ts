import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { assertWithin } from "../paths.js";
import type { Origin } from "../write/log.js";

/**
 * After every observed write, append a line to `log.md` and an entry to
 * `changelog.md`, each carrying the write's origin (plan 5.6).
 *
 * These are the wiki's own records — not the `.state/` operation log of group 2
 * (which is machine JSON) and not the transcription journal. `log.md` is a
 * chronological list, newest last; `changelog.md` is dated sections, newest
 * first, matching the file the wiki ships with.
 */

export type WriteAction = "created" | "modified" | "superseded";

export interface WriteEntry {
  /** The slug of the page that was written. */
  slug: string;
  action: WriteAction;
  origin: Origin;
  /** YYYY-MM-DD. */
  date: string;
  /** The replacement slug, for a supersession. */
  replacementSlug?: string;
}

const LOG_HEADER = "# Log\n\nEvery write to the wiki, with who made it. Newest last.\n\n";
const CHANGELOG_HEADER = "# Changelog\n\nWhat changed in the wiki, newest first.\n\n";

function logLine(e: WriteEntry): string {
  const target = e.action === "superseded" ? `${e.slug} → ${e.replacementSlug}` : e.slug;
  return `- ${e.date} ${e.origin} — ${e.action} [[${target}]]`;
}

function changelogBullet(e: WriteEntry): string {
  switch (e.action) {
    case "created":
      return `- Created [[${e.slug}]].`;
    case "modified":
      return `- Updated [[${e.slug}]].`;
    case "superseded":
      return `- Superseded [[${e.slug}]] with [[${e.replacementSlug}]].`;
  }
}

function appendWikiLog(projectRoot: string, line: string): void {
  const file = assertWithin(projectRoot, join(projectRoot, "wiki", "log.md"));
  mkdirSync(join(projectRoot, "wiki"), { recursive: true });
  const text = existsSync(file) ? readFileSync(file, "utf8") : LOG_HEADER;
  writeFileSync(file, text.endsWith("\n") ? `${text}${line}\n` : `${text}\n${line}\n`, "utf8");
}

/** Insert a bullet into the changelog under its date section, newest first. */
function appendChangelogEntry(projectRoot: string, date: string, bullet: string): void {
  const file = assertWithin(projectRoot, join(projectRoot, "wiki", "changelog.md"));
  mkdirSync(join(projectRoot, "wiki"), { recursive: true });
  const text = existsSync(file) ? readFileSync(file, "utf8") : CHANGELOG_HEADER;

  const lines = text.split("\n");
  // The header is everything before the first `## ` section.
  let firstSection = lines.findIndex((l) => l.startsWith("## "));
  if (firstSection === -1) firstSection = lines.length;

  // Find an existing section for this date.
  let sectionStart = -1;
  for (let i = firstSection; i < lines.length; i++) {
    if (lines[i] === `## ${date}`) {
      sectionStart = i;
      break;
    }
  }

  if (sectionStart >= 0) {
    // Prepend the bullet as the first bullet of the section: find the first
    // bullet line and insert above it, or insert after the header + blank.
    let insertAt = sectionStart + 1;
    while (insertAt < lines.length && lines[insertAt] === "") insertAt++;
    lines.splice(insertAt, 0, bullet);
    writeFileSync(file, lines.join("\n"), "utf8");
    return;
  }

  // No section yet: build one and place it in descending date order.
  const section = [`## ${date}`, "", bullet, ""];
  // Walk sections in order (they are newest-first, descending); insert before
  // the first section whose date is strictly less than this one.
  let insertAt = firstSection;
  while (insertAt < lines.length) {
    const header = lines[insertAt]!;
    if (header.startsWith("## ") && header.slice(3) < date) break;
    // Skip past this section to the next `## `.
    let j = insertAt + 1;
    while (j < lines.length && !lines[j]!.startsWith("## ")) j++;
    insertAt = j;
  }
  lines.splice(insertAt, 0, ...section);
  writeFileSync(file, lines.join("\n"), "utf8");
}

/**
 * Record an observed write in both `log.md` and `changelog.md`. Called by
 * whichever path made the write — editor, CLI, hook or observer — so the
 * records carry the origin and stay consistent across paths.
 */
export function recordWrite(projectRoot: string, entry: WriteEntry): void {
  appendWikiLog(projectRoot, logLine(entry));
  appendChangelogEntry(projectRoot, entry.date, changelogBullet(entry));
}
