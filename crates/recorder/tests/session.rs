use recorder::capture::{AudioFormat, CaptureError, CaptureSource, Poll, ScriptedSource};
use recorder::clock::FakeClock;
use recorder::session::{Session, State};

const S: u64 = 1_000_000_000;
const RATE: u32 = 48_000;
const WALL0: u64 = 1_700_000_000 * S;

fn mono() -> AudioFormat {
    AudioFormat {
        sample_rate: RATE,
        channels: 1,
    }
}

fn source(device: &str, script: Vec<Poll>) -> ScriptedSource {
    ScriptedSource::new(mono(), device, script)
}

fn frames(n: usize, v: f32) -> Vec<f32> {
    vec![v; n]
}

fn session(clock: &FakeClock) -> Session<&FakeClock> {
    Session::start(clock, "Fenix weekly", RATE, 1, RATE, 1)
}

#[test]
fn a_new_session_is_recording_and_has_one_open_segment() {
    let clock = FakeClock::starting_at(WALL0);
    let s = session(&clock);
    assert_eq!(s.state(), State::Recording);
    assert_eq!(s.time_map().segments.len(), 1);
    assert_eq!(s.started_wall_ns(), WALL0);
    assert_eq!(s.pauses().len(), 0);
}

#[test]
fn both_tracks_advance_together_when_only_one_device_delivers() {
    // Loopback is silent because nobody is playing sound. Its track still has
    // to be as long as the microphone's, or every later instant on it is early.
    let clock = FakeClock::starting_at(WALL0);
    let mut s = session(&clock);

    let mut mic = source(
        "mic",
        vec![Poll::Frames {
            wall_ns: 0,
            samples: frames(48_000, 0.5),
        }],
    );
    let mut sys = source("system", vec![Poll::Idle]);

    // A second of wall time passed while that second of audio arrived.
    clock.advance(S);
    s.pump(&mut mic, &mut sys).unwrap();
    assert_eq!(s.mic().frames_written(), 48_000);
    assert_eq!(
        s.system().frames_written(),
        48_000,
        "silence manufactured for the idle track"
    );
    assert!(s.system().samples().iter().all(|x| *x == 0.0));
}

#[test]
fn a_first_frame_is_recorded_per_track_and_only_once() {
    let clock = FakeClock::starting_at(WALL0);
    let mut s = session(&clock);
    let mut mic = source(
        "mic",
        vec![
            Poll::Frames {
                wall_ns: 0,
                samples: frames(480, 0.5),
            },
            Poll::Frames {
                wall_ns: 10_000_000,
                samples: frames(480, 0.5),
            },
        ],
    );
    let mut sys = source("system", vec![Poll::Idle, Poll::Idle]);

    s.pump(&mut mic, &mut sys).unwrap();
    s.pump(&mut mic, &mut sys).unwrap();

    assert_eq!(s.first_frames().mic_wall_ns, Some(WALL0));
    // The loopback never delivered a frame, so it has no first frame. Claiming
    // the session's start would be a timestamp nobody recorded.
    assert_eq!(s.first_frames().system_wall_ns, None);
}

#[test]
fn a_pause_stops_both_devices_at_the_same_instant() {
    let clock = FakeClock::starting_at(WALL0);
    let mut s = session(&clock);
    let mut mic = source("mic", vec![]);
    let mut sys = source("system", vec![]);

    s.pause(&mut mic, &mut sys);
    assert_eq!(s.state(), State::Paused);
    assert_eq!(mic.stopped, 1);
    assert_eq!(
        sys.stopped, 1,
        "one track paused and the other still running would drift"
    );
    assert_eq!(s.pauses().len(), 1);
    assert_eq!(s.pauses()[0].end_wall_ns, None);
}

