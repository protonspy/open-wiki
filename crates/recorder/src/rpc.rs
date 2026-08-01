use serde::{Deserialize, Serialize};

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
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    /// `capture` for a microphone, `loopback` for what the machine is playing.
    pub kind: String,
    pub default: bool,
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
