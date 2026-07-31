---
status: accepted
---

# 0006 · Opus 24 kbps as the provenance format, and the WAV discarded

## Context

An hour of meeting in 48 kHz stereo WAV takes ~691 MB; twenty meetings fill 14 GB. And
transcription providers cap the upload at 25 MB, which no lossless encoding reaches for an
hour:

| Format | Size | Fits in 25 MB? |
|---|---|---|
| WAV 48 kHz stereo | 691 MB | no |
| WAV 16 kHz mono | 115 MB | no |
| FLAC 16 kHz mono | ~60 MB | no |
| Opus 24 kbps mono | ~11 MB | yes |

At the same time, every provenance link of a claim that came from audio points at an
instant of the recording. If the audio does not survive, the link lies.

## Decision

Opus 24 kbps mono is the permanent file format in `raw/`. The WAV is intermediate and is
discarded as soon as transcription confirms success.

## Consequences

The upload fits under the limit, and twenty meetings take ~220 MB instead of 14 GB.
Provenance keeps working because the Opus is what remains.

The loss is irreversible: at 24 kbps mono there is no going back and re-transcribing with a
model that would demand more fidelity. We accept it because speech at 16 kHz mono is what
transcription models consume anyway — the discarded information is not information the
transcription would use.

**Ordering is the most dangerous seam in this decision.** Deleting the WAV before the
success confirmation loses the whole recording, and the deletion runs at exactly the point
in the flow that can be interrupted — application closed, machine shut down, transcription
that failed on one chunk and stopped halfway.

One consequence that pays off later: because both tracks stay separate and immutable in
`raw/`, a recording can be re-transcribed with a better provider or better speaker
attribution, and the pages rewritten from the new text. What does not exist is automatic
reconstruction of the wiki — see `adr:0003-mcp-as-the-only-bridge-to-the-llm`.
