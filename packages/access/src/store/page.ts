import { parse } from "yaml";
import { DATE } from "../dates.js";

/**
 * The validated store (plan group 5). The application does not guarantee the
 * content is good — it guarantees it is **well formed**: a page that breaks the
 * schema is refused with a reason, instead of being stored malformed.
 *
 * `index.md`, `changelog.md` and `log.md` are not entity pages; they are
 * themselves and are not validated against this schema (`adr:0015`-adjacent:
 * the convention ships as skills). Everything else under `wiki/` is an entity
 * page with the frontmatter below.
 *
 * The schema mirrors the `wiki` skill scaffolded into the project
 * (`adr:0015-the-convention-ships-as-skills`) — one place owns the contract,
 * the other checks it.
 */

/** The three pages under `wiki/` that are not entity pages. */
export const NON_ENTITY_PAGES = ["index.md", "changelog.md", "log.md"] as const;

/** True for a page path that carries entity frontmatter. */
export function isEntityPage(pagePath: string): boolean {
  // Match on the basename so codewiki pages (codewiki/dispatch.md) are entities
  // while wiki/index.md is not.
  const base = pagePath.split(/[\\/]/).pop() ?? pagePath;
  return !(NON_ENTITY_PAGES as readonly string[]).includes(base);
}

/**
 * The frontmatter every entity page carries. `id` is `type:slug` and the
 * filename is the slug; `sources` holds the provenance links the page rests on;
 * `superseded-by` names the replacement when `status` is `superseded`.
 */
export interface PageFrontmatter {
  id: string;
  type: string;
  title: string;
  status: "active" | "superseded";
  aliases: string[];
  updated: string;
  sources: string[];
  "superseded-by": string;
}

const REQUIRED_KEYS = [
  "id",
  "type",
  "title",
  "status",
  "aliases",
  "updated",
  "sources",
  "superseded-by",
] as const;

/** One thing wrong with a page, in a form the writer can act on (plan 9.13). */
export interface PageIssue {
  field: string;
  reason: string;
  /**
   * The thing the issue is about — a wikilink's target, say. Carried so a
   * caller can locate it without parsing it back out of `reason`, which
   * silently produces garbage the first time the wording changes.
   */
  target?: string;
}

export type PageValidation =
  { ok: true; frontmatter: PageFrontmatter; body: string } | { ok: false; errors: PageIssue[] };

