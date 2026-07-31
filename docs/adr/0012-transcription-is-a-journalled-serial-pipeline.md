---
status: accepted
---

# 0012 · Transcription is journalled, serial, and resumable

## Context

Transcribing an hour of meeting is the one operation in this product that costs money, takes
real time, and can be interrupted halfway. The application gets closed, the machine sleeps,
the provider returns 429, the network drops between chunk four and chunk five.

`adr:0006-opus-as-the-provenance-format` already named the sharp edge: the WAV is ~690 MB
and gets deleted once transcription succeeds, and *"the deletion runs at exactly the point in
the flow that can be interrupted"*. It said what must not happen. It did not say what holds
the state that makes the ordering safe.

Nothing did. Source state was modelled at the level of the whole source — received, text
ready, cited — and per-chunk retry existed only for the duration of one run, in memory. So
an application closed at chunk five either lost four chunks that were already paid for, or
kept a half-written result nobody could tell apart from a finished one.

## Decision

**Every chunk's result is written to a journal on disk the moment it succeeds, before the
next chunk starts.** The journal lives in the recording's own directory, beside the audio it
describes, so an interrupted recording is one directory a person can inspect or delete.

It records, per chunk: its boundaries in the compressed audio, its state, the text when it
succeeded, and the error when it did not. It also records the chunk boundaries as a whole,
the provider and the model — see the refusal below.

**Chunks are transcribed one at a time.** This replaces transcribing them in parallel, and
the reason is that neither provider gains from it. Groq runs at roughly 228x real time, so a
ten-minute chunk returns in about three seconds and an hour of meeting finishes in under
twenty seconds either way; parallelism there buys seconds and multiplies the rate-limit
errors that produce the retries this record exists to survive. whisper.cpp already saturates
every core on one chunk, so running two at once makes both slower. Serial also makes the
journal trivially correct: there is one in-flight chunk, and it is either written or it is
not.

**Resuming is the default, restarting is the exception.** Opening a recording with a journal
shows what is left, not a fresh run. Only chunks marked failed or never attempted are sent.

**A journal is refused when it does not describe the same work.** If the chunk boundaries,
the provider or the model differ from what the journal recorded, resuming would stitch text
from two different segmentations into one timeline — which produces a plausible, readable,
wrong result with correct-looking timestamps. The application says so and offers a clean
restart instead of guessing.

**The output is `timeline.json` and `timeline.vtt`.** The JSON stays the machine-readable
truth that `text.md` renders from and that provenance resolves against. The WebVTT file is
the same content in a format every player and editor already opens, so the user can follow a
recording in VLC with the text beside it and take both away if they stop using this
application. It is derived and regenerable at any time.

**The WAV is deleted only after the journal shows every chunk succeeded and both outputs are
on disk.** This is the ordering `adr:0006-opus-as-the-provenance-format` demanded, now with
something durable to check it against.

## Consequences

An interrupted transcription costs nothing to finish. That is money, on a paid provider, and
it is the difference between an hour of audio that survives a crash and an hour that has to
be recorded again — which is impossible, because the meeting already happened.

The failure the journal converts from silent to visible: a half-transcribed recording is now
a state with a name and a chunk count, rather than a source whose `text.md` merely looks
short.

Costs worth stating:

**Immutability now has a start time.** A source in `raw/` is immutable *once sealed*, and a
recording is not sealed until transcription completes. Until then its directory holds a
journal and a WAV that both disappear on completion. Anything that treats everything under
`raw/` as frozen is wrong about the window where it is not.

**The text lives in two places until the source seals** — the journal and, at the end, the
timeline. That is the point rather than a defect, but it means only the timeline may ever be
read by anything downstream. A consumer that learns to read the journal has coupled itself to
a temporary file.

**`timeline.vtt` is a second representation of one truth**, and two representations disagree
eventually. It is written from the timeline and never edited, and if the two ever differ the
timeline wins and the VTT is regenerated. Nothing in the product reads it back.

**A journal from an interrupted run is litter if the user never returns.** A recording left
at chunk four keeps its WAV, and the WAV is the 690 MB this whole area is about. Surfacing a
stalled recording is not cosmetic — it is what stops twenty abandoned runs from filling a
disk.
