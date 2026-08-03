---
autonomy: auto
ci: wait
worktree: per-group
merge: auto
---

# Audio input selection — tasks

## 1 — The capture layer

- [x] 1.1 (Unit) Enumerate endpoints in `crates/recorder`: identifier, display name, direction, and whether it is the Windows default — replacing the `devices` reply that returns names only — R1.1
  - **The second half of this task was already true, and the premise was wrong about where.** `rpc.rs` has defined `DeviceInfo { id, name, kind, default }` since 4.5, and `wasapi_source::list_devices` has populated all four. The reply that returns names only is `RecorderClient.devices()` on the TypeScript side (`apps/desktop/src/main/recorder.ts:221`), which flattens the objects into `string[]` — that is 2.4, and it is why nothing above it could offer a choice.
  - So what this task actually did was make the enumeration usable by a chooser: `Which` moved from `wasapi_source.rs` to `capture.rs`, because the microphone/loopback distinction is a fact about the recording rather than about WASAPI, and everything in 1.2 and 1.3 has to reason about it on platforms that have no WASAPI at all.
  - **`Which::kind` is now the one authority on the direction label.** `list_devices` used to carry its own `[(Direction::Capture, "capture"), (Direction::Render, "loopback")]` list, so the string a reply was written with and the string a stored choice would be matched against were two literals in two files. `from_kind` closes the loop and a test asserts the round trip.
  - `by_id` and `default_of` are the two lookups everything above does, and they are why an unresolvable identifier is an ordinary `None` rather than an error — R1.5 says an endpoint identifier means nothing off the machine that produced it.

- [x] 1.2 (TDD) Open a named endpoint instead of always the default: `WasapiSource::open` takes an optional identifier and falls back to the default only when none was given — R1.3
  - **Red observed** first: 6 of 7 failed against a signature-only `resolve`. The seventh asserts `Endpoint`'s own accessors, which were never stubbed, so it passed by accident — worth saying rather than claiming seven reds.
  - **The choice is a type, not an `Option<String>`.** `Endpoint::Default` and `Endpoint::Pinned(id)` are two modes and not two spellings of one, which is the whole of R2.1 against R2.2 — an optional identifier would have made "follows the default" and "was pinned to what happens to be the default" the same value, and they behave differently the moment the default moves.
  - **`resolve` lives above WASAPI and is where the refusal happens.** A chosen endpoint that is not on this machine is named rather than answered with the default (R2.4), and so is one of the wrong direction: a microphone opened as system audio records the room under the name of the call and reads as a working recording in every number the sidecar reports.
  - The capture layer is the one part of this crate no test here can exercise — CI has no audio device and never will — so every decision that can be *wrong* was put above it, and `WasapiSource` was left with opening what it is told to.
  - **`DeviceEnumerator::get_device` is unsound in `wasapi` 0.23.0 and is not called.** A security review found it, and it is real: the method writes `let w_id = PCWSTR::from_raw(HSTRING::from(device_id).as_ptr());`, where the `HSTRING` is an unnamed temporary. It is dropped — and `HStringHeader::free` runs — at the end of that `let`, before `w_id` reaches `GetDevice` on the next line. A use-after-free on every call. This task wrote the first two call sites `get_device` has ever had in this crate; both were replaced with a walk of the direction's device collection, matching on `get_id`, which is how `list_devices` has always read endpoints. It costs one collection walk on open and on reopen, neither of which is hot.
  - What made it worth blocking rather than noting: one of the two paths into it was `Action::MoveTo`, which is the *following-the-default* reopen — always-on behaviour since 4.2, reached by unplugging a headset, and nothing to do with whether anybody ever pinned anything. And the failure is undefined rather than a catchable panic: an access violation that ends the recording, or a corrupted identifier that opens a **different endpoint**, which is precisely the outcome this spec exists to prevent.

- [x] 1.3 (TDD) Pinned does not follow. A reopen on `default_device_changed` happens only for a track that follows the default; a pinned track keeps its endpoint — R2.1, R2.2
  - **Red observed** first: 7 of 10 failed against a `next_action` stubbed to `Action::Keep`. Three passed — the two cases that legitimately expect `Keep`, and the never-`MoveTo` invariant, which a constant `Keep` satisfies by accident.
  - **The risk design.md names came true in the useful direction.** It warned that 4.2's tests assert a default change reopens the stream and "must not be loosened to accommodate a pinned one". They were not touched: they drive `ScriptedSource` above `CaptureSource`, and the pinned path is a new branch inside `next_action` rather than a relaxation of the old one. All five still pass.
  - **`Action::Reopen` is separate from `Action::MoveTo`, and that is not cosmetic.** A stream invalidated by a sleep/resume or a driver reset reopens the *same* endpoint — the choice never changed — so nothing is written to `device_changes`. Reporting it would tell a reader the microphone changed when it did not, and that record is the only evidence anyone has about it.
  - **A pinned track no longer enumerates on the idle path.** `endpoint_may_have_moved` answers `false` for a pinned track without asking Windows anything, which matters because that check runs every 20 ms for as long as loopback is silent — most of a meeting.
  - The invariant test is exhaustive over the reachable combinations rather than case-by-case, because `MoveTo` is the one answer a pinned track must never get and a case-by-case list leaves the next case somebody adds unguarded.

