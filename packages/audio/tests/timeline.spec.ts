import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { finishRecording } from "../src/finish.js";
import type { Journal, JournalChunk } from "../src/journal.js";
import { renderRecordingText, turnsOf } from "../src/recording-text.js";
import { sealRecording } from "../src/seal.js";
import { buildTimeline, speakerOf, type Timeline } from "../src/timeline.js";
import type { TimeMap } from "../src/timemap.js";
import { renderVtt, vttTime } from "../src/vtt.js";

const SECOND = 1_000_000_000;
const s = (n: number): number => n * SECOND;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ow-timeline-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** 30 s of recording, one unbroken stretch from wall 1_000_000 ms. */
const map: TimeMap = {
  version: 1,
  compressedDurationNs: s(30),
  segments: [
    { compressedStartNs: 0, durationNs: s(30), recordedStartNs: 0, wallStartMs: 1_000_000 },
  ],
  chunks: [{ index: 0, compressedStartNs: 0, compressedEndNs: s(30) }],
};

function chunk(over: Partial<JournalChunk>): JournalChunk {
  return {
    index: 0,
    track: "mic",
    compressedStartNs: 0,
    compressedEndNs: s(30),
    done: true,
    segments: [],
    ...over,
  };
}

function journal(chunks: JournalChunk[]): Journal {
  return { version: 1, provider: "groq", model: "m", language: "en", chunks };
}

describe("speakerOf (4.12)", () => {
  it("labels the microphone me and the loopback remote", () => {
    // From the track and from nothing else. There is no diarisation here: the
    // microphone is the person at this machine and the loopback is everybody
    // else, which is a fact about where the audio came from.
    expect(speakerOf("mic")).toBe("me");
    expect(speakerOf("system")).toBe("remote");
  });
});

describe("buildTimeline (4.12)", () => {
  it("merges both tracks into one sequence ordered by real time", () => {
    const timeline = buildTimeline(
      journal([
        chunk({
          index: 0,
          track: "mic",
          segments: [
            { startNs: 0, endNs: s(2), text: "morning" },
            { startNs: s(10), endNs: s(12), text: "agreed" },
          ],
        }),
        chunk({
          index: 1,
          track: "system",
          segments: [{ startNs: s(5), endNs: s(7), text: "morning to you" }],
        }),
      ]),
      map,
    );
    expect(timeline.entries.map((e) => e.text)).toEqual(["morning", "morning to you", "agreed"]);
    expect(timeline.entries.map((e) => e.speaker)).toEqual(["me", "remote", "me"]);
  });

  it("carries the absolute instant of each passage", () => {
    const timeline = buildTimeline(
      journal([chunk({ segments: [{ startNs: s(5), endNs: s(6), text: "hello" }] })]),
      map,
    );
    expect(timeline.entries[0]!.wallStartMs).toBe(1_005_000);
  });

  it("carries the recording's length, which the VTT and the checks need", () => {
    expect(buildTimeline(journal([]), map).compressedDurationNs).toBe(s(30));
  });

  it("leaves a hole where a chunk has not been transcribed", () => {
    // The honest rendering: the source is not sealed, and 4.14 will not
    // discard its WAV. Inventing a placeholder would make it look finished.
    const timeline = buildTimeline(
      journal([
        chunk({ index: 0, segments: [{ startNs: 0, endNs: s(1), text: "here" }] }),
        chunk({ index: 1, track: "system", done: false, segments: undefined }),
      ]),
      map,
    );
    expect(timeline.entries).toHaveLength(1);
  });

  it("is stable across builds", () => {
    // A timeline that reshuffles between runs is a diff nobody can read.
    const j = journal([
      chunk({ index: 0, track: "mic", segments: [{ startNs: 0, endNs: s(1), text: "a" }] }),
      chunk({ index: 1, track: "system", segments: [{ startNs: 0, endNs: s(1), text: "b" }] }),
    ]);
    expect(buildTimeline(j, map)).toEqual(buildTimeline(j, map));
  });

  it("is empty for a recording nobody spoke in", () => {
    expect(buildTimeline(journal([]), map).entries).toEqual([]);
  });
});

