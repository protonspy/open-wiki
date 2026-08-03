use std::path::{Path, PathBuf};

use crate::capture::{CaptureSource, Which};
use crate::clock::Clock;
use crate::endpoint::Endpoint;
use crate::manifest::{RecordingManifest, TrackInfo, Tracks};
use crate::rpc::{
    error, DeviceInfo, Payload, Request, Response, StartParams, StatusPayload, TrackLevel,
};
use crate::session::{Session, State};

/// The six methods of 4.5, over a session and two devices.
///
/// It is a plain function of a request, so a test drives the whole contract
/// without a process: `main.rs` is left with real stdin and a real exit code,
/// which are the only two things a test cannot have.
/// Opens a capture source for one end of the machine, on a chosen endpoint.
///
/// The sidecar opens both devices when it launches, before anybody has said
/// what to record — so honouring an endpoint named on `start` (R1.2) means
/// opening a new source then. This is how the service does that without
/// knowing what WASAPI is.
pub type OpenSource =
    Box<dyn Fn(Which, &Endpoint) -> Result<Box<dyn CaptureSource>, String> + Send>;

/// The six methods of 4.5, over a session and two devices.
///
/// It is a plain function of a request, so a test drives the whole contract
/// without a process: `main.rs` is left with real stdin and a real exit code,
/// which are the only two things a test cannot have.
pub struct Service<C: Clock> {
    make_clock: fn() -> C,
    session: Option<Session<C>>,
    mic: Box<dyn CaptureSource>,
    system: Box<dyn CaptureSource>,
    dir: Option<PathBuf>,
    devices: fn() -> Result<Vec<DeviceInfo>, String>,
    open: Option<OpenSource>,
}

impl<C: Clock> Service<C> {
    pub fn new(
        make_clock: fn() -> C,
        mic: Box<dyn CaptureSource>,
        system: Box<dyn CaptureSource>,
        devices: fn() -> Result<Vec<DeviceInfo>, String>,
    ) -> Self {
        Self {
            make_clock,
            session: None,
            mic,
            system,
            dir: None,
            devices,
            open: None,
        }
    }

    /// Teach the service how to open a source on a named endpoint.
    ///
    /// Without this a `start` that names an endpoint is **refused**, never
    /// quietly served with the device that happens to be open. Recording the
    /// default in place of a chosen microphone is the failure the whole spec
    /// exists to prevent, and it would be worst here, where nothing is wrong
    /// yet and nobody is watching.
    pub fn reopening_with(mut self, open: OpenSource) -> Self {
        self.open = Some(open);
        self
    }

    /// Put each track on the endpoint that was asked for, opening a new source
    /// where the one in hand is not it (R1.2, R1.3).
    fn honour(&mut self, params: &StartParams) -> Result<(), String> {
        // Open everything first, install nothing until all of it succeeded.
        //
        // Assigning as each track resolved meant a microphone that resolved
        // and a system endpoint that did not left the microphone swapped onto
        // a source nobody had asked to record with, under a `start` that was
        // then refused. Nothing observed it, because the mismatch corrects
        // itself on the next `start` — which is precisely what makes it worth
        // closing rather than leaving: a refusal has to leave the recorder
        // exactly as it was, and "exactly" is the whole claim.
        let mut opened: Vec<(Which, Box<dyn CaptureSource>)> = Vec::new();
        for which in [Which::Microphone, Which::Loopback] {
            let choice = params.endpoint(which);
            let current = match which {
                Which::Microphone => self.mic.endpoint(),
                Which::Loopback => self.system.endpoint(),
            };
            if current.satisfies(&choice) {
                continue;
            }
            let Some(open) = self.open.as_ref() else {
                return Err(format!(
                    "this recorder cannot change the {} endpoint",
                    which.track()
                ));
            };
            // A failure here is R2.4: the endpoint named is not on this
            // machine, and `resolve` has already put its identifier in the
            // message.
            opened.push((which, open(which, &choice)?));
        }
        for (which, fresh) in opened {
            match which {
                Which::Microphone => self.mic = fresh,
                Which::Loopback => self.system = fresh,
            }
        }
        Ok(())
    }

    pub fn session(&self) -> Option<&Session<C>> {
        self.session.as_ref()
    }

    /// Poll the devices once. The caller loops on this between requests.
    pub fn pump(&mut self) {
        if let Some(session) = self.session.as_mut() {
            // A read error is not the end of the recording: the track is padded
            // over it and the meeting keeps going, which is the only outcome
            // that does not lose the part already captured.
            let _ = session.pump(self.mic.as_mut(), self.system.as_mut());
        }
    }