- [x] 1.4 (TDD) A pinned endpoint lost mid-capture records the loss, pads the track with silence, reports it, and never reopens on a different endpoint — R2.3
  - **Red observed** first: 7 of 8 failed. The eighth — that the lost track keeps being padded — passed against an empty handler, because padding is `pad_to`'s existing job. That is worth recording rather than hiding: R2.3's *silence* half was already true, and what was missing was the recording and the reporting.
  - **A loss is not a `DeviceChange`, and they are kept in separate lists.** They read as opposites: a change says the track carried on somewhere else, a loss says everything after this instant is manufactured silence. A reader who sees both in one list and counts "one device event" is being told the recording is fine.
  - **Recorded once, however often it is reported.** The endpoint does not come back, so the source says so on every poll — an hour of that is 180,000 entries in the manifest all saying one thing.
  - **The loss is terminal for the session, and that is a decision the spec did not make.** R2.3 forbids falling back to *another* endpoint; it says nothing about re-adopting the same one if it is plugged back in. Re-adopting silently would leave a hole in the track that nothing reports, and looking for it would mean a COM enumeration per poll on the capture thread for the rest of the meeting. So it stays lost, and this is the note that says nobody decided otherwise.
  - `status` gained `lost_tracks`, naming the tracks rather than counting them, because "report it" is only worth something to somebody who is told *which* track went silent. `status` is nominally 2.3's surface; this field is not claimed by any group-2 task, and group 2 should fold it into its delta rather than leave the citation orphaned.
  - **Making the loss terminal cost a core, and a code review caught it.** Short-circuiting `poll` before `wait_for_event` removed the only thing pacing the capture thread — that wait *is* the loop's cadence, since the thread has no sleep on the path that succeeds. A lost track then spun at full tilt for the rest of the meeting. Measured, by reverting the fix: **2,238,167 polls in 300 ms**.
  - It is fixed in both places, because two different things were wrong. `EVENT_WAIT_MS` is now a named constant whose comment says it paces the thread, and the `lost` branch waits for it — that is the instance. And `ThreadedSource` now pauses after any poll that brought no frames, which is the *class*: any source answering instantly spins that loop, and the idle case turned out to spin exactly as hard as the lost one. Only when nothing arrived — while audio is flowing the drain stays prompt, which is the entire reason that thread exists.
  - `tests/pacing.rs` asserts all three, and was confirmed to fail without the fix rather than merely pass with it. It is the only test in this repository that says anything about the capture thread's cost, which is a thing no WASAPI source here can be constructed to demonstrate.

- [x] 1.5 (Unit) Record per track, in `manifest.json`, which endpoint was captured and whether it was pinned or default — R3.3
  - **The mode is the half that cannot be reconstructed afterwards.** Two recordings can name the same microphone and mean different things — one was told to use it, the other happened to get it because Windows preferred it that day — and only the first is evidence that somebody chose.
  - **What is recorded is what the devices reported, not what was asked for.** A following track was never asked for an endpoint at all, so taking this from the request would have left it blank for exactly the recordings where it is most useful.
  - `Session::capturing` is a call rather than two more arguments to `start`: the session's six arguments describe the recording, and whoever opened the devices is what knows the hardware. `ThreadedSource` publishes the endpoint from inside the capture thread, which is the only place that can read it — a WASAPI client is apartment-bound and does not cross threads.
  - Published once, at open. A move after that is a `device_change` and is already recorded; two answers to one question is how they come to disagree.

- [x] 1.6 (TDD) Compute a per-track level from the frames already in hand, over a short window, without opening a second stream — R4.4
  - **Red observed** first: 11 of 13 failed against a meter stubbed to `0.0`/`silent`. The two that passed assert an empty meter reads zero and silent, which the stub satisfies by accident.
  - **The window is short on purpose, and that is the requirement rather than a tuning choice.** R4.2 asks for a level that reads *as speech happens*, and an average over the session is the thing it exists to exclude: a meter running for forty minutes barely moves when somebody starts talking. 200 ms, and what falls out of it stops counting.
  - **`silent` is exactly zero, not a threshold.** A track receiving nothing gives back literal silence and a quiet room does not, so a threshold would report somebody who is merely not talking as a dead microphone — the reassurance failure R4.3 is written against.
  - Peak and rms both, because they answer different questions: rms is what a person hears as loudness, peak is what they see as a transient, and one loud sample in a quiet stretch has to move them differently or the meter is not evidence of anything.
  - **This is the correction to the reasoning that put metering out of scope originally.** The cost that justified excluding it was a second consumer of the endpoint, and there is none: the meter is fed the same buffer that is on its way to the WAV writer, inside `Session::apply`. That is R4.4, asserted where it can actually be observed — a level appearing from an ordinary pump.

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
