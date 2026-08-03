//! The signal level of a track, over a short trailing window (R4.1, R4.2,
//! R4.4).
//!
//! **It never opens anything.** The frames are already on their way to the WAV
//! writer, and a level is arithmetic over them — that is R4.4, and it is also
//! the correction to the reasoning that originally put metering out of scope:
//! the cost that justified excluding it was a second consumer of the endpoint,
//! and there is no second consumer.
//!
//! The window is short on purpose. R4.2 asks for a level that reads *as speech
//! happens*, and an average over the session is the thing it is written to
//! exclude — a meter that has been running for forty minutes barely moves when
//! somebody starts talking.

use std::collections::VecDeque;

/// How much of the recent past a level is computed over. Long enough to be
/// steady, short enough that a syllable moves it.
pub const WINDOW_MS: u32 = 200;

/// A trailing-window level meter for one track.
#[derive(Debug, Clone)]
pub struct Meter {
    /// Interleaved samples still inside the window, oldest first.
    window: VecDeque<f32>,
    /// How many samples the window holds. Interleaved, so channels are part
    /// of it: a level is about the track, not about one channel of it.
    capacity: usize,
}

impl Meter {
    /// A meter over the last `window_ms` of a track at this rate.
    pub fn new(sample_rate: u32, channels: u16, window_ms: u32) -> Self {
        let capacity = (u64::from(sample_rate) * u64::from(channels) * u64::from(window_ms) / 1_000)
            .max(1) as usize;
        Self {
            window: VecDeque::with_capacity(capacity),
            capacity,
        }
    }

    /// A meter over the default window.
    pub fn for_track(sample_rate: u32, channels: u16) -> Self {
        Self::new(sample_rate, channels, WINDOW_MS)
    }

    /// Take frames that have just been captured.
    pub fn push(&mut self, samples: &[f32]) {
        // A push longer than the window is entirely the recent past bar its
        // tail: keep the newest, because the head describes a moment that has
        // already gone.
        let keep = samples.len().min(self.capacity);
        for &sample in &samples[samples.len() - keep..] {
            if self.window.len() == self.capacity {
                self.window.pop_front();
            }
            self.window.push_back(sample);
        }
    }

    /// The loudest sample in the window, as a magnitude.
    pub fn peak(&self) -> f32 {
        self.window
            .iter()
            .fold(0.0f32, |loudest, &s| loudest.max(s.abs()))
    }

    /// The root-mean-square of the window — what a person hears as loudness,
    /// where the peak is what a person sees as a transient.
    pub fn rms(&self) -> f32 {
        if self.window.is_empty() {
            return 0.0;
        }
        // In f64: an hour of f32 accumulation drifts, and this is summed
        // afresh each time only because the window is small.
        let sum: f64 = self
            .window
            .iter()
            .map(|&s| f64::from(s) * f64::from(s))
            .sum();
        (sum / self.window.len() as f64).sqrt() as f32
    }

    /// Has this track captured nothing at all across the window?
    ///
    /// Exactly zero, not a threshold. A track receiving nothing gives back
    /// literal silence, and a quiet room does not — so a threshold here would
    /// report somebody who is merely not talking as a dead microphone, which
    /// R4.3 is explicit about not doing.
    pub fn silent(&self) -> bool {
        self.window.iter().all(|&s| s == 0.0)
    }

    /// How many samples the window currently holds.
    pub fn len(&self) -> usize {
        self.window.len()
    }

    pub fn is_empty(&self) -> bool {
        self.window.is_empty()
    }
}

impl Meter {
    /// This meter as the protocol reports it (R4.1).
    pub fn reading(&self) -> crate::rpc::TrackLevel {
        crate::rpc::TrackLevel {
            peak: self.peak(),
            rms: self.rms(),
            silent: self.silent(),
        }
    }
}
