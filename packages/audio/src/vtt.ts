import type { Timeline, TimelineEntry } from "./timeline.js";

/**
 * `timeline.vtt` (plan 4.18) — the same content in a format every player and
 * editor already opens.
 *
 * The point is not a feature. It is that the user can follow a recording in
 * VLC with the text beside it, and **take both away if they stop using this
 * application**. A wiki whose provenance only opens inside one Windows binary
 * is provenance with a hostage in it.
 *
 * `adr:0012-transcription-is-a-journalled-serial-pipeline` is explicit that
 * this is a second representation of one truth, that two representations
 * disagree eventually, and which one wins: the timeline. This is written from
 * it, never edited, and regenerable at any time. Nothing in the product reads
 * it back.
 *
 * The cues are on the *compressed* clock, because that is the clock of the
 * Opus file a player will have open beside it.
 */

const NS_PER_SECOND = 1_000_000_000;

export const VTT_FILE = "timeline.vtt";

export function renderVtt(timeline: Timeline): string {
  const lines: string[] = ["WEBVTT", ""];
  let cue = 0;
  for (const entry of timeline.entries) {
    const text = entry.text.trim();
    if (!text) continue;
    cue += 1;
    lines.push(
      String(cue),
      `${vttTime(entry.compressedStartNs)} --> ${vttTime(endOf(entry, timeline))}`,
      // The voice span is how a player attributes a cue. `me` and `remote` are
      // the timeline's own labels, so what a viewer sees matches what a page
      // citing this recording says.
      `<v ${entry.speaker}>${escapeCue(text)}`,
      "",
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * A cue that ends where it starts is invisible in every player. A passage the
 * provider gave no duration for still happened, so it gets a second — long
 * enough to see, short enough not to overlap what follows.
 */
const MINIMUM_CUE_NS = NS_PER_SECOND;

function endOf(entry: TimelineEntry, timeline: Timeline): number {
  // The recording's length first, then the minimum — the other order lets the
  // clamp undo the minimum and hand back the zero-length cue this exists to
  // prevent, for any passage sitting on the last instant.
  const withinRecording = Math.min(
    Math.max(entry.compressedEndNs, entry.compressedStartNs),
    timeline.compressedDurationNs || Number.MAX_SAFE_INTEGER,
  );
  return Math.max(withinRecording, entry.compressedStartNs + MINIMUM_CUE_NS);
}

/** `HH:MM:SS.mmm`, the only form WebVTT accepts past an hour. */
export function vttTime(ns: number): string {
  const totalMs = Math.max(0, Math.floor(ns / 1_000_000));
  const ms = totalMs % 1000;
  const s = Math.floor(totalMs / 1000) % 60;
  const m = Math.floor(totalMs / 60_000) % 60;
  const h = Math.floor(totalMs / 3_600_000);
  const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

/**
 * A cue's payload is markup, and none of it is trusted — it is a speech
 * model's output, or a `timeline.json` that arrived with a clone. Three things
 * it must not be able to do:
 *
 * - **open or close a span.** `</v><v Alice>` makes a player attribute the
 *   rest of the cue to somebody who never spoke, which defeats the whole point
 *   of the `<v ${speaker}>` line above.
 * - **end its own cue.** A blank line is what ends one, and `\r` alone is a
 *   line terminator in WebVTT — so the blank-line pattern has to cover it and
 *   not only `\n`.
 * - **look like a timing line.** `-->` inside a cue reads as one.
 *
 * Escaping the angle brackets handles the first, and would handle the third on
 * its own; the arrow substitution stays because a cue reading `&#45;&#45;&gt;`
 * is worse to a human than one reading `→`.
 */
function escapeCue(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\r\n][ \t]*[\r\n]+/g, "\n")
    .replace(/-->/g, "→");
}
