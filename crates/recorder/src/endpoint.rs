//! Which endpoint a track captures, and what to do when that changes.
//!
//! This is the whole of R1.2, R1.3, R2.1 and R2.2, deliberately kept above
//! `WasapiSource` and free of COM. The capture layer is the one part of the
//! recorder no test in this repository can exercise — CI has no audio device
//! and never will — so the decisions that can be *wrong* are made here, on
//! plain data, and the layer below is left with opening what it is told to.

use serde::{Deserialize, Serialize};

use crate::capture::Which;
use crate::rpc::{by_id, default_of, DeviceInfo};

/// The endpoint a track actually captured, for the manifest (R3.3).
///
/// The *mode* is here as well as the endpoint, and it is the half that cannot
/// be reconstructed afterwards. Two recordings can name the same microphone
/// and mean different things: one was told to use it, the other happened to
/// get it because Windows preferred it that day.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct CapturedEndpoint {
    /// The endpoint's identifier. Absent where the source could not read one —
    /// it means nothing off this machine anyway (R1.5), so it is recorded for
    /// diagnosis rather than for matching later.
    pub id: Option<String>,
    /// Its display name, as it was when the recording started.
    pub name: String,
    /// Whether somebody chose this endpoint (R1.2), or it is whatever Windows
    /// preferred (R1.3).
    pub pinned: bool,
}

impl CapturedEndpoint {
    /// Is the device already open on what this choice asks for?
    ///
    /// Decides whether a `start` has to reopen anything. It compares the
    /// *mode* as well as the identifier, because a track that happens to sit
    /// on the endpoint somebody pinned is still only following it, and will
    /// walk off it the moment Windows changes its mind — R2.1 against R2.2, at
    /// the one moment the difference is cheap to fix.
    pub fn satisfies(&self, choice: &Endpoint) -> bool {
        match choice {
            Endpoint::Default => !self.pinned,
            Endpoint::Pinned(id) => self.pinned && self.id.as_deref() == Some(id.as_str()),
        }
    }
}

/// Which endpoint a track captures.
///
/// The two are different modes and not two spellings of one (R2.1, R2.2). A
/// track that follows the default is *asking* to be moved when Windows moves
/// it; a pinned track has had somebody choose, and moving it is the failure
/// R2.3 exists to refuse.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Endpoint {
    /// Follow the Windows default for this direction (R1.3).
    #[default]
    Default,
    /// Capture this endpoint and no other (R2.2).
    Pinned(String),
}

impl Endpoint {
    /// The identifier somebody chose, if they chose one.
    pub fn pinned_id(&self) -> Option<&str> {
        match self {
            Endpoint::Default => None,
            Endpoint::Pinned(id) => Some(id),
        }
    }

    pub fn is_pinned(&self) -> bool {
        matches!(self, Endpoint::Pinned(_))
    }
}

/// What a track should do about the endpoint it is currently on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// Stay where it is.
    Keep,
    /// Open this endpoint instead, and write the move down — the default moved
    /// and this track follows it (R2.1).
    MoveTo(String),
    /// Open the same endpoint again without reporting a move. The stream
    /// broke; the choice did not change.
    Reopen,
    /// The endpoint this track captures is gone, and there is no substitute
    /// for it (R2.3).
    Lost,
}

/// Decide what a track does about its endpoint.
///
/// This is where "pinned does not follow" is actually decided (R2.1, R2.2),
/// which is why it is a function of plain data rather than three branches
/// inside a COM object nothing can construct in a test.
pub fn next_action(
    choice: &Endpoint,
    current_id: &str,
    devices: &[DeviceInfo],
    which: Which,
    stream_broken: bool,
) -> Action {
    match choice {
        // A pinned track has exactly one endpoint it may capture. It is gone
        // or it is not; nothing here can produce another one, and that is the
        // whole of R2.2 and R2.3.
        Endpoint::Pinned(id) => match by_id(devices, id) {
            None => Action::Lost,
            Some(_) if stream_broken || current_id != id => Action::Reopen,
            Some(_) => Action::Keep,
        },
        // A following track goes wherever Windows says (R2.1).
        Endpoint::Default => match default_of(devices, which) {
            // Nothing left of this direction to follow. Saying so beats a
            // track that reports healthy while padding the hour with silence.
            None => Action::Lost,
            Some(current) if current.id != current_id => Action::MoveTo(current.id.clone()),
            Some(_) if stream_broken => Action::Reopen,
            Some(_) => Action::Keep,
        },
    }
}

/// The endpoint to open now, or why there is none.
///
/// The error names the endpoint that is missing rather than falling back
/// (R2.4). Recording the default in place of a chosen device is the failure
/// this whole spec exists to stop, and it is worse from here than from
/// anywhere else, because at this point nobody is watching yet.
pub fn resolve<'a>(
    choice: &Endpoint,
    devices: &'a [DeviceInfo],
    which: Which,
) -> Result<&'a DeviceInfo, String> {
    match choice {
        Endpoint::Default => default_of(devices, which)
            .ok_or_else(|| format!("this machine has no default {} endpoint", which.track())),
        Endpoint::Pinned(id) => match by_id(devices, id) {
            // A chosen endpoint of the wrong direction is refused rather than
            // opened. A microphone opened as system audio records the room
            // under the name of the call, and reads as a working recording in
            // every number this program reports.
            Some(found) if !found.is(which) => Err(format!(
                "the endpoint chosen for the {} track is a {} endpoint, not a {} one",
                which.track(),
                found.kind,
                which.kind()
            )),
            Some(found) => Ok(found),
            None => Err(format!(
                "the endpoint chosen for the {} track is not on this machine: {id}",
                which.track()
            )),
        },
    }
}
