---
autonomy: auto
ci: wait
---

# Audio input selection — requirements

## Purpose

The recorder captures the **default** microphone and the **default** render endpoint,
and nothing anywhere can change that: `WasapiSource::open` takes a direction and asks
Windows for the default (`crates/recorder/src/wasapi_source.rs:161`), `start` over
JSON-RPC carries no device, `channels.ts` exposes no device call, and the
`RecorderClient.devices()` that already exists (`apps/desktop/src/main/recorder.ts:221`)
is reachable from nothing.

For anyone whose meeting microphone is not their Windows default — a headset that
arrives second, a USB interface, a machine with a webcam microphone Windows prefers —
the product records the wrong thing and says nothing about it. This settles which
device is captured, and how that interacts with the device-following that 4.2 already
built.

**The conflict this exists to resolve.** 4.2 is written entirely around _following the
default_: when the default endpoint moves, the stream reopens on the new one and the
event is noted in `device_changes`. That is correct when nobody chose anything, and it
is wrong the moment somebody did — a chosen device silently replaced mid-meeting is the
same class of failure as recording the wrong one, arrived at more confusingly. Pinned
and default are therefore different modes, and saying so is most of this spec.

## R1 · Choosing

- **R1.1** The recorder shall enumerate the capture and render endpoints available on
  the machine, each with a stable identifier, a display name, its direction, and
  whether it is currently the Windows default.
- **R1.2** The application shall let the user choose, independently, which capture
  endpoint records the microphone track and which render endpoint is captured by
  loopback.
- **R1.3** Where no choice has been made, the recorder shall capture the Windows
  default for each direction.
- **R1.4** The application shall present the choice before capture starts, and shall
  not require the user to open settings to reach it.
- **R1.5** The chosen endpoints shall be held in the project settings of 2.7, which
  carry no local path — so an endpoint is recorded by an identifier that means nothing
  outside this machine, or it is not recorded there at all.

## R2 · Following, and not following

- **R2.1** While a track follows the default, when that default changes, the recorder shall reopen
  the track on the new endpoint and record the change in `device_changes`.
- **R2.2** While a track is pinned, when the Windows default changes, the recorder shall keep
  capturing the pinned endpoint.
- **R2.3** If a pinned endpoint is lost during capture, then the recorder shall record the loss,
  continue the session with manufactured silence on that track, and report it — never falling back
  to another endpoint, which would put a different room in the recording under the same name.
- **R2.4** If a pinned endpoint is missing when capture is requested, then the application shall refuse
  to start and shall name the missing endpoint, rather than recording the default in its place.

## R3 · Saying what is being captured

- **R3.1** While recording, the application shall show which endpoint each track is
  capturing.
- **R3.2** When a track's endpoint changes during capture, the application shall show
  that it changed and which endpoint it moved to.
- **R3.3** The manifest shall carry, for each track, the endpoint captured and whether
  it was pinned or default.

## R4 · Showing that audio is arriving

Choosing an endpoint is worth nothing without evidence the choice was right, and this
is the only evidence available while it still matters. It is also the one instrument
that answers group 4's standing gap: nothing in CI has ever captured a frame, and the
two defects found there — a loopback stream opened as `(Render, Render)`, and capture
started twice — both present as a track that is simply dead.

- **R4.1** While recording, the application shall show the signal level currently being captured,
  separately for the microphone track and the system track.
- **R4.2** While recording, the application shall show the level continuously enough to read speech
  as it happens, rather than as an average over the session.
- **R4.3** If one track captures only silence while the other does not, then the application shall report
  that track as receiving nothing.
- **R4.4** The level shall be derived from the frames the recorder has already captured, and shall
  not open a second stream on the endpoint.

## Out of scope

- Per-endpoint gain, and monitoring the captured audio through a speaker. Reading the
  level is evidence; changing or replaying the signal is a different feature.
- A waveform of the whole session while it records. `design/desktop-draft.html` argues
  a waveform earns its keep when following a citation, and nothing here disagrees —
  R4.1 is an instantaneous level, not a drawn history.
- Choosing more than one microphone, or more than one render endpoint. Two tracks is
  the shape `adr:0017-one-compressed-clock-for-both-tracks` and the whole timeline
  depend on.
- Changing an endpoint mid-recording. Pause and stop already exist; a swap under a
  running clock is a different feature with a different risk.
