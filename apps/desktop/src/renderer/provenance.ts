import { formatInstant } from "@open-wiki/audio/timemap";
import type { SourceLocation } from "../main/sources.js";

/**
 * The provenance viewer's arithmetic (desktop-ui 5.4).
 *
 * **This is the time map's last mile, and it is `(TDD)` for that reason.** 8.6
 * seeks to an instant; a mistake here points a citation at the wrong moment
 * while reading perfectly — the code runs, the tests pass, and the damage shows
 * up in somebody's wiki months later, as a link that opens the wrong sentence.
 *
 * Nothing here defines a time format. `formatInstant` in
 * `@open-wiki/audio/timemap` is the single authority — the same one
 * `store/provenance.ts` validates against and `text.md`'s headings are written
 * with — because two definitions of a time format disagree at exactly the
 * values that matter. This module imports it rather than carrying a second
 * `padStart`.
 */

/** The clock everything in `timemap` is denominated in. */
const NS_PER_SECOND = 1_000_000_000;

/**
 * The citation for what the viewer is currently showing (5.4).
 *
 * **What is copied has to parse back to where it was copied from.**
 * `store/provenance.ts` validates a citation through `parseInstant`, and
 * `markdown.ts` renders one through the same shape, so a citation this pane
 * produced and the checks refused would be a citation the reader pasted in
 * good faith and then had to defend.
 *
 * A source that could not be opened has no citation: `rec://weekly#` resolves
 * to nothing, which is precisely what 7.3 exists to report.
 */
export function citationOf(id: string, at: SourceLocation): string | null {
  if (at.kind === "audio") return `rec://${id}#${formatInstant(at.seconds * NS_PER_SECOND)}`;
  if (at.kind === "document") return `src://${id}#p${at.page}`;
  return null;
}

/**
 * Where the playhead sits, as a percentage of the recording.
 *
 * Clamped at both ends. A citation past the end is refused upstream, but 4.6
 * tolerates a map that disagrees with its file by up to a second — and a
 * playhead at 103% is drawn outside the element it belongs to.
 *
 * An unknown duration puts it at the start rather than at a guess: the length
 * comes from the audio element's metadata and is not there until it loads, so
 * a guess would visibly jump the moment the real answer arrived.
 */
export function playheadPercent(seconds: number, durationSeconds: number | null): number {
  if (durationSeconds === null || durationSeconds <= 0) return 0;
  return Math.min(100, Math.max(0, (seconds / durationSeconds) * 100));
}

/** What the transport says: where you are, and how long this runs for. */
export function transportLabel(atSeconds: number, durationSeconds: number | null): string {
  const at = formatInstant(atSeconds * NS_PER_SECOND);
  if (durationSeconds === null || durationSeconds <= 0) return at;
  return `${at} of ${formatInstant(durationSeconds * NS_PER_SECOND)}`;
}
