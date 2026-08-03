import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  containsInstant,
  formatInstant,
  isTimeMap,
  parseInstant,
  TIMEMAP_FILE,
  type TimeMap,
} from "@open-wiki/audio/timemap";
import { resolvedSourceDir, sourceExists } from "../sources/manifest.js";
import type { PageIssue } from "./page.js";

/**
 * Refuse a write whose provenance citation does not point at an existing
 * source, and for audio at an instant inside the recording (plan 5.4). The
 * shape of a provenance link is already checked by 5.1; this checks the
 * *reference* — that the source is on disk, and that a recording's instant is
 * one that recording actually contains.
 *
 * The in-range half was dormant until plan 4.7 settled the map's format. It is
 * live now and reads `timemap.json` from the recording's own directory. A
 * recording with no map — captured but not yet encoded — keeps the weaker
 * answer: the instant must read as a time, and nothing measures it against a
 * length nobody has written down. An absent map cannot make a citation resolve
 * falsely, so degrading that way is safe rather than merely convenient.
 *
 * What an instant *is* is not decided here. `parseInstant` is the one authority
 * (`@open-wiki/audio/timemap`), because two definitions of a time format
 * disagree at exactly the values that matter — `14:75` reads as a time to a
 * loose regex and is not one.
 */

// `src://<id>#p<N>` — a document at a page. The fragment is `p` followed by the
// page number, the form a PDF citation carries (`adr:0011`).
const FILE_FRAGMENT = /^p\d+$/;

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
      const instantNs = parseInstant(parsed.fragment);
      if (instantNs === null) {
        issues.push({
          field: "provenance",
          reason: `"${link}" — a recording citation's instant must be HH:MM or HH:MM:SS`,
        });
        continue;
      }
      const map = readTimeMap(projectRoot, parsed.id);
      if (map && !containsInstant(map, instantNs)) {
        issues.push({
          field: "provenance",
          reason:
            `"${link}" — that instant is past the end of the recording, ` +
            `which runs to ${formatInstant(map.compressedDurationNs)}`,
        });
      }
    }
  }
  return issues;
}

/**
 * A recording's time map, or `null` when it has none yet.
 *
 * Confined against `raw/` for the same reason `readManifest` is: the id came
 * out of a page's prose, so a citation like `rec://../../elsewhere#0:01` parses
 * as one and must not be answered against a file outside the sources
 * directory.
 *
 * Every failure reads as no map: an id that escaped, a file that will not
 * parse, and — the one a cast would have missed — a file that parses into
 * something that is not a time map. `{}` casts to `TimeMap` as happily as a
 * real map does and then throws inside the reader, which would take down `ow
 * check` for the whole project over one corrupt file in one recording
 * directory. `isTimeMap` is the check the cast is not.
 *
 * None of those can make a citation resolve falsely, and refusing an otherwise
 * valid page because a JSON file got truncated would be this check doing more
 * harm than the thing it looks for. An escaped id has already been reported by
 * `sourceExists` above.
 */
function readTimeMap(projectRoot: string, id: string): TimeMap | null {
  try {
    // Found, not joined (task 8.3). Joining meant a *filed* recording appeared
    // to have no time map, so the in-range check silently did not run — and a
    // citation past the end of that recording passed `ow check` when it should
    // have been refused. Failing quietly is the outcome this check exists to
    // prevent, so it must not be how the check itself fails.
    const file = join(resolvedSourceDir(projectRoot, id), TIMEMAP_FILE);
    if (!existsSync(file)) return null;
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return isTimeMap(parsed) ? parsed : null;
  } catch {
    return null;
  }
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