describe("renderRecordingText (4.13)", () => {
  const timeline: Timeline = {
    version: 1,
    compressedDurationNs: s(30),
    entries: [
      {
        speaker: "me",
        compressedStartNs: s(872),
        compressedEndNs: s(874),
        wallStartMs: 1,
        text: "we should cut over on Friday",
      },
      {
        speaker: "remote",
        compressedStartNs: s(875),
        compressedEndNs: s(877),
        wallStartMs: 2,
        text: "Friday works",
      },
    ],
  };

  it("anchors each passage at its instant, in the form a citation carries", () => {
    // `rec://<id>#14:32` points at this heading and at a moment in the Opus at
    // once. `pdf.ts` writes `## p12` for a page; this is the same rule.
    const text = renderRecordingText(timeline, { title: "Fenix weekly" });
    expect(text).toContain("## 14:32");
    expect(text).toContain("## 14:35");
  });

  it("leads with the recording's readable title", () => {
    expect(renderRecordingText(timeline, { title: "Fenix weekly" })).toMatch(/^# Fenix weekly/);
  });

  it("names the speaker of each passage", () => {
    const text = renderRecordingText(timeline, { title: "t" });
    expect(text).toContain("**me** — we should cut over on Friday");
    expect(text).toContain("**remote** — Friday works");
  });

  it("ends with exactly one newline", () => {
    expect(renderRecordingText(timeline, { title: "t" }).endsWith("\n")).toBe(true);
    expect(renderRecordingText(timeline, { title: "t" }).endsWith("\n\n")).toBe(false);
  });

  it("is just a title for a recording with nothing in it", () => {
    const empty = { ...timeline, entries: [] };
    expect(renderRecordingText(empty, { title: "Silence" })).toBe("# Silence\n");
  });
});

describe("turnsOf", () => {
  it("joins consecutive passages from one speaker into one turn", () => {
    // An hour of meeting is several hundred segments. A heading every four
    // seconds is a file nobody reads and a hundred anchors nobody cites.
    const turns = turnsOf([
      { speaker: "me", compressedStartNs: 0, compressedEndNs: 1, wallStartMs: 0, text: "one" },
      { speaker: "me", compressedStartNs: 2, compressedEndNs: 3, wallStartMs: 0, text: "two" },
      {
        speaker: "remote",
        compressedStartNs: 4,
        compressedEndNs: 5,
        wallStartMs: 0,
        text: "three",
      },
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.texts).toEqual(["one", "two"]);
  });

  it("anchors a turn at the first passage in it", () => {
    const turns = turnsOf([
      { speaker: "me", compressedStartNs: s(5), compressedEndNs: 1, wallStartMs: 0, text: "one" },
      { speaker: "me", compressedStartNs: s(9), compressedEndNs: 1, wallStartMs: 0, text: "two" },
    ]);
    expect(turns[0]!.startNs).toBe(s(5));
  });

  it("drops a passage with nothing in it without breaking the turn", () => {
    const turns = turnsOf([
      { speaker: "me", compressedStartNs: 0, compressedEndNs: 1, wallStartMs: 0, text: "one" },
      { speaker: "me", compressedStartNs: 2, compressedEndNs: 3, wallStartMs: 0, text: "  " },
      { speaker: "me", compressedStartNs: 4, compressedEndNs: 5, wallStartMs: 0, text: "two" },
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.texts).toEqual(["one", "two"]);
  });
});

describe("vttTime (4.18)", () => {
  it("writes the form WebVTT accepts past an hour", () => {
    expect(vttTime(s(3661) + 250_000_000)).toBe("01:01:01.250");
  });

  it("pads every field", () => {
    expect(vttTime(0)).toBe("00:00:00.000");
    expect(vttTime(s(5))).toBe("00:00:05.000");
  });

  it("never writes a negative time", () => {
    expect(vttTime(-1)).toBe("00:00:00.000");
  });
});

describe("renderVtt (4.18)", () => {
  const timeline: Timeline = {
    version: 1,
    compressedDurationNs: s(30),
    entries: [
      {
        speaker: "me",
        compressedStartNs: s(1),
        compressedEndNs: s(3),
        wallStartMs: 1,
        text: "morning",
      },
      {
        speaker: "remote",
        compressedStartNs: s(4),
        compressedEndNs: s(6),
        wallStartMs: 2,
        text: "morning to you",
      },
    ],
  };

  it("opens with the header every player looks for", () => {
    expect(renderVtt(timeline).startsWith("WEBVTT\n")).toBe(true);
  });

  it("times the cues on the Opus clock, which is the file a player has open", () => {
    expect(renderVtt(timeline)).toContain("00:00:01.000 --> 00:00:03.000");
  });

  it("attributes each cue to the timeline's own speaker label", () => {
    // What a viewer sees matches what a page citing this recording says.
    expect(renderVtt(timeline)).toContain("<v me>morning");
    expect(renderVtt(timeline)).toContain("<v remote>morning to you");
  });

  it("numbers the cues from one", () => {
    const lines = renderVtt(timeline).split("\n");
    expect(lines[2]).toBe("1");
  });

  it("gives a zero-length passage a cue long enough to be visible", () => {
    const instant: Timeline = {
      ...timeline,
      entries: [
        {
          speaker: "me",
          compressedStartNs: s(1),
          compressedEndNs: s(1),
          wallStartMs: 1,
          text: "hm",
        },
      ],
    };
    expect(renderVtt(instant)).toContain("00:00:01.000 --> 00:00:02.000");
  });

  it("keeps a cue from running past the end of the recording", () => {
    const late: Timeline = {
      ...timeline,
      compressedDurationNs: s(30),
      entries: [
        {
          speaker: "me",
          compressedStartNs: s(30),
          compressedEndNs: s(30),
          wallStartMs: 1,
          text: "last",
        },
      ],
    };
    expect(renderVtt(late)).toContain("00:00:30.000 --> 00:00:30.000");
  });

  it("does not let a passage's text end its own cue", () => {
    // A blank line ends a cue and `-->` reads as a timing line. Neither comes
    // out of a speech model; both come out of a hand-edited timeline, and a
    // VTT that silently splits one passage into two is worse.
    const hostile: Timeline = {
      ...timeline,
      entries: [
        {
          speaker: "me",
          compressedStartNs: 0,
          compressedEndNs: s(1),
          wallStartMs: 1,
          text: "one\n\n00:00:00.000 --> 00:00:01.000\ntwo",
        },
      ],
    };
    const vtt = renderVtt(hostile);
    expect(vtt.split("-->").length - 1).toBe(1);
  });

  it("is a valid empty file for a recording with nothing in it", () => {
    expect(renderVtt({ ...timeline, entries: [] })).toBe("WEBVTT\n");
  });
});

describe("sealRecording (4.14)", () => {
  function outputs(): void {
    for (const file of ["timeline.json", "timeline.vtt", "text.md"]) {
      writeFileSync(join(dir, file), "x", "utf8");
    }
  }

  function wavs(): void {
    writeFileSync(join(dir, "mic.wav"), "x");
    writeFileSync(join(dir, "system.wav"), "x");
  }

  const complete = journal([
    chunk({ index: 0, done: true }),
    chunk({ index: 1, track: "system", done: true }),
  ]);

  it("discards the WAV once every chunk succeeded and every output landed", () => {
    outputs();
    wavs();
    const result = sealRecording(dir, complete);
    expect(result.sealed).toBe(true);
    expect(existsSync(join(dir, "mic.wav"))).toBe(false);
    expect(existsSync(join(dir, "system.wav"))).toBe(false);
  });

  it("keeps the Opus, which is what provenance opens", () => {
    outputs();
    wavs();
    writeFileSync(join(dir, "mic.opus"), "x");
    sealRecording(dir, complete);
    expect(existsSync(join(dir, "mic.opus"))).toBe(true);
  });

  it("refuses while a chunk is still untranscribed, and says how far it got", () => {
    // Deleting early loses a meeting that already happened and cannot be
    // recorded again.
    outputs();
    wavs();
    const partial = journal([chunk({ index: 0, done: true }), chunk({ index: 1, done: false })]);
    const result = sealRecording(dir, partial);
    expect(result.sealed).toBe(false);
    expect(result.sealed === false && result.reason).toContain("1 of 2");
    expect(existsSync(join(dir, "mic.wav"))).toBe(true);
  });

  it("refuses while an output is missing, naming it", () => {
    writeFileSync(join(dir, "timeline.json"), "x", "utf8");
    wavs();
    const result = sealRecording(dir, complete);
    expect(result.sealed).toBe(false);
    expect(result.sealed === false && result.reason).toContain("timeline.vtt");
    expect(existsSync(join(dir, "mic.wav"))).toBe(true);
  });

  it("removes the journal, so nothing downstream learns to read the copy", () => {
    outputs();
    writeFileSync(join(dir, "journal.json"), "{}", "utf8");
    sealRecording(dir, complete);
    expect(existsSync(join(dir, "journal.json"))).toBe(false);
  });

  it("keeps the WAV when the project asked it to, and still seals", () => {
    outputs();
    wavs();
    const result = sealRecording(dir, complete, { deleteWav: false });
    expect(result.sealed).toBe(true);
    expect(existsSync(join(dir, "mic.wav"))).toBe(true);
  });

  it("does not delete a directory that happens to be named like a track", () => {
    outputs();
    mkdirSync(join(dir, "notes.wav"));
    sealRecording(dir, complete);
    expect(existsSync(join(dir, "notes.wav"))).toBe(true);
  });
});

describe("finishRecording", () => {
  const complete = journal([
    chunk({
      index: 0,
      track: "mic",
      done: true,
      segments: [{ startNs: s(1), endNs: s(2), text: "morning" }],
    }),
    chunk({
      index: 1,
      track: "system",
      done: true,
      segments: [{ startNs: s(3), endNs: s(4), text: "morning to you" }],
    }),
  ]);

  it("writes all three outputs and then discards the WAV", () => {
    writeFileSync(join(dir, "mic.wav"), "x");
    const result = finishRecording(dir, complete, map, { title: "Fenix weekly" });
    expect(existsSync(join(dir, "timeline.json"))).toBe(true);
    expect(existsSync(join(dir, "timeline.vtt"))).toBe(true);
    expect(existsSync(join(dir, "text.md"))).toBe(true);
    expect(result.seal.sealed).toBe(true);
    expect(existsSync(join(dir, "mic.wav"))).toBe(false);
  });

  it("writes a text.md whose anchors resolve into the timeline", () => {
    finishRecording(dir, complete, map, { title: "Fenix weekly" });
    const text = readFileSync(join(dir, "text.md"), "utf8");
    const timeline = JSON.parse(readFileSync(join(dir, "timeline.json"), "utf8")) as Timeline;
    for (const entry of timeline.entries) {
      const instant = Math.floor(entry.compressedStartNs / SECOND);
      expect(text).toContain(
        `## ${Math.floor(instant / 60)}:${String(instant % 60).padStart(2, "0")}`,
      );
    }
  });

  it("keeps the WAV when the journal is not complete, having written the outputs anyway", () => {
    // A part-done recording still gets a readable timeline — that is what makes
    // "what is missing" visible on the sources screen.
    writeFileSync(join(dir, "mic.wav"), "x");
    const partial = journal([chunk({ index: 0, done: true }), chunk({ index: 1, done: false })]);
    const result = finishRecording(dir, partial, map, { title: "t" });
    expect(existsSync(join(dir, "timeline.json"))).toBe(true);
    expect(result.seal.sealed).toBe(false);
    expect(existsSync(join(dir, "mic.wav"))).toBe(true);
  });

  it("leaves no temporary file behind", () => {
    finishRecording(dir, complete, map, { title: "t" });
    for (const file of ["timeline.json", "timeline.vtt", "text.md"]) {
      expect(existsSync(join(dir, `${file}.tmp`))).toBe(false);
    }
  });
});
