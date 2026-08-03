//! A chosen endpoint lost mid-capture (R2.3).
//!
//! The requirement has four parts and they are separable, so they are asserted
//! separately: the loss is recorded, the track keeps being padded, the loss is
//! reported, and nothing is ever opened in its place. The last is the one with
//! no symptom — a substituted endpoint records a different room under the same
//! name and every number this program reports says the hour is fine.

use recorder::capture::{AudioFormat, Poll, ScriptedSource};
use recorder::clock::FakeClock;
use recorder::session::Session;

fn mono() -> AudioFormat {
    AudioFormat {
        sample_rate: 1_000,
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
    Session::start(clock, "a meeting", 1_000, 1, 1_000, 1)
}

fn lost(device: &str) -> Poll {
    Poll::DeviceLost {
        device: device.into(),
    }
}

#[test]
fn a_lost_endpoint_is_written_down_against_its_track() {
    let clock = FakeClock::starting_at(1_700_000_000 * 1_000_000_000);
    let mut session = session(&clock);
    let mut mic = source("Headset Microphone", vec![lost("Headset Microphone")]);
    let mut system = source("Speakers", vec![]);

    clock.advance(100_000_000);
    session.pump(&mut mic, &mut system).expect("the pump runs");

    let losses = session.device_losses();
    assert_eq!(losses.len(), 1, "the loss is recorded");
    assert_eq!(losses[0].track, "mic");
    assert_eq!(losses[0].device, "Headset Microphone");
}

#[test]
fn a_loss_is_not_recorded_as_a_device_change() {
    // The two mean opposite things about whether the audio is there. A reader
    // counting "one device event" and concluding the track carried on is
    // exactly the misreading these are kept apart to prevent.
    let clock = FakeClock::starting_at(1_700_000_000 * 1_000_000_000);
    let mut session = session(&clock);
    let mut mic = source("Headset Microphone", vec![lost("Headset Microphone")]);
    let mut system = source("Speakers", vec![]);

    clock.advance(100_000_000);
    session.pump(&mut mic, &mut system).expect("the pump runs");

    assert_eq!(session.device_losses().len(), 1);
    assert!(
        session.device_changes().is_empty(),
        "a loss is not a change"
    );
}

#[test]
fn a_lost_track_keeps_being_padded_so_the_two_stay_aligned() {
    // "continue the session with manufactured silence on that track". The
    // alignment of the two tracks is what the whole timeline rests on, and a
    // track that stops advancing when its device dies breaks it.
    let clock = FakeClock::starting_at(1_700_000_000 * 1_000_000_000);
    let mut session = session(&clock);
    let mut mic = source("Headset Microphone", vec![lost("Headset Microphone")]);
    let mut system = source(
        "Speakers",
        vec![
            Poll::Frames {
                wall_ns: 0,
                samples: frames(100, 0.5),
            },
            Poll::Frames {
                wall_ns: 0,
                samples: frames(100, 0.5),
            },
        ],
    );

    for _ in 0..2 {
        clock.advance(100_000_000);
        session.pump(&mut mic, &mut system).expect("the pump runs");
    }

    assert_eq!(
        session.mic().frames_written(),
        session.system().frames_written(),
        "the lost track is padded to the same length as the live one"
    );
    assert!(session.mic().frames_written() > 0);
}

#[test]
fn a_loss_repeated_on_every_poll_is_recorded_once() {
    // The endpoint does not come back, so a source may report the loss for the
    // rest of the meeting. An hour of that is 180,000 entries in the manifest
    // saying one thing.
    let clock = FakeClock::starting_at(1_700_000_000 * 1_000_000_000);
    let mut session = session(&clock);
    let mut mic = source(
        "Headset Microphone",
        vec![
            lost("Headset Microphone"),
            lost("Headset Microphone"),
            lost("Headset Microphone"),
        ],
    );
    let mut system = source("Speakers", vec![]);

    for _ in 0..3 {
        clock.advance(100_000_000);
        session.pump(&mut mic, &mut system).expect("the pump runs");
    }

    assert_eq!(session.device_losses().len(), 1);
}

#[test]
fn losing_one_track_leaves_the_other_recording() {
    let clock = FakeClock::starting_at(1_700_000_000 * 1_000_000_000);
    let mut session = session(&clock);
    let mut mic = source("Headset Microphone", vec![lost("Headset Microphone")]);
    let mut system = source(
        "Speakers",
        vec![Poll::Frames {
            wall_ns: 0,
            samples: frames(100, 0.5),
        }],
    );

    clock.advance(100_000_000);
    session.pump(&mut mic, &mut system).expect("the pump runs");

    assert_eq!(session.lost_tracks(), vec!["mic".to_string()]);
    assert!(
        session.first_frames().system_wall_ns.is_some(),
        "the system track received real audio"
    );
}

#[test]
fn a_loss_on_the_loopback_is_recorded_against_that_track() {
    let clock = FakeClock::starting_at(1_700_000_000 * 1_000_000_000);
    let mut session = session(&clock);
    let mut mic = source("Headset Microphone", vec![]);
    let mut system = source("Speakers", vec![lost("Speakers")]);

    clock.advance(100_000_000);
    session.pump(&mut mic, &mut system).expect("the pump runs");

    assert_eq!(session.lost_tracks(), vec!["system".to_string()]);
}

#[test]
fn a_loss_is_stamped_at_the_offset_it_happened() {
    // The instant is what makes the loss readable afterwards: everything in
    // the track after it is silence, and a reader has to know where that
    // starts.
    let clock = FakeClock::starting_at(1_700_000_000 * 1_000_000_000);
    let mut session = session(&clock);
    let mut mic = source(
        "Headset Microphone",
        vec![
            Poll::Frames {
                wall_ns: 0,
                samples: frames(500, 0.5),
            },
            lost("Headset Microphone"),
        ],
    );
    let mut system = source("Speakers", vec![]);

    clock.advance(500_000_000);
    session.pump(&mut mic, &mut system).expect("the first pump");
    clock.advance(500_000_000);
    session
        .pump(&mut mic, &mut system)
        .expect("the second pump");

    let losses = session.device_losses();
    assert_eq!(losses.len(), 1);
    assert!(
        losses[0].recorded_ns > 0,
        "the loss is stamped where it happened, not at zero: {:?}",
        losses[0]
    );
}

#[test]
fn a_loss_reaches_the_manifest() {
    let clock = FakeClock::starting_at(1_700_000_000 * 1_000_000_000);
    let mut session = session(&clock);
    let mut mic = source("Headset Microphone", vec![lost("Headset Microphone")]);
    let mut system = source("Speakers", vec![]);

    clock.advance(100_000_000);
    session.pump(&mut mic, &mut system).expect("the pump runs");
    session.stop(&mut mic, &mut system);

    let manifest = recorder::service::manifest_of(&session);
    assert_eq!(manifest.device_losses.len(), 1);
    assert_eq!(manifest.device_losses[0].track, "mic");
    assert!(
        manifest.device_changes.is_empty(),
        "nothing was substituted, so nothing changed"
    );
}
