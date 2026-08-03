//! Enumerating endpoints (R1.1), and finding one again.
//!
//! The WASAPI call that produces this list is Windows-only and has no test
//! anywhere — CI has no audio device. What is testable, and what these assert,
//! is the shape the list is in and the two lookups everything above it does:
//! an identifier a stored choice is matched against, and the default for one
//! end of the machine.

use recorder::capture::Which;
use recorder::rpc::{by_id, default_of, DeviceInfo};

fn device(id: &str, name: &str, which: Which, default: bool) -> DeviceInfo {
    DeviceInfo {
        id: id.into(),
        name: name.into(),
        kind: which.kind().into(),
        default,
    }
}

/// A machine with a webcam microphone Windows prefers, a headset that is not
/// the default, and one render endpoint — the situation the spec's purpose
/// describes.
fn machine() -> Vec<DeviceInfo> {
    vec![
        device("{mic-webcam}", "Webcam Microphone", Which::Microphone, true),
        device(
            "{mic-headset}",
            "Headset Microphone",
            Which::Microphone,
            false,
        ),
        device("{out-speakers}", "Speakers", Which::Loopback, true),
    ]
}

#[test]
fn an_endpoint_carries_an_identifier_a_name_a_direction_and_whether_it_is_default() {
    let devices = machine();
    let headset = by_id(&devices, "{mic-headset}").expect("the headset is in the list");

    assert_eq!(headset.id, "{mic-headset}");
    assert_eq!(headset.name, "Headset Microphone");
    assert!(headset.is(Which::Microphone));
    assert!(!headset.default);
}

#[test]
fn the_direction_says_which_end_of_the_machine_an_endpoint_belongs_to() {
    let devices = machine();
    let speakers = by_id(&devices, "{out-speakers}").expect("the speakers are in the list");

    // Loopback captures a *render* endpoint. An endpoint is one or the other
    // and never both, which is what stops a microphone being offered as a
    // system-audio source.
    assert!(speakers.is(Which::Loopback));
    assert!(!speakers.is(Which::Microphone));
}

#[test]
fn an_identifier_that_is_on_no_endpoint_resolves_to_nothing() {
    // R1.5: an identifier stored on one machine means nothing on another, so
    // failing to find it is an ordinary answer rather than an error.
    assert!(by_id(&machine(), "{mic-from-another-machine}").is_none());
}

#[test]
fn each_end_of_the_machine_has_its_own_default() {
    let devices = machine();

    assert_eq!(
        default_of(&devices, Which::Microphone).map(|d| d.id.as_str()),
        Some("{mic-webcam}")
    );
    assert_eq!(
        default_of(&devices, Which::Loopback).map(|d| d.id.as_str()),
        Some("{out-speakers}")
    );
}

#[test]
fn a_machine_with_no_endpoint_for_one_direction_has_no_default_for_it() {
    // A desktop with no microphone at all. R1.3 falls back to the default;
    // there being none is the case that has to answer rather than panic.
    let devices = vec![device("{out-speakers}", "Speakers", Which::Loopback, true)];

    assert!(default_of(&devices, Which::Microphone).is_none());
    assert!(default_of(&devices, Which::Loopback).is_some());
}

#[test]
fn the_direction_label_round_trips() {
    // `kind` is written into the reply on one side of the process boundary and
    // read back on the other. The two spellings have to agree, and this is the
    // only place that says so.
    for which in [Which::Microphone, Which::Loopback] {
        assert_eq!(Which::from_kind(which.kind()), Some(which));
    }
    assert_eq!(Which::from_kind("render"), None);
}

#[test]
fn a_track_is_named_for_the_end_of_the_machine_it_records() {
    assert_eq!(Which::Microphone.track(), "mic");
    assert_eq!(Which::Loopback.track(), "system");
}
