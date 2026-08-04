/**
 * Completing the two things a wiki page is made of (uxpass 2.5).
 *
 * **The renderer already holds both vocabularies.** `index()` answers every
 * slug, the sources pane answers every source id, and an editor whose entire
 * value is `[[links]]` and `src://…#p12` offered neither — which the pass called
 * the single largest missed opportunity in the application. A wikilink typed
 * from memory is `wikilink.broken` a check reports later; a citation typed from
 * memory is a claim that resolves to nothing.
 *
 * Everything here is a pure function over a string and a caret, so the whole of
 * *what is being completed*, *what matches* and *what the box says afterwards*
 * is testable without a DOM — the same shape the rest of this renderer uses.
 */

/** What is being completed: a page's slug, or a source's id. */
export type CompletionKind = "page" | "source";

export interface Completion {
  kind: CompletionKind;
  /** What has been typed since the opener. */
  prefix: string;
  /** Where the prefix starts, so a chosen candidate replaces exactly it. */
  at: number;
  /** Where the caret was — always `at + prefix.length`, carried for the paste. */
  caret: number;
}

/** `src://` or `rec://` and whatever has been typed after it, at the caret. */
const CITATION = /(?:src|rec):\/\/([^\s#[\]()|]*)$/;

/**
 * What the caret is in the middle of, if it is in the middle of anything.
 *
 * Both openers are looked for on the current line only: a wikilink and a
 * citation are both written inline, and scanning the whole buffer would offer
 * completions for a `[[` somebody left open forty lines up.
 *
 * When both are open — `[[src://…` — the nearer one wins, because the nearer
 * one is the one being typed.
 */
export function completionAt(text: string, caret: number): Completion | null {
  const lineStart = text.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
  const line = text.slice(lineStart, caret);

  const candidates: Completion[] = [];

  const opener = line.lastIndexOf("[[");
  if (opener >= 0) {
    const prefix = line.slice(opener + 2);
    // A closed link, a label, or a stray bracket: not a target being typed.
    if (!/[[\]|]/.test(prefix)) {
      candidates.push({ kind: "page", prefix, at: lineStart + opener + 2, caret });
    }
  }

  const citation = CITATION.exec(line);
  if (citation) {
    const prefix = citation[1] ?? "";
    candidates.push({ kind: "source", prefix, at: caret - prefix.length, caret });
  }

  return candidates.sort((a, b) => b.at - a.at)[0] ?? null;
}

/**
 * The candidates for a completion, best first.
 *
 * **A prefix match outranks a match in the middle**, which is what somebody
 * typing `fen` means and not what a plain `includes` would give them: on a wiki
 * where `fenix` and `refenced-thing` both exist, sorting alphabetically would
 * put the one they did not mean first.
 *
 * Capped, because a list longer than the box it drops out of is a list nobody
 * reads to the end of — and an empty prefix on a two-hundred-page wiki is the
 * ordinary way that happens.
 */
export function completionsFor(
  completion: Completion,
  known: { slugs: readonly string[]; sourceIds: readonly string[] },
  limit = 8,
): string[] {
  const pool = completion.kind === "page" ? known.slugs : known.sourceIds;
  const needle = completion.prefix.toLowerCase();
  const matched = pool.filter((candidate) => candidate.toLowerCase().includes(needle));
  return [...matched]
    .sort((a, b) => {
      const byStart =
        Number(b.toLowerCase().startsWith(needle)) - Number(a.toLowerCase().startsWith(needle));
      return byStart !== 0 ? byStart : a.localeCompare(b, undefined, { sensitivity: "base" });
    })
    .slice(0, limit);
}

/**
 * The buffer and the caret after a candidate is taken.
 *
 * Each kind is closed the way its syntax closes: a wikilink gets its `]]`, and a
 * citation gets the `#` that starts the fragment — which is also what stops this
 * from suggesting again on the next keystroke, since a `#` ends the id.
 *
 * A closer already sitting after the caret is not doubled. Completing inside an
 * existing `[[fen]]` is the ordinary way somebody fixes a link they got wrong,
 * and `[[fenix]]]]` is not a link.
 */
export function applyCompletion(
  text: string,
  completion: Completion,
  choice: string,
): { text: string; caret: number } {
  const rest = text.slice(completion.caret);
  const closer = completion.kind === "page" ? "]]" : "#";
  const alreadyClosed = rest.startsWith(closer);
  const inserted = choice + (alreadyClosed ? "" : closer);
  return {
    text: text.slice(0, completion.at) + inserted + rest,
    caret: completion.at + inserted.length + (alreadyClosed ? closer.length : 0),
  };
}
