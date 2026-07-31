---
status: accepted
---

# 0005 · Direct WASAPI capture, in a sidecar with a minimal contract

## Context

One of the sources is the meeting recording, which requires capturing the microphone and
the system output simultaneously, on separate tracks, for an hour. On Windows there are
three paths: ffmpeg, a virtual audio driver, or WASAPI directly.

ffmpeg on Windows has no native loopback input — only DirectShow. The usual workaround is
to install a virtual device, and that costs two expensive things: it loses the user during
onboarding, and it is blocked by corporate antivirus, which is exactly the environment
where the meetings happen.

Capturing directly requires a language with no GC pause and no runtime to install, which
puts the recorder outside the application's process — and every process boundary is a
question about where the logic lives. The default answer, letting it grow as each task
finds convenient, is how a sidecar turns into a second application.

## Decision

Capture through WASAPI directly, in a standalone Rust binary. ffmpeg stays in the project,
but only downstream — preparing audio that has already been recorded.

The sidecar exposes over stdio JSON-RPC exactly: `start`, `pause`, `resume`, `stop`,
`status`, `devices`. Everything else — preprocessing, transcription, writing, MCP server —
lives on the JavaScript side.

## Consequences

Nothing to install beyond the application, and nothing an antivirus recognises as a driver.
In exchange, the project takes on the capture code and with it four problems WASAPI throws
in for free, none of which shows up in a five-minute test:

- loopback returns no frames while nobody is playing sound, so silence has to be
  manufactured or the track freezes;
- the default device can change mid-meeting and kill the stream silently;
- the two tracks drift apart if the alignment is not imposed by a clock of our own;
- the pause is a capture pause, not a UI one — both tracks have to stop and resume at the
  same instant, and the paused stretch has to leave both as one block.

The boundary is small enough to be tested end to end: start the binary, send JSON, check
the response.

This will hurt at some point. A need will come up — a live level meter, silence detection
during recording — for which the data is already on the Rust side and sending it across the
boundary looks wasteful. The rule is to resist: a new method deserves an ADR that
supersedes this one, not one more line in an enum.

The corollary is that the recorder knows nothing about the workspace, about transcription,
or about the MCP server. It records and writes files.
