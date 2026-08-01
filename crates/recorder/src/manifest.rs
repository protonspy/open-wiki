use serde::{Deserialize, Serialize};

use crate::session::{DeviceChange, FirstFrames, PauseInterval};
use crate::timemap::TimeMap;

/// The recording's `manifest.json` (plan 4.4).
///
/// It carries the title, the absolute instant each track's first frame landed,
/// and the pause intervals — the three things nothing downstream can work out
/// for itself once the recorder has exited. The time map rides along because
/// 4.7 and 4.11 rebuild absolute timestamps from it, and the device changes
/// because a track that switched microphones halfway explains a lot about how
/// it sounds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecordingManifest {
    /// Always `recording`, so a reader can tell it from an uploaded file's
    /// manifest without guessing from the fields.
    pub kind: String,
    pub title: String,
    /// When the session began, in nanoseconds since the Unix epoch.
    pub started_wall_ns: u64,
    pub tracks: Tracks,
    /// The absolute instant of each track's first frame.
    pub first_frames: FirstFrames,
    pub pauses: Vec<PauseInterval>,
    pub device_changes: Vec<DeviceChange>,
    pub time_map: TimeMap,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tracks {
    pub mic: TrackInfo,
    pub system: TrackInfo,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrackInfo {
    pub file: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub frames: u64,
}

impl RecordingManifest {
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }
}
