---
status: accepted
---

# 0017 · One compressed clock for both tracks

## Context

A recording arrives as two WAV tracks — the microphone and the WASAPI loopback — aligned by
the QPC clock and held aligned across pauses and device changes (plan 4.1 to 4.3). Before
transcription they are downmixed, stripped of silence and encoded to Opus 24 kbps
(`adr:0006-opus-as-the-provenance-format`), and the Opus is what survives: the WAV is
discarded once transcription confirms.

So the clock a provenance citation names is the *Opus* file's, not the capture's.
`rec://fenix-weekly-2026-07-31#14:32` is fourteen minutes and thirty-two seconds into a
file that has had its silence removed — the position a player's scrubber shows
(`adr:0011-sources-are-named-by-what-they-are`).

Removing silence per track is the obvious implementation. Each track is probed on its own,
each drops its own silent stretches, each comes out as small as it can be. It is also
wrong, and the way it is wrong is invisible until somebody follows a citation: the two
files come out different lengths, so `14:32` is a different moment in `mic.opus` than in
`system.opus`, and a citation would have to name a track as well as an instant. Everything
4.1 and 4.3 do to keep the tracks aligned would be undone at the last step before the
alignment was used.

## Decision

**Silence is cut only where every track is silent, and both tracks are encoded with the
same cut list.** One compressed clock, shared; one instant means one moment.

The consequence for the map is that the recording's `timemap.json` composes two removals
rather than one: the pauses the recorder already took out of wall time, and the silence
this step takes out of recorded time. A kept stretch is split wherever the recorder paused,
because recorded time runs unbroken across a pause and wall time jumps by its whole length.

**Chunk boundaries fall at the joins between kept stretches** — places where at least
800 ms was removed, so nobody was speaking across them.

**Durations are nanoseconds; wall-clock instants are milliseconds since the epoch.**
Nanoseconds since the epoch is about 1.75e18 and JavaScript integers are exact only to
9.007e15, so wall time in nanoseconds is already lossy on the way in and would accumulate
error on every operation after that.

## Consequences

A citation names one instant and needs no track. `timemap.json` answers "where in real time
did this happen" for any instant of either file, and 5.4's in-range check — dormant since it
was written, waiting for this format — is live: a citation past the end of a recording is
refused, naming how long the recording runs.

The costs:

**The files are bigger than they need to be.** A stretch where only the remote party speaks
keeps a silent microphone track beside it. At 24 kbps silence is nearly free, and the
alternative is provenance that cannot be stated in one number.

**Less silence is removed overall**, because both tracks have to agree. A meeting where the
two parties alternate cleanly compresses barely at all. This is the same trade seen from
the other side and it is accepted for the same reason.

**A chunk boundary can still land mid-speech.** Twenty minutes without an 800 ms gap is a
real recording — a presentation, a long answer — and there is no silence to put a boundary
at. The chunk is split at the maximum length anyway, because refusing to transcribe it
would be worse than one seam in the timeline.

**Re-encoding a recording invalidates its citations.** The compressed clock is a function
of the cut list, so a future change to the silence threshold moves every instant in a
recording that gets re-encoded. Nothing re-encodes today, and anything that does has to
rewrite the citations or leave the existing Opus alone.
