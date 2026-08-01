# Audio input selection — design

## What changes

Serves R1.1, R1.2, R1.3, R1.5, R2.1, R2.2, R3.3, R4.1, R4.2, R4.4.

`WasapiSource::open(which, …)` asks Windows for the default endpoint of a direction and
has no other mode. The change is one optional identifier threaded down from the
settings, and one flag beside it that says whether this track **follows** or is
**pinned** — because those are two behaviours and the existing code only has the first.

Everything above the capture layer already has a shape to carry it: `start` gains an
endpoint per track, `devices` gains fields it should always have had, and `status`
gains the level. Nothing new is invented at the protocol level.

The level is computed where the frames already are. `SessionPump` sees every buffer on
its way to the WAV writer, so a peak-and-RMS over a short window is arithmetic on data
in hand — no second stream, no second consumer of the endpoint (R4.4). This is the
correction to the reasoning that originally put metering out of scope: the cost that
justified excluding it does not exist.

## Boundaries and contracts

Two boundaries move, and both are the sidecar's line protocol (4.5):

- **`devices`** returns objects rather than names: identifier, display name, direction,
  and whether it is currently the Windows default. `RecorderClient.devices()` today
  flattens whatever arrives into `string[]`, which is why nothing above it could offer
  a choice.
- **`start`** takes an endpoint per track, either an identifier or "follow the
  default". Absent, both follow — which keeps every existing caller correct.
- **`status`** carries a per-track level. It rides the poll that already exists rather
  than becoming a server-to-client notification stream, so the protocol stays
  request/response.

The rule the status poll already lives under does not relax: **polling must never start
the sidecar.** `recorder.exe` opens both WASAPI devices at launch, so a lazy `session ??=`
behind a poll holds the microphone from the moment a window opens. `ensure` and `peek`
stay different methods and only `record:start` reaches `ensure`.

## Data

`manifest.json` gains, per track, the endpoint captured and whether it was pinned or
default (R3.3). It is written once at the end like everything else in it.

The chosen endpoints live in the project settings of 2.7, whose schema is closed and
carries no local path. A WASAPI endpoint identifier is machine-local by nature, so
committing one means committing something meaningless to everyone else — the setting is
stored as a choice that may fail to resolve, and an unresolvable identifier is a choice
to re-make rather than an error to keep (R1.5).

## Alternatives considered

**A notification stream for the level, instead of extending `status`.** Push is the
better shape for a value that changes 20 times a second, and it costs a second framing
mode on a line protocol that has exactly one. The poll is already there, already
tested, and already governed by the `peek`/`ensure` rule. Push wins only if polling
proves visibly laggy, and that is a change confined to one method.

**Falling back to the default when a pinned endpoint disappears.** Rejected, and R2.3
is the requirement that says so. A silent fallback puts a different room in the
recording under the same name — the microphone is "the person at this machine", which
is what makes `me` and `remote` mean anything in the timeline (4.12). A dead track is
recoverable evidence; a wrong track is not.

## Risks

**Pinning changes what 4.2 is for, and 4.2 is tested.** Its tests assert that a default
change reopens the stream. They stay true for a following track and must not be
loosened to accommodate a pinned one — the pinned path is a new case, not a relaxed
version of the existing one. This is the specific place where a regression would look
like a passing suite.

**The meter cannot prove the loopback is capturing the right thing.** It proves frames
are arriving with signal in them. A loopback opened on the wrong endpoint still shows
level whenever anything plays. So this narrows group 4's standing gap without closing
it, and the manual checks on real hardware remain outstanding.

**A quiet meeting is not a dead track.** R4.3 compares the two tracks rather than
thresholding one, because somebody who has not spoken for a minute is normal and a
microphone that has captured nothing while the other side talks is not.
