//! The capture thread is paced by something, whatever the source does.
//!
//! `ThreadedSource` has no sleep of its own on the path that succeeds: a real
//! device blocks inside `poll` waiting on its event handle, and that wait *is*
//! the loop's cadence. Any source that answers instantly therefore spins the
//! thread at full tilt — which is what a track whose endpoint was lost does,
//! for the rest of the recording, since it can no longer reach the wait.
//!
//! The cost is a pinned core for an hour with nothing to show for it, and
//! nothing in this repository can catch it by looking at a WASAPI source,
//! because none of them can be constructed here. So it is asserted about the
//! thread instead, over a source that answers instantly by construction.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use recorder::capture::{AudioFormat, CaptureError, CaptureSource, Poll};
use recorder::pump::ThreadedSource;

fn format() -> AudioFormat {
    AudioFormat {
        sample_rate: 1_000,
        channels: 1,
    }
}

/// A source that answers immediately and never blocks — the shape a lost
/// endpoint takes, and the shape that has no cadence of its own.
struct Instant {
    polls: Arc<AtomicU64>,
    answer: Poll,
}

impl CaptureSource for Instant {
    fn format(&self) -> AudioFormat {
        format()
    }

    fn device_name(&self) -> String {
        "Headset Microphone".into()
    }

    fn poll(&mut self) -> Result<Poll, CaptureError> {
        self.polls.fetch_add(1, Ordering::Relaxed);
        Ok(self.answer.clone())
    }
}

/// How many polls a paced loop can manage in the window below. The pause is
/// 2 ms, so a paced thread manages a few hundred at the very most; an unpaced
/// one manages millions. The threshold is deliberately far from both, so this
/// fails on a spin and never on a slow machine.
const CEILING: u64 = 5_000;
const WINDOW: Duration = Duration::from_millis(300);

fn polls_in_the_window(answer: Poll) -> u64 {
    let polls = Arc::new(AtomicU64::new(0));
    let counter = Arc::clone(&polls);
    let mut source = ThreadedSource::spawn(format(), move || {
        Ok(Instant {
            polls: counter,
            answer,
        })
    });

    source
        .wait_until_open(Duration::from_secs(2))
        .expect("the source opens");
    source.start().expect("and starts");
    std::thread::sleep(WINDOW);
    let counted = polls.load(Ordering::Relaxed);
    source.stop();
    counted
}

#[test]
fn a_lost_track_does_not_spin_the_capture_thread() {
    // The regression this file exists for. A lost endpoint answers instantly
    // and forever — the session records the loss once and the track is padded
    // with silence — and the thread behind it must idle rather than burn.
    let polls = polls_in_the_window(Poll::DeviceLost {
        device: "Headset Microphone".into(),
    });

    assert!(
        polls < CEILING,
        "the capture thread spun on a lost endpoint: {polls} polls in {WINDOW:?}"
    );
    assert!(polls > 0, "and it did keep polling");
}

#[test]
fn an_idle_track_does_not_spin_the_capture_thread() {
    // The same guarantee for the ordinary case. Loopback is idle for most of
    // most meetings, and a source that returned `Idle` without waiting would
    // cost exactly as much as a lost one.
    let polls = polls_in_the_window(Poll::Idle);

    assert!(
        polls < CEILING,
        "the capture thread spun on an idle device: {polls} polls in {WINDOW:?}"
    );
}

#[test]
fn a_track_that_is_delivering_audio_is_not_slowed_down() {
    // The other half: the pause is only for polls that brought nothing. While
    // audio is flowing the drain has to stay prompt, which is the entire
    // reason this thread exists — a drain that falls behind is how WASAPI
    // comes to overwrite frames nobody collected.
    let polls = polls_in_the_window(Poll::Frames {
        wall_ns: 0,
        samples: vec![0.5; 32],
    });

    assert!(
        polls > CEILING,
        "a source with audio to give was paced anyway: only {polls} polls in {WINDOW:?}"
    );
}
