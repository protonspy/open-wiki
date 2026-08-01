import { stringify } from "yaml";
import { readFrontmatter, type FrontmatterBlock } from "./page.js";
import { extractProvenanceLinks } from "./provenance.js";

export { extractProvenanceLinks };

/**
 * The fields the store fills itself, so the write does not depend on the agent
 * remembering rather than merely telling it (plan 5.5):
 *
 * - `updated` — the date of this write, when the agent left it out.
 * - `sources` — the provenance links cited inline in the body, appended to
 *   whatever the agent already listed, deduplicated. The agent writes the
 *   citations where the claims are; the store keeps the frontmatter field in
 *   sync, so `sources` is never maintained by hand.
 *
 * This is the `updatedInput` the hook path returns: the completed markdown,
 * ready to write. Surgical completion is not attempted — the store owns the
 * well-formedness of the frontmatter it produces, and re-serialising the
 * mapping is the robust way to set two fields at once. The body is preserved
 * verbatim.
 */

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * Complete a page's automatic fields. Returns the markdown unchanged when it
 * has no readable frontmatter — 5.1 refuses that separately; completing it is
 * not the store guessing a schema the agent did not provide.
 */
export function completeFrontmatter(markdown: string, date: string): string {
  const block: FrontmatterBlock | null = readFrontmatter(markdown);
  if (!block || !block.parsed) return markdown;

  const raw = block.frontmatter;
  const fm: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};

  if (typeof fm["updated"] !== "string" || !DATE.test(fm["updated"])) {
    fm["updated"] = date;
  }

  const existing = isStringArray(fm["sources"]) ? fm["sources"] : [];
  const bodySources = extractProvenanceLinks(block.body);
  fm["sources"] = dedupe([...existing, ...bodySources]);

  const head = stringify(fm).trimEnd();
  return `---\n${head}\n---\n${block.body}`;
}
