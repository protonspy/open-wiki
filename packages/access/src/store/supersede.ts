import { existsSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { assertWithin } from "../paths.js";
import { readFrontmatter, validatePage, type PageIssue } from "./page.js";
import { writePage } from "../write/atomic-write.js";
import type { Origin } from "../write/log.js";

/**
 * Record supersession as **data**, not only as struck-through prose
 * (`adr`-adjacent: the glossary's supersession entry). The replaced page keeps
 * its prose — the agent writes the strike-through — and this sets the three
 * fields a traversal answers from: `status: superseded`, `superseded-by: <id>`,
 * and `updated: <the date it happened>`. Without it, `ow graph superseded`
 * (plan 9.12) has nothing to walk.
 *
 * The store guarantees shape, not that the replacement exists: a
 * `superseded-by` pointing at a page that is not there is a dangling reference,
 * which is a group 7 finding rather than a refusal here. Refusing it would be
 * the store checking correctness of a reference, which is 5.3's exception, not
 * the default.
 */

const TYPE = /^[a-z][a-z0-9-]*$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export type SupersessionResult = { ok: true } | { ok: false; errors: PageIssue[] };

function badId(id: string): boolean {
  const colon = id.indexOf(":");
  if (colon < 0) return true;
  return !TYPE.test(id.slice(0, colon)) || !SLUG.test(id.slice(colon + 1));
}

/**
 * Replace a top-level frontmatter key's value with `value`, preserving every
 * other line of the page — including the agent's prose and the formatting of
 * fields this does not touch. Surgical rather than re-serialised, so the store
 * normalises only the three fields it owns.
 */
function setFrontmatterField(markdown: string, key: string, value: string): string {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return markdown;
  const head = match[1] ?? "";
  const body = match[2] ?? "";
  const lines = head.split("\n");
  const re = new RegExp(`^${key}:\\s.*$`);
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i] ?? "")) {
      lines[i] = `${key}: ${value}`;
      found = true;
      break;
    }
  }
  if (!found) lines.push(`${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

/**
 * Mark the page at `pagePath` as superseded by `replacementId` on `date`. The
 * write goes through the safe path of group 2 (snapshot, atomic write, log),
 * so it is undoable like any other observed write.
 */
export function supersedePage(
  projectRoot: string,
  pagePath: string,
  replacementId: string,
  date: string,
  origin: Origin,
): SupersessionResult {
  const full = assertWithin(projectRoot, join(projectRoot, pagePath));
  if (!existsSync(full)) {
    return { ok: false, errors: [{ field: "", reason: `no such page: ${pagePath}` }] };
  }
  if (badId(replacementId)) {
    return {
      ok: false,
      errors: [
        {
          field: "superseded-by",
          reason: `superseded-by "${replacementId}" must name the replacement as type:slug`,
        },
      ],
    };
  }
  if (!DATE.test(date)) {
    return {
      ok: false,
      errors: [{ field: "updated", reason: "updated must be a YYYY-MM-DD date" }],
    };
  }

  const markdown = readFileSync(full, "utf8");
  const block = readFrontmatter(markdown);
  if (!block || !block.parsed) {
    return {
      ok: false,
      errors: [{ field: "", reason: "page has no readable frontmatter block" }],
    };
  }

  let next = setFrontmatterField(markdown, "status", "superseded");
  next = setFrontmatterField(next, "superseded-by", replacementId);
  next = setFrontmatterField(next, "updated", date);

  const slug = basename(pagePath).replace(/\.md$/i, "");
  const validation = validatePage(next, slug);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  writePage(projectRoot, pagePath, next, origin);
  return { ok: true };
}
