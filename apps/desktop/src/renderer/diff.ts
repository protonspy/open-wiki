/**
 * A word-level diff, for the approval card (uxpass 6.3).
 *
 * The approval card showed *Replace* and *With* as two blocks of near-identical
 * prose and asked the reader to spot the difference by eye. That is the whole
 * decision it exists to support: a human-in-the-loop write is only reviewed if
 * reviewing it is cheaper than reading the page twice.
 *
 * Word-level rather than character-level, because the thing being edited is
 * prose. A character diff of *"the cutover window"* against *"the cutover
 * weekend"* marks `w`, `e`, `e`, and leaves the reader assembling words out of
 * highlighted letters.
 */

/** One run of text, and what happened to it. */
export interface DiffSpan {
  kind: "same" | "removed" | "added";
  text: string;
}

/**
 * Above this many tokens on either side the diff is not attempted.
 *
 * The table below is O(n·m) in both time and memory, and `edit_file` may carry a
 * whole page. Past the cap the card falls back to showing both sides whole,
 * which is what it did before this existed — worse, but bounded, and it says so
 * rather than freezing the window.
 */
export const DIFF_LIMIT = 1200;

/** Words and the whitespace between them, so the text can be rebuilt exactly. */
export function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token !== "");
}

/**
 * The two strings as runs of shared, removed and added text.
 *
 * A longest-common-subsequence walk over the word tokens: everything not in the
 * subsequence is what changed. Adjacent runs of one kind are merged, so the
 * result is spans a reader can see rather than a stream of one-word marks.
 *
 * `null` when either side is past {@link DIFF_LIMIT} — the caller shows the two
 * sides whole and says why.
 */
export function wordDiff(before: string, after: string): DiffSpan[] | null {
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length > DIFF_LIMIT || b.length > DIFF_LIMIT) return null;

  // table[i][j] = length of the LCS of a[i…] and b[j…].
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const spans: DiffSpan[] = [];
  const push = (kind: DiffSpan["kind"], text: string): void => {
    const last = spans[spans.length - 1];
    if (last && last.kind === kind) last.text += text;
    else spans.push({ kind, text });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]!);
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      push("removed", a[i]!);
      i += 1;
    } else {
      push("added", b[j]!);
      j += 1;
    }
  }
  while (i < a.length) push("removed", a[i++]!);
  while (j < b.length) push("added", b[j++]!);
  return spans;
}

/** The spans that make up one side of the diff — the old text, or the new. */
export function sideOf(spans: readonly DiffSpan[], side: "before" | "after"): DiffSpan[] {
  const other = side === "before" ? "added" : "removed";
  return spans.filter((span) => span.kind !== other);
}
