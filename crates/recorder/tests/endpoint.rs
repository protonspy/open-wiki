//! Choosing an endpoint (R1.2, R1.3), and refusing rather than substituting
//! when the chosen one is not there (R2.4).

use recorder::capture::Which;
use recorder::endpoint::{resolve, Endpoint};
use recorder::rpc::DeviceInfo;

fn device(id: &str, name: &str, which: Which, default: bool) -> DeviceInfo {
    DeviceInfo {
        id: id.into(),
        name: name.into(),
        kind: which.kind().into(),
        default,
    }
}

/// A webcam microphone Windows prefers, a headset that arrived second, and one
/// render endpoint. The situation the spec's purpose is written about.
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
fn where_no_choice_has_been_made_the_windows_default_is_captured() {
    // R1.3. This is the behaviour every existing caller has today, and it has
    // to survive being made one mode among two.
    let devices = machine();
    let chosen = resolve(&Endpoint::Default, &devices, Which::Microphone)
        .expect("a machine with a microphone resolves the default");

    assert_eq!(chosen.id, "{mic-webcam}");
}

#[test]
fn a_chosen_endpoint_is_captured_instead_of_the_default() {
    // R1.2, and the whole point of the spec: the headset is not the Windows
    // default and is what the meeting is on.
    let devices = machine();
    let chosen = resolve(
        &Endpoint::Pinned("{mic-headset}".into()),
        &devices,
        Which::Microphone,
    )
    .expect("the headset is on this machine");

    assert_eq!(chosen.id, "{mic-headset}");
    assert_eq!(chosen.name, "Headset Microphone");
}

#[test]
fn the_two_directions_are_chosen_independently() {
    // R1.2 says "independently": pinning the microphone must not disturb what
    // the system track captures.
    let devices = machine();
    let mic = resolve(
        &Endpoint::Pinned("{mic-headset}".into()),
        &devices,
        Which::Microphone,
    )
    .expect("the headset resolves");
    let system =
        resolve(&Endpoint::Default, &devices, Which::Loopback).expect("the speakers resolve");

    assert_eq!(mic.id, "{mic-headset}");
    assert_eq!(system.id, "{out-speakers}");
}

#[test]
fn a_chosen_endpoint_that_is_not_on_this_machine_is_named_rather_than_replaced() {
    // R2.4. The identifier is machine-local (R1.5), so this is the ordinary
    // outcome of opening the project on a second machine — and answering it
    // with the default is the failure the whole spec is about.
    let devices = machine();
    let refused = resolve(
        &Endpoint::Pinned("{mic-from-another-machine}".into()),
        &devices,
        Which::Microphone,
    )
    .expect_err("an endpoint that is not here cannot resolve");

    assert!(
        refused.contains("{mic-from-another-machine}"),
        "the refusal has to name the endpoint that is missing, got: {refused}"
    );
}

#[test]
fn a_chosen_endpoint_of_the_wrong_direction_is_refused() {
    // A microphone opened as system audio records the room under the name of
    // the call, and reads as a working recording in every number reported.
    let devices = machine();
    let refused = resolve(
        &Endpoint::Pinned("{mic-headset}".into()),
        &devices,
        Which::Loopback,
    )
    .expect_err("a microphone is not a system-audio endpoint");

    assert!(
        refused.contains("system"),
        "the refusal has to say which track it is about, got: {refused}"
    );
}

#[test]
fn a_machine_with_no_default_for_a_direction_says_so_rather_than_guessing() {
    // A desktop with no microphone. R1.3 has nothing to fall back to, and
    // silently recording nothing is what this refuses.
    let devices = vec![device("{out-speakers}", "Speakers", Which::Loopback, true)];
    let refused = resolve(&Endpoint::Default, &devices, Which::Microphone)
        .expect_err("there is no microphone to default to");

    assert!(
        refused.contains("mic"),
        "the refusal has to say which track it is about, got: {refused}"
    );
}

#[test]
fn following_and_pinning_are_distinguishable_without_resolving_anything() {
    // R2.1 and R2.2 branch on this, and so does what the manifest records
    // (R3.3). A mode that cannot be read back is a mode nothing can act on.
    assert!(!Endpoint::Default.is_pinned());
    assert_eq!(Endpoint::Default.pinned_id(), None);

    let pinned = Endpoint::Pinned("{mic-headset}".into());
    assert!(pinned.is_pinned());
    assert_eq!(pinned.pinned_id(), Some("{mic-headset}"));
}
