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
  const end = Math.max(entry.compressedEndNs, entry.compressedStartNs + MINIMUM_CUE_NS);
  return Math.min(end, timeline.compressedDurationNs || end);
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
 * A cue's text cannot contain a blank line — that is what ends a cue — and
 * `-->` inside one would read as a second timing line. Neither can come out of
 * a speech model, but both can come out of a hand-edited timeline, and a VTT
 * that silently splits one passage into two is worse than one that keeps a
 * literal arrow.
 */
function escapeCue(text: string): string {
  return text.replace(/\r?\n\s*\r?\n/g, "\n").replace(/-->/g, "→");
}