#[test]
fn a_resume_starts_both_devices_and_closes_the_pause() {
    let clock = FakeClock::starting_at(WALL0);
    let mut s = session(&clock);
    let mut mic = source("mic", vec![]);
    let mut sys = source("system", vec![]);

    s.pause(&mut mic, &mut sys);
    clock.advance(10 * S);
    s.resume(&mut mic, &mut sys).unwrap();

    assert_eq!(s.state(), State::Recording);
    assert_eq!(mic.started, 1);
    assert_eq!(sys.started, 1);
    assert_eq!(s.pauses().len(), 1);
    assert!(s.pauses()[0].end_wall_ns.is_some());
}

#[test]
fn nothing_is_captured_while_paused() {
    let clock = FakeClock::starting_at(WALL0);
    let mut s = session(&clock);
    let mut mic = source(
        "mic",
        vec![Poll::Frames {
            wall_ns: 0,
            samples: frames(48_000, 0.5),
        }],
    );
    let mut sys = source("system", vec![Poll::Idle]);

    s.pause(&mut mic, &mut sys);
    s.pump(&mut mic, &mut sys).unwrap();

    assert_eq!(s.mic().frames_written(), 0);
    assert_eq!(s.system().frames_written(), 0);
}

#[test]
fn the_paused_stretch_leaves_both_tracks_as_one_block() {
    // The property 4.3 names. The pause is ten seconds of wall time and zero
    // frames of recording, on both tracks.
    let clock = FakeClock::starting_at(WALL0);
    let mut s = session(&clock);

    let mut mic = source(
        "mic",
        vec![Poll::Frames {
            wall_ns: 0,
            samples: frames(48_000, 0.5),
        }],
    );
    let mut sys = source("system", vec![Poll::Idle]);
    clock.advance(S);
    s.pump(&mut mic, &mut sys).unwrap();

    s.pause(&mut mic, &mut sys);
    // Ten seconds of wall time pass while paused, and none of it is recorded.
    clock.advance(10 * S);
    s.resume(&mut mic, &mut sys).unwrap();

    let mut mic2 = source(
        "mic",
        vec![Poll::Frames {
            wall_ns: 0,
            samples: frames(48_000, 0.75),
        }],
    );
    clock.advance(S);
    s.pump(&mut mic2, &mut sys).unwrap();

    assert_eq!(s.mic().frames_written(), 96_000, "no silence for the pause");
    assert_eq!(s.system().frames_written(), 96_000);
    assert_eq!(s.mic().samples()[47_999], 0.5);
    assert_eq!(s.mic().samples()[48_000], 0.75);
}

#[test]
fn a_device_change_is_survived_and_written_down() {
    // The default device changing mid-meeting kills the stream silently if
    // nobody is looking. The source reopens itself; the session records it.
    let clock = FakeClock::starting_at(WALL0);
    let mut s = session(&clock);
    let mut mic = source(
        "old-mic",
        vec![
            Poll::DeviceChanged {
                device: "new-mic".into(),
            },
            Poll::Frames {
                wall_ns: 0,
                samples: frames(480, 0.5),
            },
        ],
    );
    let mut sys = source("system", vec![Poll::Idle, Poll::Idle]);

    s.pump(&mut mic, &mut sys).unwrap();
    s.pump(&mut mic, &mut sys).unwrap();

    assert_eq!(s.device_changes().len(), 1);
    assert_eq!(s.device_changes()[0].track, "mic");
    assert_eq!(s.device_changes()[0].device, "new-mic");
    assert_eq!(
        s.state(),
        State::Recording,
        "a device change does not end the recording"
    );
    assert_eq!(
        s.mic().frames_written(),
        480,
        "capture continued on the new device"
    );
}

#[test]
fn a_device_change_on_the_loopback_is_recorded_against_that_track() {
    let clock = FakeClock::starting_at(WALL0);
    let mut s = session(&clock);
    let mut mic = source("mic", vec![Poll::Idle]);
    let mut sys = source(
        "system",
        vec![Poll::DeviceChanged {
            device: "headphones".into(),
        }],
    );

    s.pump(&mut mic, &mut sys).unwrap();

    assert_eq!(s.device_changes().len(), 1);
    assert_eq!(s.device_changes()[0].track, "system");
    assert_eq!(s.device_changes()[0].device, "headphones");
}

