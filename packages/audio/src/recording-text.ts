import { formatInstant } from "./timemap.js";
import type { Speaker, Timeline, TimelineEntry } from "./timeline.js";

/**
 * The recording's `text.md`, rendered from the timeline (plan 4.13).
 *
 * This is the file the agent reads — the same `text.md` a PDF or a DOCX
 * produces, so nothing downstream has to know a source was a meeting. What
 * makes it a *recording's* text is the anchor: every passage is headed by its
 * instant, in the exact form a citation carries
 * (`adr:0011-sources-are-named-by-what-they-are`), so `rec://<id>#14:32`
 * points at a heading in this file and at a moment in the Opus at once.
 *
 * `## p12` is what `pdf.ts` writes for a page. `## 14:32` is the same idea for
 * a moment, and keeping the heading *exactly* the fragment is what lets one
 * rule — "the anchor is the heading" — cover both.
 *
 * Consecutive passages from one speaker are joined. An hour of meeting is
 * several hundred segments, and a heading every four seconds is a file nobody
 * reads and a hundred anchors nobody cites; a heading per turn is the unit a
 * person would quote anyway.
 */

export const RECORDING_TEXT_FILE = "text.md";

export interface RenderOptions {
  /** The readable title from the source's manifest. */
  title: string;
}

interface Turn {
  speaker: Speaker;
  startNs: number;
  texts: string[];
}

export function renderRecordingText(timeline: Timeline, options: RenderOptions): string {
  const lines: string[] = [`# ${options.title}`, ""];
  for (const turn of turnsOf(timeline.entries)) {
    lines.push(`## ${formatInstant(turn.startNs)}`, "");
    lines.push(`**${turn.speaker}** — ${turn.texts.join(" ")}`, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** Consecutive entries from one speaker, anchored at the first one's instant. */
export function turnsOf(entries: readonly TimelineEntry[]): Turn[] {
  const turns: Turn[] = [];
  for (const entry of entries) {
    const text = entry.text.trim();
    if (!text) continue;
    const open = turns[turns.length - 1];
    if (open && open.speaker === entry.speaker) {
      open.texts.push(text);
      continue;
    }
    turns.push({ speaker: entry.speaker, startNs: entry.compressedStartNs, texts: [text] });
  }
  return turns;
}
