/**
 * What counts as a page's prose — the one rule the vocabulary check reads by
 * and the *Replace* rewrite (desktop-ui 5.6) writes by.
 *
 * **It lives here, below both, and imports nothing.** The check is part of the
 * read surface the MCP process loads (plan 9.9), and the rewrite calls the gate
 * and `writePage`; putting the rule beside the rewrite would have pulled write
 * code into a surface whose whole guarantee is that it has none — the same trap
 * `CONTENTS` and `UNPACKING` were moved out of `archive.ts` to avoid.
 *
 * The rule itself: **code is literal, and a wikilink to an alias is a
 * legitimate way to reach the page.** Neither is prose using the wrong word, so
 * neither is matched and neither is rewritten. One definition, because two
 * would let the button change a word the check never complained about — a
 * variable inside a fence, the target of a link that resolves — and leave the
 * finding standing afterwards.
 */

/** The regions that are not prose. */
export const LITERAL_REGIONS: readonly RegExp[] = [
  /```[\s\S]*?```/g, // fenced code
  /`[^`\n]*`/g, // inline code
  /\[\[[^\]]*\]\]/g, // wikilinks
];

/**
 * The body with every literal region removed, for a caller that only needs to
 * *look* — which is what the vocabulary check does before it matches.
 */
export function blankLiterals(body: string): string {
  let out = body;
  for (const pattern of LITERAL_REGIONS) {
    out = out.replace(new RegExp(pattern.source, pattern.flags), "");
  }
  return out;
}

/**
 * The character spans a rewrite must leave alone, for a caller that needs to
 * know *where* they are rather than what is left without them.
 */
export function literalSpans(body: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const pattern of LITERAL_REGIONS) {
    // A fresh regex per body: the list above holds global ones, and a shared
    // `lastIndex` makes the second call over a different body skip its start.
    const re = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(body)) !== null) {
      spans.push([match.index, match.index + match[0].length]);
      if (match[0].length === 0) re.lastIndex += 1;
    }
  }
  return spans;
}

/** True when `[at, end)` overlaps any of `spans`. */
export function withinSpans(
  spans: readonly (readonly [number, number])[],
  at: number,
  end: number,
): boolean {
  return spans.some(([from, to]) => at < to && end > from);
}

/**
 * The boundary a term is matched on: not a word character and not a hyphen
 * either side, case-insensitive.
 *
 * Shared for the same reason the regions are — the check finds "Grand Total"
 * where the project's term is "order total", and a rewrite matching differently
 * would replace something else or nothing at all.
 */
export function termPattern(term: string, flags = "i"): RegExp {
  return new RegExp(`(?<![\\w-])${escapeForRegExp(term)}(?![\\w-])`, flags);
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
