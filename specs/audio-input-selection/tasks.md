---
autonomy: auto
ci: wait
---

# Audio input selection — tasks

## 1 — The capture layer

- [ ] 1.1 (Unit) Enumerate endpoints in `crates/recorder`: identifier, display name, direction, and whether it is the Windows default — replacing the `devices` reply that returns names only — R1.1
- [ ] 1.2 (TDD) Open a named endpoint instead of always the default: `WasapiSource::open` takes an optional identifier and falls back to the default only when none was given — R1.3
- [ ] 1.3 (TDD) Pinned does not follow. A reopen on `default_device_changed` happens only for a track that follows the default; a pinned track keeps its endpoint — R2.1, R2.2
- [ ] 1.4 (TDD) A pinned endpoint lost mid-capture records the loss, pads the track with silence, reports it, and never reopens on a different endpoint — R2.3
- [ ] 1.5 (Unit) Record per track, in `manifest.json`, which endpoint was captured and whether it was pinned or default — R3.3
- [ ] 1.6 (TDD) Compute a per-track level from the frames already in hand, over a short window, without opening a second stream — R4.4

## 2 — The protocol and the main process

- [ ] 2.1 (Unit) `devices` returns the enumerated shape, and `start` accepts an endpoint per track — R1.1, R1.2
- [ ] 2.2 (Unit) Refuse `start` when a pinned endpoint is absent, naming it, and surface that refusal as itself rather than as a generic failure to record — R2.4
- [ ] 2.3 (Unit) Carry the per-track level on the `status` reply, so the level rides the poll that already exists rather than adding a notification stream. The poll must still never start the sidecar — `peek` and `ensure` stay different methods — R4.1, R4.2
- [ ] 2.4 (Unit) Expose the device call through `channels.ts` and the preload, which is what `RecorderClient.devices()` has been missing since it was written — R1.1
- [ ] 2.5 (Unit) Hold the chosen endpoints in the project settings of 2.7, keeping the closed schema, and treat an identifier that no longer resolves as a choice to re-make rather than an error to store — R1.5

## 3 — The surface

- [ ] 3.1 (Unit) A picker per track, reachable where recording starts and not only from settings, with "Windows default" as a named option rather than an empty one — R1.2, R1.4
- [ ] 3.2 (Unit) A level meter per track in the recording indicator, reading as speech happens — R4.1, R4.2
- [ ] 3.3 (Unit) The indicator says which endpoint each track is capturing — R3.1
- [ ] 3.4 (Unit) An endpoint that changes mid-recording is shown changing, and says what it moved to — R3.2
- [ ] 3.5 (Unit) One track silent while the other is not is reported on screen, not merely left to a flat meter the user has to notice — R4.3

## 4 — The pre-flight check

- [ ] 4.1 (TDD) A check that opens each chosen endpoint, captures briefly, and classifies the result three ways: failed to open, opened and silent, opened and receiving. Test-first because the classification _is_ the feature and its failure mode is reassurance — a check reporting "working" for a dead endpoint is worse than no check, because somebody then records an hour on it — R5.2, R5.3
- [ ] 4.2 (TDD) The check captures to nothing: no source registered, nothing written under `raw/`, no bytes kept. Test-first because a test capture that lands as a source is pollution nobody goes looking for — R5.4
- [ ] 4.3 (TDD) Both endpoints are released when the check ends, on every path including failure. `recorder.exe` opens both WASAPI devices the moment it launches, so a check that exits without releasing holds the microphone while the chrome says nothing is being recorded — the exact failure the `peek`/`ensure` split exists to prevent, reached from a new direction — R5.5
- [ ] 4.4 (Unit) The check is offered where recording starts, beside the pickers of 3.1, and is not offered while a recording is in progress — R5.1, R5.6
- [ ] 4.5 (Unit) The result reads as an answer rather than a level: which endpoint, whether it is receiving, and what to do when it is not — R5.1, R5.3