#[test]
fn stopping_closes_the_segment_and_the_devices() {
    let clock = FakeClock::starting_at(WALL0);
    let mut s = session(&clock);
    let mut mic = source("mic", vec![]);
    let mut sys = source("system", vec![]);

    s.stop(&mut mic, &mut sys);
    assert_eq!(s.state(), State::Stopped);
    assert_eq!(mic.stopped, 1);
    assert_eq!(sys.stopped, 1);
}

#[test]
fn nothing_is_captured_after_stopping() {
    let clock = FakeClock::starting_at(WALL0);
    let mut s = session(&clock);
    let mut mic = source(
        "mic",
        vec![Poll::Frames {
            wall_ns: 0,
            samples: frames(4800, 0.5),
        }],
    );
    let mut sys = source("system", vec![Poll::Idle]);

    s.stop(&mut mic, &mut sys);
    s.pump(&mut mic, &mut sys).unwrap();
    assert_eq!(s.mic().frames_written(), 0);
}

#[test]
fn resuming_a_recording_that_is_not_paused_changes_nothing() {
    let clock = FakeClock::starting_at(WALL0);
    let mut s = session(&clock);
    let mut mic = source("mic", vec![]);
    let mut sys = source("system", vec![]);

    s.resume(&mut mic, &mut sys).unwrap();
    assert_eq!(s.state(), State::Recording);
    assert_eq!(s.pauses().len(), 0);
    assert_eq!(
        s.time_map().segments.len(),
        1,
        "no second segment for a resume that did nothing"
    );
}

#[test]
fn pausing_twice_records_one_pause() {
    let clock = FakeClock::starting_at(WALL0);
    let mut s = session(&clock);
    let mut mic = source("mic", vec![]);
    let mut sys = source("system", vec![]);

    s.pause(&mut mic, &mut sys);
    s.pause(&mut mic, &mut sys);
    assert_eq!(s.pauses().len(), 1);
    assert_eq!(mic.stopped, 1, "the second pause is not a second stop");
}

/// A source that always fails, for the "one bad device" cases.
struct BrokenSource(AudioFormat);

impl CaptureSource for BrokenSource {
    fn format(&self) -> AudioFormat {
        self.0
    }
    fn device_name(&self) -> String {
        "broken".into()
    }
    fn poll(&mut self) -> Result<Poll, CaptureError> {
        Err(CaptureError("the device is gone".into()))
    }
}

#[test]
fn the_time_map_never_claims_more_than_the_tracks_hold() {
    // Measured drift, before the fix: the map was extended to the pause while
    // the tracks were closed where the last pump left them, so the map said
    // 1.020s where the file held 1.000s — and `resume` anchored the next
    // segment on the inflated figure, making it permanent and cumulative.
    let clock = FakeClock::starting_at(WALL0);
    let mut s = session(&clock);
    let mut mic = source(
        "mic",
        vec![Poll::Frames {
            wall_ns: 0,
            samples: frames(48_000, 0.5),
        }],
    );
    let mut sys = source("system", vec![Poll::Idle]);

    clock.advance(S);
    s.pump(&mut mic, &mut sys).unwrap();

    // Twenty milliseconds pass between the last poll and the pause.
    clock.advance(20 * 1_000_000);
    s.pause(&mut mic, &mut sys);

    let map_ns = s.time_map().recorded_duration_ns();
    let track_ns = s.mic().frames_written() * 1_000_000_000 / u64::from(RATE);
    assert_eq!(map_ns, track_ns, "the map and the audio must agree");
}

#[test]
fn the_drift_does_not_accumulate_across_pauses() {
    let clock = FakeClock::starting_at(WALL0);
    let mut s = session(&clock);
    let mut mic = source("mic", vec![]);
    let mut sys = source("system", vec![]);

    for _ in 0..4 {
        clock.advance(S);
        s.pump(&mut mic, &mut sys).unwrap();
        clock.advance(20 * 1_000_000);
        s.pause(&mut mic, &mut sys);
        clock.advance(10 * S);
        s.resume(&mut mic, &mut sys).unwrap();
    }
    clock.advance(30 * 1_000_000);
    s.stop(&mut mic, &mut sys);

    let map_ns = s.time_map().recorded_duration_ns();
    let track_ns = s.mic().frames_written() * 1_000_000_000 / u64::from(RATE);
    assert_eq!(map_ns, track_ns);
}

