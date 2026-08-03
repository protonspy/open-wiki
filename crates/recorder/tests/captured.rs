//! What the manifest records about which endpoint each track captured (R3.3).
//!
//! The mode is the half that cannot be reconstructed afterwards. Two
//! recordings can name the same microphone and mean different things: one was
//! told to use it, the other happened to get it because Windows preferred it
//! that day — and only the first is evidence that somebody chose.

use recorder::capture::{AudioFormat, Poll, ScriptedSource};
use recorder::clock::FakeClock;
use recorder::endpoint::CapturedEndpoint;
use recorder::service::manifest_of;
use recorder::session::Session;

const WALL0: u64 = 1_700_000_000 * 1_000_000_000;

fn source(device: &str) -> ScriptedSource {
    ScriptedSource::new(
        AudioFormat {
            sample_rate: 1_000,
            channels: 1,
        },
        device,
        Vec::new(),
    )
}

fn chosen(id: &str, name: &str) -> CapturedEndpoint {
    CapturedEndpoint {
        id: Some(id.into()),
        name: name.into(),
        pinned: true,
    }
}

fn followed(id: &str, name: &str) -> CapturedEndpoint {
    CapturedEndpoint {
        id: Some(id.into()),
        name: name.into(),
        pinned: false,
    }
}

#[test]
fn the_manifest_names_the_endpoint_each_track_captured() {
    let clock = FakeClock::starting_at(WALL0);
    let mut session = Session::start(&clock, "a meeting", 1_000, 1, 1_000, 1);
    session.capturing(
        chosen("{mic-headset}", "Headset Microphone"),
        followed("{out-speakers}", "Speakers"),
    );

    let manifest = manifest_of(&session);

    assert_eq!(manifest.tracks.mic.endpoint.name, "Headset Microphone");
    assert_eq!(
        manifest.tracks.mic.endpoint.id.as_deref(),
        Some("{mic-headset}")
    );
    assert_eq!(manifest.tracks.system.endpoint.name, "Speakers");
}

#[test]
fn the_manifest_says_whether_each_track_was_pinned_or_following() {
    let clock = FakeClock::starting_at(WALL0);
    let mut session = Session::start(&clock, "a meeting", 1_000, 1, 1_000, 1);
    session.capturing(
        chosen("{mic-headset}", "Headset Microphone"),
        followed("{out-speakers}", "Speakers"),
    );

    let manifest = manifest_of(&session);

    assert!(
        manifest.tracks.mic.endpoint.pinned,
        "somebody chose the headset"
    );
    assert!(
        !manifest.tracks.system.endpoint.pinned,
        "the system track took whatever Windows preferred"
    );
}

#[test]
fn the_two_tracks_are_recorded_separately() {
    // R1.2 chooses them independently, so the manifest has to keep them
    // apart. One field for both would make a mixed recording unreadable.
    let clock = FakeClock::starting_at(WALL0);
    let mut session = Session::start(&clock, "a meeting", 1_000, 1, 1_000, 1);
    session.capturing(
        chosen("{mic-headset}", "Headset Microphone"),
        chosen("{out-headphones}", "Headphones"),
    );

    let manifest = manifest_of(&session);

    assert_ne!(
        manifest.tracks.mic.endpoint, manifest.tracks.system.endpoint,
        "two endpoints, two records"
    );
}

#[test]
fn a_recording_nobody_told_which_endpoint_to_use_still_produces_a_manifest() {
    // Every existing caller. The endpoint is unknown rather than wrong, and
    // an absent answer must not become a claim that something was pinned.
    let clock = FakeClock::starting_at(WALL0);
    let session = Session::start(&clock, "a meeting", 1_000, 1, 1_000, 1);

    let manifest = manifest_of(&session);

    assert!(!manifest.tracks.mic.endpoint.pinned);
    assert!(manifest.tracks.mic.endpoint.id.is_none());
}

#[test]
fn a_source_that_knows_no_choice_reports_its_device_name_and_following() {
    // The default `CaptureSource::endpoint`, which is what every source that
    // predates this spec answers with.
    use recorder::capture::CaptureSource;

    let source = source("Webcam Microphone");
    let endpoint = source.endpoint();

    assert_eq!(endpoint.name, "Webcam Microphone");
    assert!(!endpoint.pinned);
    assert!(endpoint.id.is_none());
}

#[test]
fn the_endpoint_survives_the_json_round_trip() {
    // `manifest.json` is read by 4.7 and 4.11, so what is written has to come
    // back as what it was — including the mode, which is one bool nothing
    // else in the file would reveal.
    let clock = FakeClock::starting_at(WALL0);
    let mut session = Session::start(&clock, "a meeting", 1_000, 1, 1_000, 1);
    session.capturing(
        chosen("{mic-headset}", "Headset Microphone"),
        followed("{out-speakers}", "Speakers"),
    );
    let manifest = manifest_of(&session);

    let json = manifest.to_json().expect("the manifest serialises");
    let back: recorder::manifest::RecordingManifest =
        serde_json::from_str(&json).expect("and reads back");

    assert_eq!(back.tracks.mic.endpoint, manifest.tracks.mic.endpoint);
    assert!(back.tracks.mic.endpoint.pinned);
    assert!(!back.tracks.system.endpoint.pinned);
}

#[test]
fn the_endpoint_recorded_is_the_one_the_devices_reported() {
    // The service takes this from the sources rather than from what was asked
    // for: a following track's endpoint is whatever Windows gave, and the
    // manifest records what happened rather than what was requested.
    let clock = FakeClock::starting_at(WALL0);
    let mut session = Session::start(&clock, "a meeting", 1_000, 1, 1_000, 1);
    let mut mic = source("Webcam Microphone");
    let mut system = source("Speakers");
    session.capturing(
        recorder::capture::CaptureSource::endpoint(&mic),
        recorder::capture::CaptureSource::endpoint(&system),
    );
    let _ = session.pump(&mut mic, &mut system);

    let manifest = manifest_of(&session);
    assert_eq!(manifest.tracks.mic.endpoint.name, "Webcam Microphone");
    assert_eq!(manifest.tracks.system.endpoint.name, "Speakers");
}

#[test]
fn an_idle_poll_does_not_disturb_what_was_recorded() {
    let clock = FakeClock::starting_at(WALL0);
    let mut session = Session::start(&clock, "a meeting", 1_000, 1, 1_000, 1);
    session.capturing(
        chosen("{mic-headset}", "Headset Microphone"),
        followed("{out-speakers}", "Speakers"),
    );

    let mut mic = ScriptedSource::new(
        AudioFormat {
            sample_rate: 1_000,
            channels: 1,
        },
        "Headset Microphone",
        vec![Poll::Idle, Poll::Idle],
    );
    let mut system = source("Speakers");
    clock.advance(100_000_000);
    let _ = session.pump(&mut mic, &mut system);

    assert!(session.mic_endpoint().pinned);
    assert_eq!(session.mic_endpoint().name, "Headset Microphone");
}