    pub fn handle(&mut self, request: Request) -> Response {
        match request {
            Request::Start(params) => {
                if self.session.is_some() {
                    return error("already recording");
                }
                // **First**, before the directory exists and before any device
                // is touched: a chosen endpoint that is not here refuses the
                // recording and names it (R2.4). The alternative is an hour
                // recorded on the wrong microphone, which nothing downstream
                // can detect or undo.
                //
                // The order is the requirement, not tidiness. Creating the
                // directory first left an empty one under `raw/` for every
                // refusal, and `raw/` is where sources live — so a refused
                // recording became a directory somebody has to recognise as
                // debris rather than as a source that failed to transcribe.
                if let Err(e) = self.honour(&params) {
                    return error(e);
                }
                let dir = PathBuf::from(&params.dir);
                if let Err(e) = std::fs::create_dir_all(&dir) {
                    return error(format!("could not create {}: {e}", dir.display()));
                }
                let mic_format = self.mic.format();
                let sys_format = self.system.format();
                let mut session = Session::start(
                    (self.make_clock)(),
                    &params.title,
                    mic_format.sample_rate,
                    mic_format.channels,
                    sys_format.sample_rate,
                    sys_format.channels,
                );
                if let Err(e) = session.attach_files(&dir) {
                    return error(format!("could not open the track files: {e}"));
                }
                if let Err(e) = self.mic.start() {
                    return error(format!("could not start the microphone: {e}"));
                }
                if let Err(e) = self.system.start() {
                    // Roll the first one back. Leaving it running puts the pair
                    // in mixed states, and the next start or resume then fails
                    // with AUDCLNT_E_NOT_STOPPED on a device nobody asked for.
                    self.mic.stop();
                    return error(format!("could not start system audio: {e}"));
                }
                // What each track is actually capturing, taken from the
                // devices themselves rather than from what was asked for: a
                // following track's endpoint is whatever Windows gave, and the
                // manifest records what happened (R3.3).
                session.capturing(self.mic.endpoint(), self.system.endpoint());
                self.dir = Some(dir);
                self.session = Some(session);
                self.status()
            }

            Request::Pause => match self.session.as_mut() {
                Some(session) => {
                    session.pause(self.mic.as_mut(), self.system.as_mut());
                    self.status()
                }
                None => error("not recording"),
            },

            Request::Resume => match self.session.as_mut() {
                Some(session) => match session.resume(self.mic.as_mut(), self.system.as_mut()) {
                    Ok(()) => self.status(),
                    Err(e) => error(format!("could not resume: {e}")),
                },
                None => error("not recording"),
            },

            Request::Stop => {
                let Some(session) = self.session.as_mut() else {
                    return error("not recording");
                };
                session.stop(self.mic.as_mut(), self.system.as_mut());

                let dir = self.dir.clone().unwrap_or_default();
                // Both tracks, then the manifest, whatever failed. Returning
                // on the first error skipped the second track's header *and*
                // the manifest — and the title, the first frames, the pauses
                // and the whole time map are not reconstructible from two WAV
                // files. The audio mostly survives a missing finalize; that
                // metadata does not survive a missing manifest.
                let mut problems = session.finalize_files();
                if let Err(e) = write_manifest(session, &dir) {
                    problems.push(format!("manifest: {e}"));
                }
                self.session = None;
                self.dir = None;
                if problems.is_empty() {
                    Response::Ok(Payload::Done { done: true })
                } else {
                    error(format!(
                        "the recording stopped with problems: {}",
                        problems.join("; ")
                    ))
                }
            }

            Request::Status => self.status(),

            Request::Devices => match (self.devices)() {
                Ok(devices) => Response::Ok(Payload::Devices { devices }),
                Err(e) => error(e),
            },
        }
    }

    pub fn status(&self) -> Response {
        let Some(session) = self.session.as_ref() else {
            return Response::Ok(Payload::Status(StatusPayload {
                state: "idle".into(),
                recorded_ms: 0,
                mic_frames: 0,
                system_frames: 0,
                pauses: 0,
                device_changes: 0,
                lost_tracks: Vec::new(),
                // Nothing is being captured, so the level is not "quiet" — it
                // is absent, and zero is how this protocol says that.
                mic_level: TrackLevel::default(),
                system_level: TrackLevel::default(),
                dropped_samples: 0,
                discontinuities: 0,
                capture_fault: None,
            }));
        };
        Response::Ok(Payload::Status(StatusPayload {
            state: match session.state() {
                State::Recording => "recording",
                State::Paused => "paused",
                State::Stopped => "stopped",
            }
            .into(),
            // The recording's own length, not elapsed wall time: a paused
            // recording stops growing, which is what someone watching expects.
            recorded_ms: session.recorded_ns() / 1_000_000,
            mic_frames: session.mic().frames_written(),
            system_frames: session.system().frames_written(),
            pauses: session.pauses().len(),
            device_changes: session.device_changes().len(),
            lost_tracks: session.lost_tracks(),
            mic_level: session.mic_level().reading(),
            system_level: session.system_level().reading(),
            // What the recording lost, and whether either device has stopped
            // working. Silence that nobody flagged is the failure this whole
            // sidecar has to avoid presenting as a healthy hour.
            dropped_samples: self.mic.dropped_samples() + self.system.dropped_samples(),
            discontinuities: self.mic.discontinuities() + self.system.discontinuities(),
            capture_fault: match (self.mic.health(), self.system.health()) {
                (Err(e), _) => Some(format!("microphone: {e}")),
                (_, Err(e)) => Some(format!("system audio: {e}")),
                _ => None,
            },
        }))
    }
}

pub fn manifest_of<C: Clock>(session: &Session<C>) -> RecordingManifest {
    RecordingManifest {
        kind: "recording".into(),
        title: session.title().to_string(),
        started_wall_ns: session.started_wall_ns(),
        tracks: Tracks {
            mic: TrackInfo {
                file: "mic.wav".into(),
                sample_rate: session.mic().sample_rate(),
                channels: session.mic().channels(),
                frames: session.mic().frames_written(),
                endpoint: session.mic_endpoint().clone(),
            },
            system: TrackInfo {
                file: "system.wav".into(),
                sample_rate: session.system().sample_rate(),
                channels: session.system().channels(),
                frames: session.system().frames_written(),
                endpoint: session.system_endpoint().clone(),
            },
        },
        first_frames: session.first_frames(),
        pauses: session.pauses().to_vec(),
        device_changes: session.device_changes().to_vec(),
        device_losses: session.device_losses().to_vec(),
        time_map: session.time_map().clone(),
    }
}

fn write_manifest<C: Clock>(session: &Session<C>, dir: &Path) -> std::io::Result<()> {
    let manifest = manifest_of(session);
    let json = manifest
        .to_json()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(dir.join("manifest.json"), json + "\n")
}
