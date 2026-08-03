//! Reading the level off the frames already captured (R4.1, R4.2, R4.4).

use recorder::capture::{AudioFormat, Poll, ScriptedSource};
use recorder::clock::FakeClock;
use recorder::level::Meter;
use recorder::session::Session;

const WALL0: u64 = 1_700_000_000 * 1_000_000_000;

/// 1 kHz mono, so one millisecond is one sample and a window is easy to
/// reason about by hand.
fn meter(window_ms: u32) -> Meter {
    Meter::new(1_000, 1, window_ms)
}

fn frames(n: usize, v: f32) -> Vec<f32> {
    vec![v; n]
}

#[test]
fn a_meter_that_has_seen_nothing_reads_zero_and_silent() {
    let meter = meter(200);

    assert_eq!(meter.peak(), 0.0);
    assert_eq!(meter.rms(), 0.0);
    assert!(meter.silent());
}

#[test]
fn the_peak_is_the_loudest_sample_in_the_window() {
    let mut meter = meter(200);
    meter.push(&[0.1, 0.4, 0.25]);

    assert!((meter.peak() - 0.4).abs() < 1e-6, "got {}", meter.peak());
}

#[test]
fn a_sample_counts_at_its_magnitude_whichever_way_it_swings() {
    // Audio is signed and symmetric around zero. A meter that took the
    // signed maximum would read nothing at all on a waveform whose loudest
    // excursions happen to be negative.
    let mut meter = meter(200);
    meter.push(&[-0.8, 0.2]);

    assert!((meter.peak() - 0.8).abs() < 1e-6, "got {}", meter.peak());
}

#[test]
fn the_rms_of_a_steady_signal_is_its_magnitude() {
    let mut meter = meter(200);
    meter.push(&frames(100, 0.5));

    assert!((meter.rms() - 0.5).abs() < 1e-6, "got {}", meter.rms());
}

#[test]
fn the_rms_sits_below_the_peak_on_a_signal_that_is_not_steady() {
    // What a person hears as loudness against what they see as a transient.
    // One loud sample in a quiet stretch should move the peak far more than
    // the rms, which is the whole reason both are reported.
    let mut meter = meter(200);
    let mut samples = frames(99, 0.01);
    samples.push(0.9);
    meter.push(&samples);

    assert!(meter.rms() < meter.peak());
    assert!((meter.peak() - 0.9).abs() < 1e-6);
    assert!(meter.rms() < 0.2, "got {}", meter.rms());
}

#[test]
fn what_falls_out_of_the_window_stops_counting() {
    // R4.2, and the point of the whole design: the level reads as speech
    // happens rather than as an average over the session. A shout forty
    // minutes ago must not still be moving the meter.
    let mut meter = meter(100); // 100 samples at 1 kHz mono
    meter.push(&frames(100, 0.9));
    assert!((meter.peak() - 0.9).abs() < 1e-6, "the shout registers");

    meter.push(&frames(100, 0.0));

    assert_eq!(meter.peak(), 0.0, "and then it ages out");
    assert!(meter.silent());
}

#[test]
fn the_window_holds_only_its_own_length() {
    let mut meter = meter(100);
    meter.push(&frames(1_000, 0.5));

    assert_eq!(
        meter.len(),
        100,
        "an oversized push does not grow the window"
    );
}

#[test]
fn a_push_larger_than_the_window_keeps_its_newest_samples() {
    // The tail of the push is the recent past. Keeping the head would show a
    // level from a moment that has already gone.
    let mut meter = meter(4);
    let mut samples = frames(10, 0.1);
    samples.extend_from_slice(&[0.7, 0.7, 0.7, 0.7]);
    meter.push(&samples);

    assert!((meter.peak() - 0.7).abs() < 1e-6, "got {}", meter.peak());
}

#[test]
fn a_quiet_room_is_not_silence() {
    // R4.3 compares the two tracks rather than thresholding one, because
    // somebody who has not spoken for a minute is normal. A meter that called
    // a very quiet signal "silent" would make that comparison lie.
    let mut meter = meter(200);
    meter.push(&frames(100, 0.0001));

    assert!(!meter.silent(), "there is signal, however little");
    assert!(meter.peak() > 0.0);
}

#[test]
fn a_track_receiving_nothing_reads_silent() {
    let mut meter = meter(200);
    meter.push(&frames(100, 0.0));

    assert!(meter.silent());
}

#[test]
fn the_window_scales_with_the_rate_and_the_channels() {
    // A level is about the track, not about one channel of it, so the window
    // covers the same amount of *time* whatever the format.
    let mono = Meter::new(48_000, 1, 200);
    let stereo = Meter::new(48_000, 2, 200);

    let mut mono = mono;
    let mut stereo = stereo;
    mono.push(&frames(100_000, 0.5));
    stereo.push(&frames(100_000, 0.5));

    assert_eq!(mono.len(), 9_600);
    assert_eq!(stereo.len(), 19_200);
}

#[test]
fn the_session_reads_a_level_off_the_frames_it_was_given() {
    // R4.4 stated where it can actually be observed: the level appears from
    // an ordinary pump, with no second source and nothing else opened.
    let clock = FakeClock::starting_at(WALL0);
    let mut session = Session::start(&clock, "a meeting", 1_000, 1, 1_000, 1);
    let format = AudioFormat {
        sample_rate: 1_000,
        channels: 1,
    };
    let mut mic = ScriptedSource::new(
        format,
        "Headset Microphone",
        vec![Poll::Frames {
            wall_ns: 0,
            samples: frames(100, 0.6),
        }],
    );
    let mut system = ScriptedSource::new(format, "Speakers", Vec::new());

    clock.advance(100_000_000);
    session.pump(&mut mic, &mut system).expect("the pump runs");

    assert!(
        (session.mic_level().peak() - 0.6).abs() < 1e-6,
        "got {}",
        session.mic_level().peak()
    );
    assert!(session.system_level().silent(), "nothing arrived there");
}

#[test]
fn one_track_silent_while_the_other_is_not_is_visible_from_the_levels() {
    // R4.3's evidence. The comparison itself belongs to the surface; what
    // this asserts is that the two levels make it answerable at all.
    let clock = FakeClock::starting_at(WALL0);
    let mut session = Session::start(&clock, "a meeting", 1_000, 1, 1_000, 1);
    let format = AudioFormat {
        sample_rate: 1_000,
        channels: 1,
    };
    let mut mic = ScriptedSource::new(
        format,
        "Headset Microphone",
        vec![Poll::Frames {
            wall_ns: 0,
            samples: frames(100, 0.0),
        }],
    );
    let mut system = ScriptedSource::new(
        format,
        "Speakers",
        vec![Poll::Frames {
            wall_ns: 0,
            samples: frames(100, 0.5),
        }],
    );

    clock.advance(100_000_000);
    session.pump(&mut mic, &mut system).expect("the pump runs");

    assert!(session.mic_level().silent());
    assert!(!session.system_level().silent());
}
