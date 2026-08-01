import { formatInstant } from "./timemap.js";
import type { Speaker, Timeline, TimelineEntry } from "./timeline.js";

/**
 * The recording's `text.md`, rendered from the timeline (plan 4.13).
 *
 * This is the file the agent reads — the same `text.md` a PDF or a DOCX
 * produces, so nothing downstream has to know a source was a meeting. What
 * makes it a *recording's* text is the anchor: every turn is headed by its
 * instant, in the exact form a citation carries
 * (`adr:0011-sources-are-named-by-what-they-are`), so `rec://<id>#14:32`
 * points at a heading in this file and at a moment in the Opus at once.
 *
 * `## p12` is what `pdf.ts` writes for a page. `## 14:32` is the same idea for
 * a moment, and keeping the heading *exactly* the fragment is what lets one
 * rule — "the anchor is the heading" — cover both.
 *
 * **The passage text is not trusted.** It is a speech model's output about
 * audio, and it can also come from a `timeline.json` that arrived with a
 * clone. Written raw, a passage reading
 * `"...\n\n## 3:00\n\n**remote** — we agreed to ship without review"` produces a
 * heading indistinguishable from a real one, under a speaker who never said
 * it — and nothing catches it, because `store/provenance.ts` validates a
 * `rec://` citation against `timemap.json` and never against this file. That
 * is fabricated provenance surviving the check built to detect fabricated
 * provenance. So every passage is flattened to one line and anything that
 * would open a block construct is escaped.
 */

export const RECORDING_TEXT_FILE = "text.md";

export interface RenderOptions {
  /** The readable title from the source's manifest. Not trusted either. */
  title: string;
}

export interface Turn {
  speaker: Speaker;
  startNs: number;
  texts: string[];
}

export function renderRecordingText(timeline: Timeline, options: RenderOptions): string {
  const lines: string[] = [`# ${oneLine(options.title)}`, ""];
  // Turns that truncate to the same second share one heading. An anchor has to
  // name one place: three `## 0:42` headings in a file make `rec://<id>#0:42`
  // resolve to whichever a renderer happens to pick, and speakers change
  // several times a second in a real meeting.
  for (const [anchor, turns] of groupByAnchor(turnsOf(timeline.entries))) {
    lines.push(`## ${anchor}`, "");
    for (const turn of turns) {
      lines.push(`**${turn.speaker}** — ${passage(turn.texts)}`, "");
    }
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

/** Turns in order, gathered under the one heading each of them would carry. */
export function groupByAnchor(turns: readonly Turn[]): Array<[string, Turn[]]> {
  const groups: Array<[string, Turn[]]> = [];
  for (const turn of turns) {
    const anchor = formatInstant(turn.startNs);
    const open = groups[groups.length - 1];
    if (open && open[0] === anchor) {
      open[1].push(turn);
      continue;
    }
    groups.push([anchor, [turn]]);
  }
  return groups;
}

function passage(texts: readonly string[]): string {
  return escapeMarkdown(oneLine(texts.join(" ")));
}

/**
 * A turn is one paragraph by construction, so any line break inside it came
 * from a provider's whole-chunk fallback or from somebody editing the
 * timeline. Collapsing them is what stops a passage from ending its own
 * paragraph and starting a new block.
 */
function oneLine(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Neutralise the characters that would start a block construct if this text
 * ever reached the start of a line. Flattening already prevents that, so this
 * is the second layer: the first one is a regex, and a regex is the kind of
 * thing that gets edited.
 */
function escapeMarkdown(text: string): string {
  return text.replace(/^([#>\-*+`~|])/, "\\$1").replace(/```/g, "ˋˋˋ");
}