#[test]
fn a_first_frame_is_the_first_real_frame_not_the_first_silence() {
    // `frames_written` counts manufactured silence, so using it meant the flag
    // was already poisoned before any audio arrived — and `first_frames` came
    // out null for both tracks in every realistic recording, which is one of
    // the three things 4.4 says the manifest is for.
    let clock = FakeClock::starting_at(WALL0);
    let mut s = session(&clock);
    let mut mic = source(
        "mic",
        vec![
            Poll::Idle,
            Poll::Frames {
                wall_ns: 0,
                samples: frames(480, 0.5),
            },
        ],
    );
    let mut sys = source("system", vec![Poll::Idle, Poll::Idle]);

    // The first poll returns nothing, and time passes: the track is padded.
    clock.advance(S);
    s.pump(&mut mic, &mut sys).unwrap();
    assert!(s.mic().frames_written() > 0, "silence was manufactured");
    assert_eq!(
        s.first_frames().mic_wall_ns,
        None,
        "silence is not a first frame"
    );

    clock.advance(S);
    s.pump(&mut mic, &mut sys).unwrap();
    assert_eq!(s.first_frames().mic_wall_ns, Some(WALL0 + 2 * S));
}

#[test]
fn one_failing_device_does_not_freeze_the_other_track_or_the_map() {
    // Both polls used to be `?`, so a mic that kept failing meant neither
    // track grew, the map stopped extending, and `status` still said
    // "recording" — the normal outcome of a device disappearing.
    let clock = FakeClock::starting_at(WALL0);
    let mut s = session(&clock);
    let mut mic = BrokenSource(mono());
    let mut sys = source(
        "system",
        vec![Poll::Frames {
            wall_ns: 0,
            samples: frames(48_000, 0.5),
        }],
    );

    clock.advance(S);
    s.pump(&mut mic, &mut sys).unwrap();

    assert_eq!(
        s.system().frames_written(),
        48_000,
        "the good device still recorded"
    );
    assert_eq!(
        s.mic().frames_written(),
        48_000,
        "the dead track is padded, not frozen"
    );
    assert!(
        s.time_map().recorded_duration_ns() > 0,
        "the map kept moving"
    );
}

#[test]
fn a_device_change_behind_frames_is_reported_and_not_dropped() {
    // The change used to be taken out of the queue and then discarded when
    // audio preceded it in the same drain, so the recording carried on with no
    // record that the device had moved.
    use recorder::capture::AudioFormat;
    use recorder::pump::ThreadedSource;

    let format = AudioFormat {
        sample_rate: RATE,
        channels: 1,
    };
    let mut threaded = ThreadedSource::spawn(format, move || {
        Ok(ScriptedSource::new(
            format,
            "old",
            vec![
                Poll::Frames {
                    wall_ns: 0,
                    samples: vec![0.5; 480],
                },
                Poll::DeviceChanged {
                    device: "new".into(),
                },
            ],
        ))
    });
    threaded
        .wait_until_open(std::time::Duration::from_secs(2))
        .unwrap();
    threaded.start().unwrap();

    let mut seen_frames = false;
    let mut seen_change = false;
    for _ in 0..200 {
        match threaded.poll().unwrap() {
            Poll::Frames { .. } => seen_frames = true,
            Poll::DeviceChanged { device } => {
                assert_eq!(device, "new");
                seen_change = true;
                break;
            }
            Poll::Idle => std::thread::sleep(std::time::Duration::from_millis(5)),
        }
    }
    assert!(seen_frames, "the audio before the change is delivered");
    assert!(seen_change, "and the change itself is not lost behind it");
}
