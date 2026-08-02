import type { SourceKind } from "@open-wiki/access";

/**
 * Where a source opens when nobody named an instant (plan 6.5, 5.1).
 *
 * `0:00` is the anchor `text.md` writes for the first passage of a recording
 * (4.13), and `p1` the one `pdf.ts` writes for a first page — so both go
 * through `locateCitation` as an ordinary citation would. A fragment of the
 * wrong shape resolves to nothing while reading perfectly reasonably, which is
 * why this is one function and not the same ternary in two processes.
 */
export function startFragment(kind: SourceKind | null): string {
  return kind === "recording" ? "0:00" : "p1";
}
