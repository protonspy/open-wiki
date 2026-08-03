//! Following the default, and not following it (R2.1, R2.2, R2.3).
//!
//! 4.2 built device-following, and it is right whenever nobody chose anything.
//! The moment somebody did, following is the failure: a chosen endpoint
//! silently replaced mid-meeting puts a different room in the recording under
//! the same name. These two are therefore separate modes, and this file is
//! where the difference between them is asserted.

use recorder::capture::Which;
use recorder::endpoint::{next_action, Action, Endpoint};
use recorder::rpc::DeviceInfo;

fn device(id: &str, name: &str, which: Which, default: bool) -> DeviceInfo {
    DeviceInfo {
        id: id.into(),
        name: name.into(),
        kind: which.kind().into(),
        default,
    }
}

/// The headset is the default and the meeting is on it.
fn headset_is_default() -> Vec<DeviceInfo> {
    vec![
        device(
            "{mic-headset}",
            "Headset Microphone",
            Which::Microphone,
            true,
        ),
        device(
            "{mic-webcam}",
            "Webcam Microphone",
            Which::Microphone,
            false,
        ),
        device("{out-speakers}", "Speakers", Which::Loopback, true),
    ]
}

/// The headset has been unplugged: Windows has promoted the webcam and the
/// headset is not on the machine at all.
fn headset_unplugged() -> Vec<DeviceInfo> {
    vec![
        device("{mic-webcam}", "Webcam Microphone", Which::Microphone, true),
        device("{out-speakers}", "Speakers", Which::Loopback, true),
    ]
}

#[test]
fn a_following_track_moves_when_the_windows_default_moves() {
    // R2.1, unchanged from 4.2: this is the behaviour that is right whenever
    // nobody chose anything, and it has to survive becoming one mode of two.
    let action = next_action(
        &Endpoint::Default,
        "{mic-headset}",
        &headset_unplugged(),
        Which::Microphone,
        false,
    );

    assert_eq!(action, Action::MoveTo("{mic-webcam}".into()));
}

#[test]
fn a_pinned_track_stays_where_it_is_when_the_windows_default_moves() {
    // R2.2. The headset is still on the machine; Windows merely prefers
    // something else now, which is not this track's concern.
    let mut devices = headset_is_default();
    devices[0].default = false;
    devices[1].default = true;

    let action = next_action(
        &Endpoint::Pinned("{mic-headset}".into()),
        "{mic-headset}",
        &devices,
        Which::Microphone,
        false,
    );

    assert_eq!(action, Action::Keep);
}

#[test]
fn a_pinned_endpoint_that_is_gone_is_lost_and_never_replaced() {
    // R2.3, and the sharpest edge in the spec. The webcam microphone is right
    // there and is the default — substituting it is exactly what must not
    // happen, because it records a different room under the same name.
    let action = next_action(
        &Endpoint::Pinned("{mic-headset}".into()),
        "{mic-headset}",
        &headset_unplugged(),
        Which::Microphone,
        false,
    );

    assert_eq!(action, Action::Lost);
}

#[test]
fn a_pinned_endpoint_that_is_gone_is_still_not_replaced_when_the_stream_broke() {
    // The same, arrived at from the other direction: the stream failing is
    // the usual way an unplug announces itself, and it must not become a
    // reason to open something else.
    let action = next_action(
        &Endpoint::Pinned("{mic-headset}".into()),
        "{mic-headset}",
        &headset_unplugged(),
        Which::Microphone,
        true,
    );

    assert_eq!(action, Action::Lost);
}

#[test]
fn a_following_track_already_on_the_default_does_nothing() {
    let action = next_action(
        &Endpoint::Default,
        "{mic-headset}",
        &headset_is_default(),
        Which::Microphone,
        false,
    );

    assert_eq!(action, Action::Keep);
}

#[test]
fn a_pinned_track_whose_stream_broke_reopens_the_same_endpoint() {
    // A sleep/resume, a driver reset, a sample-rate change in the sound
    // control panel — the endpoint is still there and still chosen. Reopening
    // it is not following, and it is not a move to write down.
    let action = next_action(
        &Endpoint::Pinned("{mic-headset}".into()),
        "{mic-headset}",
        &headset_is_default(),
        Which::Microphone,
        true,
    );

    assert_eq!(action, Action::Reopen);
}

#[test]
fn a_following_track_whose_stream_broke_on_the_current_default_reopens_it() {
    let action = next_action(
        &Endpoint::Default,
        "{mic-headset}",
        &headset_is_default(),
        Which::Microphone,
        true,
    );

    assert_eq!(action, Action::Reopen);
}

#[test]
fn a_following_track_with_no_endpoint_left_to_follow_is_lost() {
    // Every microphone removed. There is nothing to follow, and a track that
    // reports healthy here is a track padding an hour with silence.
    let devices = vec![device("{out-speakers}", "Speakers", Which::Loopback, true)];
    let action = next_action(
        &Endpoint::Default,
        "{mic-headset}",
        &devices,
        Which::Microphone,
        false,
    );

    assert_eq!(action, Action::Lost);
}

#[test]
fn a_pinned_track_is_never_moved_to_a_different_endpoint_under_any_condition() {
    // The invariant behind R2.2 and R2.3 stated once, over every combination
    // this decision is reachable with. `MoveTo` is the one answer a pinned
    // track must never get, and asserting it case by case above leaves the
    // next case somebody adds unguarded.
    let pinned = Endpoint::Pinned("{mic-headset}".into());
    for devices in [headset_is_default(), headset_unplugged(), Vec::new()] {
        for current in ["{mic-headset}", "{mic-webcam}"] {
            for broken in [false, true] {
                let action = next_action(&pinned, current, &devices, Which::Microphone, broken);
                assert!(
                    !matches!(action, Action::MoveTo(_)),
                    "a pinned track was moved: current={current}, broken={broken}, got {action:?}"
                );
            }
        }
    }
}

#[test]
fn the_loopback_side_follows_and_pins_by_the_same_rules() {
    // R2.1 and R2.2 are about a track, not about the microphone. The system
    // track is chosen independently (R1.2) and behaves the same way.
    let devices = vec![
        device("{out-headphones}", "Headphones", Which::Loopback, true),
        device("{mic-webcam}", "Webcam Microphone", Which::Microphone, true),
    ];

    assert_eq!(
        next_action(
            &Endpoint::Default,
            "{out-speakers}",
            &devices,
            Which::Loopback,
            false
        ),
        Action::MoveTo("{out-headphones}".into())
    );
    assert_eq!(
        next_action(
            &Endpoint::Pinned("{out-speakers}".into()),
            "{out-speakers}",
            &devices,
            Which::Loopback,
            false
        ),
        Action::Lost
    );
}