// A page slug: lowercase letters, digits and dashes, no extension (the
// filename is the slug, so `wiki/fenix.md` → slug `fenix`).
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// A type token: lowercase, letters/digits/dashes.
const TYPE = /^[a-z][a-z0-9-]*$/;
// `updated` is a calendar date in the only form a reader scans: YYYY-MM-DD.
// A provenance link's shape: `src://<id>#p<N>` or `rec://<id>#<instant>`. The
// id must be non-empty; the fragment must be non-empty. Resolving the id to a
// real source — and the instant to one inside the recording — is plan 5.4;
// here we only check the shape.
const PROVENANCE = /^(src|rec):\/\/[^#]+#.+$/;

/**
 * Read the leading `---` frontmatter block. Returns `null` when the page has
 * none, `{ parsed: false }` when the block is there but the YAML will not read,
 * and `{ parsed: true }` with the mapping otherwise.
 */
export type FrontmatterBlock =
  | { parsed: true; frontmatter: unknown; body: string }
  | { parsed: false; reason: string; body: string };

export function readFrontmatter(markdown: string): FrontmatterBlock | null {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  const body = match[2] ?? "";
  try {
    return { parsed: true, frontmatter: parse(match[1] ?? ""), body };
  } catch (err) {
    return {
      parsed: false,
      reason: err instanceof Error ? err.message : "invalid YAML",
      body,
    };
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Validate an entity page's markdown against the schema. `slug` is the filename
 * stem (`wiki/<slug>.md`), which the id must agree with. Collects every problem
 * rather than stopping at the first, so a writer gets the whole list to fix in
 * one pass — the same list a hook returns as a denial reason (plan 5.1, 9.13).
 */
export function validatePage(markdown: string, slug: string): PageValidation {
  const block = readFrontmatter(markdown);
  if (!block) {
    return { ok: false, errors: [{ field: "", reason: "page has no frontmatter block" }] };
  }
  if (!block.parsed) {
    return {
      ok: false,
      errors: [{ field: "", reason: `could not parse frontmatter: ${block.reason}` }],
    };
  }
  return validateFrontmatter(block.frontmatter, block.body, slug);
}

/** Validate an already-parsed frontmatter object. Exposed for the hook path. */
export function validateFrontmatter(
  frontmatter: unknown,
  body: string,
  slug: string,
): PageValidation {
  const errors: PageIssue[] = [];

  if (frontmatter === null || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    return { ok: false, errors: [{ field: "", reason: "frontmatter must be a mapping" }] };
  }
  const fm = frontmatter as Record<string, unknown>;

  for (const key of REQUIRED_KEYS) {
    if (!(key in fm)) errors.push({ field: key, reason: `missing required field "${key}"` });
  }

  const id = fm["id"];
  if (typeof id === "string") {
    const colon = id.indexOf(":");
    if (colon < 0) {
      errors.push({ field: "id", reason: `id "${id}" is not type:slug` });
    } else {
      const type = id.slice(0, colon);
      const idSlug = id.slice(colon + 1);
      if (!TYPE.test(type)) {
        errors.push({ field: "id", reason: `id type "${type}" is not a lowercase token` });
      }
      if (!SLUG.test(idSlug)) {
        errors.push({ field: "id", reason: `id slug "${idSlug}" is not a slug` });
      } else if (idSlug !== slug) {
        errors.push({
          field: "id",
          reason: `id "${id}" does not match filename "${slug}"`,
        });
      }
    }
  } else if ("id" in fm) {
    errors.push({ field: "id", reason: "id must be a string" });
  }

  if ("type" in fm && (typeof fm["type"] !== "string" || !TYPE.test(fm["type"]))) {
    errors.push({ field: "type", reason: "type must be a lowercase token" });
  }

  if ("title" in fm && (typeof fm["title"] !== "string" || fm["title"].trim() === "")) {
    errors.push({ field: "title", reason: "title must be a non-empty string" });
  }

  const status = fm["status"];
  if (typeof status === "string") {
    if (status !== "active" && status !== "superseded") {
      errors.push({ field: "status", reason: `status "${status}" is not active or superseded` });
    }
  } else if ("status" in fm) {
    errors.push({ field: "status", reason: "status must be a string" });
  }

  if ("aliases" in fm && !isStringArray(fm["aliases"])) {
    errors.push({ field: "aliases", reason: "aliases must be a list of strings" });
  }

  if ("updated" in fm && (typeof fm["updated"] !== "string" || !DATE.test(fm["updated"]))) {
    errors.push({ field: "updated", reason: "updated must be a YYYY-MM-DD date" });
  }

  if ("sources" in fm) {
    if (!isStringArray(fm["sources"])) {
      errors.push({ field: "sources", reason: "sources must be a list of provenance links" });
    } else {
      for (const src of fm["sources"]) {
        if (!PROVENANCE.test(src)) {
          errors.push({
            field: "sources",
            reason: `"${src}" is not a provenance link (src://<id>#p<N> or rec://<id>#<instant>)`,
          });
        }
      }
    }
  }

  const supersededBy = fm["superseded-by"];
  const isSuperseded = status === "superseded";
  if (typeof supersededBy === "string") {
    if (isSuperseded) {
      const colon = supersededBy.indexOf(":");
      if (
        colon < 0 ||
        !TYPE.test(supersededBy.slice(0, colon)) ||
        !SLUG.test(supersededBy.slice(colon + 1))
      ) {
        errors.push({
          field: "superseded-by",
          reason: `superseded-by "${supersededBy}" must name the replacement as type:slug`,
        });
      }
    } else if (supersededBy !== "") {
      errors.push({
        field: "superseded-by",
        reason: "superseded-by must be empty while the page is active",
      });
    }
  } else if ("superseded-by" in fm) {
    errors.push({ field: "superseded-by", reason: "superseded-by must be a string" });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    frontmatter: {
      id: fm["id"] as string,
      type: fm["type"] as string,
      title: fm["title"] as string,
      status: fm["status"] as "active" | "superseded",
      aliases: fm["aliases"] as string[],
      updated: fm["updated"] as string,
      sources: fm["sources"] as string[],
      "superseded-by": fm["superseded-by"] as string,
    },
    body,
  };
}
