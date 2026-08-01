use std::fmt;

/// The shape of a device's audio.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioFormat {
    pub sample_rate: u32,
    pub channels: u16,
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
    /// How many frames the device reported it overwrote before anyone
    /// collected them. A recording that lost audio must be able to say so
    /// rather than presenting manufactured silence as the real thing.
    fn lost_frames(&self) -> u64 {
        0
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
