import { sourceExists } from "../sources/manifest.js";
import type { PageIssue } from "./page.js";

/**
 * Refuse a write whose provenance citation does not point at an existing
 * source, and for audio at a well-formed instant (plan 5.4). The shape of a
 * provenance link is already checked by 5.1; this checks the *reference* —
 * that the source is on disk, and that a recording's instant reads as a time.
 *
 * The in-range check — that a recording's instant falls inside it — needs the
 * time map group 4 writes (`timemap.json`). Until recordings exist the check is
 * dormant: there is no map to read. It is a guarded extension point here, not a
 * hole, because an absent map cannot make a present recording's citation
 * resolve falsely.
 */

// `src://<id>#p<N>` — a document at a page. The fragment is `p` followed by the
// page number, the form a PDF citation carries (`adr:0011`).
const FILE_FRAGMENT = /^p\d+$/;
// `rec://<id>#<instant>` — a recording at an instant. `14:32` or `14:32:05`
// (`adr:0011`); anything else is not an instant.
const INSTANT = /^\d{1,2}:\d{2}(:\d{2})?$/;

interface ParsedLink {
  scheme: "src" | "rec";
  id: string;
  fragment: string;
}

function parseLink(link: string): ParsedLink | null {
  const m = link.match(/^(src|rec):\/\/([^#]+)#(.+)$/);
  if (!m) return null;
  return { scheme: m[1] as "src" | "rec", id: m[2]!, fragment: m[3]! };
}

/**
 * Validate the provenance links in a page's `sources`. Returns one issue per
 * link that does not resolve to an existing source — or, for a recording, whose
 * instant is not a time. Empty means every citation resolves.
 *
 * The in-range check against `timemap.json` is pending the recording time map
 * (plan 4.7); it activates there, where the map's format is decided.
 */
export function resolveProvenance(projectRoot: string, sources: string[]): PageIssue[] {
  const issues: PageIssue[] = [];
  for (const link of sources) {
    const parsed = parseLink(link);
    if (!parsed) {
      issues.push({ field: "provenance", reason: `"${link}" is not a provenance link` });
      continue;
    }
    if (!sourceExists(projectRoot, parsed.id)) {
      issues.push({
        field: "provenance",
        reason: `"${link}" points at no source (no raw/${parsed.id})`,
      });
      continue;
    }
    if (parsed.scheme === "src") {
      if (!FILE_FRAGMENT.test(parsed.fragment)) {
        issues.push({
          field: "provenance",
          reason: `"${link}" — a file citation's fragment must be p<page>`,
        });
      }
    } else {
      if (!INSTANT.test(parsed.fragment)) {
        issues.push({
          field: "provenance",
          reason: `"${link}" — a recording citation's instant must be HH:MM or HH:MM:SS`,
        });
      }
      // in-range: the instant must fall inside the recording. That needs the
      // time map group 4 writes (timemap.json); it activates there, where the
      // map's format is decided. An absent map cannot make a citation resolve
      // falsely, so leaving it dormant is safe.
    }
  }
  return issues;
}

// A provenance link as it appears in prose: `src://<id>#p<N>` or
// `rec://<id>#<instant>`, bounded by whitespace or the brackets that wrap a
// markdown link. The id carries no `#` (the `#` separates it from the
// fragment). The fragment is `p<digits>` or a time `HH:MM(:SS)`, so its charset
// is `[p\d:]+` — that is what stops it at a comma, period or closing bracket
// without eating the sentence around it.
const PROVENANCE_IN_BODY = /\b(src|rec):\/\/[^\s#)\]]+#[p\d:]+/g;

/**
 * Pull every provenance link out of a page's body — the citations the agent
 * wrote inline — so the store can mirror them into the `sources` field without
 * the agent keeping that list by hand (plan 5.5). Deduplicated, order-stable.
 */
export function extractProvenanceLinks(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(PROVENANCE_IN_BODY)) {
    const link = m[0];
    if (link && !seen.has(link)) {
      seen.add(link);
      out.push(link);
    }
  }
  return out;
}
