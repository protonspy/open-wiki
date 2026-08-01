use std::path::{Path, PathBuf};

use crate::capture::CaptureSource;
use crate::clock::Clock;
use crate::manifest::{RecordingManifest, TrackInfo, Tracks};
use crate::rpc::{error, DeviceInfo, Payload, Request, Response, StatusPayload};
use crate::session::{Session, State};

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
        }
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
                if let Err(e) = self.mic.start().and_then(|()| self.system.start()) {
                    return error(format!("could not start capture: {e}"));
                }
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
            },
            system: TrackInfo {
                file: "system.wav".into(),
                sample_rate: session.system().sample_rate(),
                channels: session.system().channels(),
                frames: session.system().frames_written(),
            },
        },
        first_frames: session.first_frames(),
        pauses: session.pauses().to_vec(),
        device_changes: session.device_changes().to_vec(),
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
