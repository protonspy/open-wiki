use std::fmt;

use crate::endpoint::CapturedEndpoint;

/// The shape of a device's audio.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioFormat {
    pub sample_rate: u32,
    pub channels: u16,
}

/// Which end of the machine a source listens to.
///
/// It lives here rather than beside WASAPI because it is a fact about the
/// recording — the microphone track and the system track — and not about the
/// API underneath. Keeping it platform-neutral is what lets the endpoint
/// choice of R1.2 and the follow/pin decision of R2.1-R2.2 be tested on every
/// platform, which is the same argument `CaptureSource` itself is here for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Which {
    /// The microphone.
    Microphone,
    /// What the machine is playing — WASAPI loopback, which is a *render*
    /// device opened for capture.
    Loopback,
}

impl Which {
    /// The track this end of the machine is written to.
    pub fn track(self) -> &'static str {
        match self {
            Which::Microphone => "mic",
            Which::Loopback => "system",
        }
    }

    /// How an endpoint of this direction is labelled in a `devices` reply
    /// (R1.1). One authority, so the string an enumeration writes and the
    /// string a choice is matched against cannot drift apart.
    pub fn kind(self) -> &'static str {
        match self {
            Which::Microphone => "capture",
            Which::Loopback => "loopback",
        }
    }

    /// Read back the direction a `devices` reply labelled an endpoint with.
    pub fn from_kind(kind: &str) -> Option<Self> {
        match kind {
            "capture" => Some(Which::Microphone),
            "loopback" => Some(Which::Loopback),
            _ => None,
        }
    }
}

/// What one poll of a device produced.
#[derive(Debug, Clone, PartialEq)]
pub enum Poll {
    /// Frames, interleaved, stamped with the wall-clock instant of the first.
    Frames { wall_ns: u64, samples: Vec<f32> },
    /// The device had nothing. For loopback this is the normal state whenever
    /// nobody is playing sound — it is not an error and not the end of the
    /// stream, and the track is padded to cover it (plan 4.1).
    Idle,
    /// The default device changed and the source reopened itself on the new
    /// one (plan 4.2). The session records it and carries on.
    DeviceChanged { device: String },
    /// The endpoint this track captures is gone and nothing replaces it
    /// (R2.3). The track is padded with silence from here on, which is the
    /// only honest outcome: a different endpoint under the same name would put
    /// a different room in the recording.
    ///
    /// A source may report this on every poll for the rest of the session —
    /// the endpoint does not come back — so the session records it once.
    DeviceLost { device: String },
}

#[derive(Debug)]
pub struct CaptureError(pub String);

impl fmt::Display for CaptureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for CaptureError {}

/// A capture device, behind a trait so the session can be tested without one.
///
/// This is the only part of the recorder that touches WASAPI, and it is
/// deliberately the thinnest part: everything that can be wrong in a way nobody
/// notices — the alignment, the silence, the time map, the pause arithmetic —
/// sits above this line and under test.
pub trait CaptureSource {
    fn format(&self) -> AudioFormat;
    fn device_name(&self) -> String;
    /// Take whatever the device has now. Never blocks for long.
    fn poll(&mut self) -> Result<Poll, CaptureError>;
    /// Stop the underlying stream. Called on stop and on pause.
    fn stop(&mut self) {}
    /// Restart the stream after a pause. Idempotent.
    fn start(&mut self) -> Result<(), CaptureError> {
        Ok(())
    }
    /// How many times the device reported it had overwritten frames nobody
    /// collected. An **event** count, not a frame count — Windows says that a
    /// gap happened, not how big it was.
    fn discontinuities(&self) -> u64 {
        0
    }
    /// Samples that reached this process and were then thrown away because the
    /// queue was full. A recording that lost audio must be able to say so
    /// rather than presenting manufactured silence as the real thing.
    fn dropped_samples(&self) -> u64 {
        0
    }
    /// `Err` when capture has stopped working. A source that has died must not
    /// look like one that is merely silent.
    fn health(&self) -> Result<(), String> {
        Ok(())
    }
    /// The endpoint this source is capturing, and whether somebody chose it
    /// (R3.3). The default answer is the device's own name in following mode,
    /// which is what a source that has no notion of a choice is doing.
    fn endpoint(&self) -> CapturedEndpoint {
        CapturedEndpoint {
            id: None,
            name: self.device_name(),
            pinned: false,
        }
    }
}

/// A scripted source, for tests and for `--self-test`.
pub struct ScriptedSource {
    format: AudioFormat,
    device: String,
    script: Vec<Poll>,
    next: usize,
    pub started: usize,
    pub stopped: usize,
}

impl ScriptedSource {
    pub fn new(format: AudioFormat, device: &str, script: Vec<Poll>) -> Self {
        Self {
            format,
            device: device.to_string(),
            script,
            next: 0,
            started: 0,
            stopped: 0,
        }
    }
}

impl CaptureSource for ScriptedSource {
    fn format(&self) -> AudioFormat {
        self.format
    }

    fn device_name(&self) -> String {
        self.device.clone()
    }

    fn poll(&mut self) -> Result<Poll, CaptureError> {
        let item = self.script.get(self.next).cloned().unwrap_or(Poll::Idle);
        if self.next < self.script.len() {
            self.next += 1;
        }
        if let Poll::DeviceChanged { device } = &item {
            self.device = device.clone();
        }
        Ok(item)
    }

    fn stop(&mut self) {
        self.stopped += 1;
    }

    fn start(&mut self) -> Result<(), CaptureError> {
        self.started += 1;
        Ok(())
    }
}
