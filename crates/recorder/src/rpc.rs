use serde::{Deserialize, Serialize};

use crate::capture::Which;
use crate::endpoint::Endpoint;

/// The sidecar's whole contract (plan 4.5, `adr:0005-wasapi-capture-in-a-minimal-sidecar`).
///
/// Six methods, and the ADR is explicit that a seventh deserves a record that
/// supersedes it rather than one more line in this enum. Everything else —
/// preprocessing, transcription, writing, MCP — lives on the JavaScript side.
///
/// One JSON object per line, in and out: a framing a test can drive with a
/// string and a person can drive by typing.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "method", rename_all = "lowercase")]
pub enum Request {
    Start(StartParams),
    Pause,
    Resume,
    Stop,
    Status,
    Devices,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct StartParams {
    /// What is being recorded. 4.16 builds the source id from this plus the
    /// date; the recorder only carries it into the manifest.
    #[serde(default)]
    pub title: String,
    /// Where to write `mic.wav`, `system.wav` and `manifest.json`.
    pub dir: String,
    /// Which endpoint the microphone track captures (R1.2). Absent means
    /// follow the Windows default (R1.3), which is what every caller written
    /// before this field did and still does.
    #[serde(default)]
    pub mic: Option<String>,
    /// Which endpoint the system track captures (R1.2). Absent means follow
    /// the Windows default.
    #[serde(default)]
    pub system: Option<String>,
}

impl StartParams {
    /// The choice for one end of the machine.
    ///
    /// An absent identifier is `Default` rather than an error: two tracks are
    /// chosen independently (R1.2), and pinning one must not force the other.
    pub fn endpoint(&self, which: Which) -> Endpoint {
        let chosen = match which {
            Which::Microphone => self.mic.as_deref(),
            Which::Loopback => self.system.as_deref(),
        };
        match chosen {
            Some(id) if !id.is_empty() => Endpoint::Pinned(id.to_string()),
            _ => Endpoint::Default,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "ok")]
pub enum Response {
    #[serde(rename = "true")]
    Ok(Payload),
    #[serde(rename = "false")]
    Err { error: String },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Payload {
    Status(StatusPayload),
    Devices { devices: Vec<DeviceInfo> },
    Done { done: bool },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StatusPayload {
    pub state: String,
    /// How much of the recording exists, in milliseconds. Not elapsed wall
    /// time: a paused recording's length stops growing, which is what a
    /// person watching the number expects.
    pub recorded_ms: u64,
    pub mic_frames: u64,
    pub system_frames: u64,
    pub pauses: usize,
    /// Samples that reached this process and were dropped because the queue
    /// was full, and the number of times Windows reported it had overwritten
    /// frames nobody collected. Both zero on a clean recording; either
    /// non-zero means silence in the file that was never silence in the room.
    pub dropped_samples: u64,
    pub discontinuities: u64,
    /// Set when a capture thread has stopped working.
    pub capture_fault: Option<String>,
    pub device_changes: usize,
    /// Tracks whose chosen endpoint went away and was not replaced (R2.3). A
    /// track named here is recording manufactured silence, and saying so while
    /// the meeting is still running is the whole point — afterwards the
    /// minutes are already lost.
    pub lost_tracks: Vec<String>,
    /// What each track is hearing right now (R4.1).
    ///
    /// It rides this poll rather than becoming a notification stream: push is
    /// the better shape for a value that changes twenty times a second, and it
    /// costs a second framing mode on a line protocol that has exactly one.
    /// The poll is already here, already tested, and already governed by the
    /// rule that it must never start the sidecar.
    pub mic_level: TrackLevel,
    pub system_level: TrackLevel,
}

/// One track's level over the last fraction of a second (R4.1, R4.2).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct TrackLevel {
    /// The loudest sample in the window — what a person sees as a transient.
    pub peak: f32,
    /// The root-mean-square of it — what a person hears as loudness.
    pub rms: f32,
    /// Whether the window held nothing but literal silence. Not a threshold:
    /// a quiet room is not a dead microphone, and R4.3 compares the two tracks
    /// rather than judging either alone.
    pub silent: bool,
}

impl Default for TrackLevel {
    /// What a track that is not capturing reads.
    ///
    /// **Written out rather than derived**, because `bool::default()` is
    /// `false` and that would have an idle recorder report *signal* on both
    /// tracks. It is the same answer an empty `Meter` gives — nothing has been
    /// captured, so nothing but silence has been captured — and the two have
    /// to agree, or the level jumps the instant recording starts.
    fn default() -> Self {
        Self {
            peak: 0.0,
            rms: 0.0,
            silent: true,
        }
    }
}

/// One endpoint the machine offers (R1.1).
///
/// The identifier is the endpoint's own, stable across reboots and across a
/// device being unplugged and put back — which is what makes a choice worth
/// storing at all. The name is for a person to read and is not stable: Windows
/// renames endpoints when a driver updates, so nothing matches on it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    /// `capture` for a microphone, `loopback` for what the machine is playing.
    /// Written from `Which::kind`, which is the one authority on the spelling.
    pub kind: String,
    pub default: bool,
}

impl DeviceInfo {
    /// Is this endpoint one this end of the machine could capture?
    pub fn is(&self, which: Which) -> bool {
        self.kind == which.kind()
    }
}

/// The endpoint with this identifier, whatever its direction.
///
/// Identifiers are unique across directions, so the direction is not part of
/// the lookup — and a caller that has an id from settings does not necessarily
/// know which end of the machine it belongs to.
pub fn by_id<'a>(devices: &'a [DeviceInfo], id: &str) -> Option<&'a DeviceInfo> {
    devices.iter().find(|d| d.id == id)
}

/// The Windows default endpoint for this end of the machine, if it has one.
pub fn default_of(devices: &[DeviceInfo], which: Which) -> Option<&DeviceInfo> {
    devices.iter().find(|d| d.is(which) && d.default)
}

/// Parse one line. A malformed line is an error response, never a panic and
/// never a silent skip: the caller is a program that will otherwise wait
/// forever for a reply.
pub fn parse(line: &str) -> Result<Request, String> {
    serde_json::from_str::<Request>(line).map_err(|e| format!("bad request: {e}"))
}

pub fn render(response: &Response) -> String {
    serde_json::to_string(response).unwrap_or_else(|e| {
        format!("{{\"ok\":\"false\",\"error\":\"could not serialise the response: {e}\"}}")
    })
}

pub fn error(message: impl Into<String>) -> Response {
    Response::Err {
        error: message.into(),
    }
}
