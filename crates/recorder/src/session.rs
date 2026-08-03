use serde::{Deserialize, Serialize};

use crate::capture::{CaptureError, CaptureSource, Poll};
use crate::clock::Clock;
use crate::endpoint::CapturedEndpoint;
use crate::level::Meter;
use crate::timemap::TimeMap;
use crate::track::TrackWriter;

/// A recording in progress (plan 4.1-4.4).
///
/// It owns two tracks and keeps them on one timeline. The two things it is
/// really for are the two that have no symptom when they go wrong: a pause has
/// to stop and resume *both* tracks at the same instant and leave each as one
/// block, and a default-device change mid-meeting has to be survived and
/// written down rather than silently ending the stream.
pub struct Session<C: Clock> {
    clock: C,
    title: String,
    /// Wall-clock instant of the session's first frame, for the manifest.
    started_wall_ns: u64,
    /// Monotonic instant the session began; every timeline below is on it.
    started_mono_ns: u64,
    mic: TrackWriter,
    system: TrackWriter,
    time_map: TimeMap,
    state: State,
    pauses: Vec<PauseInterval>,
    device_changes: Vec<DeviceChange>,
    device_losses: Vec<DeviceLoss>,
    /// Which endpoint each track captured, and in which mode (R3.3). Set when
    /// the recording starts, by whoever opened the devices.
    endpoints: (CapturedEndpoint, CapturedEndpoint),
    /// The level of each track over the last fraction of a second (R4.1), read
    /// off the frames on their way to the writer and nowhere else (R4.4).
    levels: (Meter, Meter),
    first_frame: FirstFrames,
    /// Has each track ever had *real* frames appended? `frames_written`
    /// cannot answer this: `pad_to` has usually already counted silence by
    /// the time the first packet arrives, so using it left `first_frames`
    /// null for both tracks in every realistic recording — and 4.4 names that
    /// timestamp as one of the three things the manifest is for.
    real_frames: (bool, bool),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Recording,
    Paused,
    Stopped,
}

/// A stretch the user paused.
///
/// On the **wall clock**, in nanoseconds since the Unix epoch — the same base
/// as `started_wall_ns` and the time map's segments. These used to be
/// monotonic readings from the session's own origin, so `manifest.json`
/// carried four `u64` fields all named `_ns` on two different bases with
/// nothing to tell them apart. 4.7 and 4.11 read this file; that is a
/// comparison that looks reasonable and is wrong by a factor of 1.7e18.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PauseInterval {
    pub start_wall_ns: u64,
    /// Absent while the recording is still paused.
    pub end_wall_ns: Option<u64>,
}

/// A default-device change survived mid-recording (plan 4.2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceChange {
    /// Which track: `mic` or `system`.
    pub track: String,
    pub device: String,
    /// When it happened, as an offset into the recording.
    pub recorded_ns: u64,
}

/// A track's chosen endpoint lost mid-recording, with nothing put in its place
/// (R2.3).
///
/// Deliberately **not** a `DeviceChange`. The two read as opposites: a change
/// says the track carried on somewhere else, a loss says everything after this
/// instant is manufactured silence. A reader who sees both in one list and
/// counts "one device event" is being told the recording is fine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceLoss {
    /// Which track: `mic` or `system`.
    pub track: String,
    /// The endpoint that went away, as it was last known.
    pub device: String,
    /// When it happened, as an offset into the recording.
    pub recorded_ns: u64,
}

/// The absolute instant each track's first frame landed (plan 4.4). Absent
/// until a frame actually arrives — a track that never received one has no
/// first frame, and reporting the session's start instead would be a
/// timestamp nobody recorded.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FirstFrames {
    pub mic_wall_ns: Option<u64>,
    pub system_wall_ns: Option<u64>,
}

/// Which of the two tracks an event belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Track {
    Mic,
    System,
}

impl Track {
    fn name(self) -> &'static str {
        match self {
            Track::Mic => "mic",
            Track::System => "system",
        }
    }
}

impl<C: Clock> Session<C> {
    pub fn start(
        clock: C,
        title: &str,
        mic_rate: u32,
        mic_ch: u16,
        sys_rate: u32,
        sys_ch: u16,
    ) -> Self {
        let started_wall_ns = clock.wall_ns();
        let started_mono_ns = clock.monotonic_ns();
        let mut time_map = TimeMap::new();
        time_map.begin_segment(started_wall_ns);

        let mut mic = TrackWriter::new(mic_rate, mic_ch);
        let mut system = TrackWriter::new(sys_rate, sys_ch);
        // Both segments open at the same instant. Opening them separately is
        // how two tracks start a few milliseconds apart and stay that way.
        mic.begin_segment(started_mono_ns);
        system.begin_segment(started_mono_ns);

        Self {
            clock,
            title: title.to_string(),
            started_wall_ns,
            started_mono_ns,
            mic,
            system,
            time_map,
            state: State::Recording,
            pauses: Vec::new(),
            device_changes: Vec::new(),
            device_losses: Vec::new(),
            endpoints: (CapturedEndpoint::default(), CapturedEndpoint::default()),
            levels: (
                Meter::for_track(mic_rate, mic_ch),
                Meter::for_track(sys_rate, sys_ch),
            ),
            first_frame: FirstFrames::default(),
            real_frames: (false, false),
        }
    }

    /// How much audio the mic track actually holds, in nanoseconds. The
    /// manifest and `status` report this rather than the map's span, so a
    /// disagreement between the two can never be presented as fact.
    pub fn recorded_ns(&self) -> u64 {
        (u128::from(self.mic.frames_written()) * 1_000_000_000u128
            / u128::from(self.mic.sample_rate().max(1))) as u64
    }

    /// The offset into the recording right now, for stamping an event.
    fn recorded_now_ns(&self) -> u64 {
        let mono = self.clock.monotonic_ns();
        self.mic
            .expected_frames_at(mono)
            .saturating_mul(1_000_000_000)
            .checked_div(u64::from(self.mic.sample_rate()))
            .unwrap_or(0)
    }

    pub fn state(&self) -> State {
        self.state
    }

    pub fn title(&self) -> &str {
        &self.title
    }

    pub fn time_map(&self) -> &TimeMap {
        &self.time_map
    }

    pub fn pauses(&self) -> &[PauseInterval] {
        &self.pauses
    }

    pub fn device_changes(&self) -> &[DeviceChange] {
        &self.device_changes
    }

    /// The tracks whose endpoint went away and was not replaced (R2.3).
    pub fn device_losses(&self) -> &[DeviceLoss] {
        &self.device_losses
    }

    /// Record which endpoint each track is capturing, and in which mode
    /// (R3.3).
    ///
    /// A separate call rather than two more arguments to `start`: whoever
    /// opened the devices is what knows this, and the session's own six
    /// arguments are already the shape of the recording rather than of the
    /// hardware.
    pub fn capturing(&mut self, mic: CapturedEndpoint, system: CapturedEndpoint) {
        self.endpoints = (mic, system);
    }

    /// The endpoint the microphone track is capturing (R3.3).
    pub fn mic_endpoint(&self) -> &CapturedEndpoint {
        &self.endpoints.0
    }

    /// The endpoint the system track is capturing (R3.3).
    pub fn system_endpoint(&self) -> &CapturedEndpoint {
        &self.endpoints.1
    }

    /// The microphone track's level right now (R4.1).
    pub fn mic_level(&self) -> &Meter {
        &self.levels.0
    }

    /// The system track's level right now (R4.1).
    pub fn system_level(&self) -> &Meter {
        &self.levels.1
    }

    /// The tracks currently recording manufactured silence because their
    /// endpoint is gone. This is what `status` reports so a person can be told
    /// while it still matters.
    pub fn lost_tracks(&self) -> Vec<String> {
        self.device_losses
            .iter()
            .map(|loss| loss.track.clone())
            .collect()
    }

    pub fn first_frames(&self) -> FirstFrames {
        self.first_frame
    }

    pub fn mic(&self) -> &TrackWriter {
        &self.mic
    }

    pub fn system(&self) -> &TrackWriter {
        &self.system
    }

    pub fn started_wall_ns(&self) -> u64 {
        self.started_wall_ns
    }

    /// Poll both devices once and write what they gave. Called in a loop.
    pub fn pump(
        &mut self,
        mic: &mut dyn CaptureSource,
        system: &mut dyn CaptureSource,
    ) -> Result<(), CaptureError> {
        if self.state != State::Recording {
            return Ok(());
        }
        // One clock reading for both tracks. Reading it twice would let the two
        // tracks be padded to different instants, which is the drift adr:0005
        // says has to be imposed away by a clock of our own.
        let mono = self.clock.monotonic_ns();

        // Neither `?`: an error on one device must not skip the other's poll,
        // and must not skip the padding below. A source that keeps failing —
        // the normal outcome of a device disappearing — would otherwise freeze
        // both tracks and the time map while `status` still said "recording".
        let mic_poll = mic.poll().unwrap_or(Poll::Idle);
        let sys_poll = system.poll().unwrap_or(Poll::Idle);

        self.apply(Track::Mic, mic_poll, mono);
        self.apply(Track::System, sys_poll, mono);

        // Whatever either device did, both tracks cover the same elapsed time.
        // This is what stands in for the frames loopback never sends while
        // nobody is playing sound.
        self.mic.pad_to(mono);
        self.system.pad_to(mono);
        self.time_map.extend_to(self.wall_of(mono));
        Ok(())
    }

    /// The wall-clock instant matching a monotonic reading.
    fn wall_of(&self, mono_ns: u64) -> u64 {
        self.started_wall_ns + mono_ns.saturating_sub(self.started_mono_ns)
    }

    fn apply(&mut self, track: Track, poll: Poll, mono_ns: u64) {
        match poll {
            Poll::Idle => {}
            Poll::DeviceChanged { device } => {
                let recorded_ns = self.recorded_now_ns();
                self.device_changes.push(DeviceChange {
                    track: track.name().to_string(),
                    device,
                    recorded_ns,
                });
            }
            // Recorded once, however often it is reported. The endpoint does
            // not come back, so a source may say this on every poll for the
            // rest of the meeting — an hour of that is 180,000 entries in the
            // manifest all saying the same thing.
            //
            // Nothing is opened in its place, here or below: the track goes on
            // being padded by `pump`, which is the manufactured silence R2.3
            // asks for.
            Poll::DeviceLost { device } => {
                let name = track.name();
                if self.device_losses.iter().any(|loss| loss.track == name) {
                    return;
                }
                let recorded_ns = self.recorded_now_ns();
                self.device_losses.push(DeviceLoss {
                    track: name.to_string(),
                    device,
                    recorded_ns,
                });
            }
            Poll::Frames {
                wall_ns: _,
                samples,
            } => {
                // The device's own stamp is not trusted for placement: the
                // session's clock is the one both tracks share, and mixing the
                // two is how they drift. The stamp is kept by the source for
                // its own bookkeeping.
                let (writer, meter) = match track {
                    Track::Mic => (&mut self.mic, &mut self.levels.0),
                    Track::System => (&mut self.system, &mut self.levels.1),
                };
                writer.append(&samples);
                // The same buffer, on its way to the file. This is the whole
                // of R4.4: no second stream, no second consumer of the
                // endpoint, just arithmetic over frames already in hand.
                meter.push(&samples);
                if samples.is_empty() {
                    return;
                }
                let wall = self.wall_of(mono_ns);
                match track {
                    Track::Mic if !self.real_frames.0 => {
                        self.real_frames.0 = true;
                        self.first_frame.mic_wall_ns = Some(wall);
                    }
                    Track::System if !self.real_frames.1 => {
                        self.real_frames.1 = true;
                        self.first_frame.system_wall_ns = Some(wall);
                    }
                    _ => {}
                }
            }
        }
    }

    /// Stop both tracks at the same instant. A pause is a capture pause: the
    /// devices stop, and the stretch is recorded so the time map can skip it.
    pub fn pause(&mut self, mic: &mut dyn CaptureSource, system: &mut dyn CaptureSource) {
        if self.state != State::Recording {
            return;
        }
        // One instant for everything: both tracks close, the segment closes,
        // and the pause opens, all at the same reading. Taking the clock more
        // than once here is how the two tracks end up different lengths.
        let mono = self.clock.monotonic_ns();

        // Pad *before* closing, and extend the map to the same instant. The
        // map used to be extended to the pause while the tracks were closed
        // where the last pump left them, so the map claimed time the audio did
        // not contain — and `resume` anchored the next segment on the inflated
        // figure, making the error permanent and cumulative across pauses.
        self.mic.pad_to(mono);
        self.system.pad_to(mono);
        self.mic.end_segment();
        self.system.end_segment();
        self.time_map.extend_to(self.wall_of(mono));

        mic.stop();
        system.stop();

        let start_wall_ns = self.wall_of(mono);
        self.pauses.push(PauseInterval {
            start_wall_ns,
            end_wall_ns: None,
        });
        self.state = State::Paused;
    }

    /// Resume both tracks at the same instant, continuing the recorded
    /// timeline rather than starting a new one.
    pub fn resume(
        &mut self,
        mic: &mut dyn CaptureSource,
        system: &mut dyn CaptureSource,
    ) -> Result<(), CaptureError> {
        if self.state != State::Paused {
            return Ok(());
        }
        let mono = self.clock.monotonic_ns();

        mic.start()?;
        system.start()?;

        let end_wall_ns = self.wall_of(mono);
        if let Some(open) = self.pauses.last_mut() {
            open.end_wall_ns = Some(end_wall_ns);
        }
        // Both tracks reopen at the same instant, continuing their frame
        // counts — that is what leaves the paused stretch as one block rather
        // than a gap of manufactured silence.
        self.mic.begin_segment(mono);
        self.system.begin_segment(mono);
        self.time_map.begin_segment(self.wall_of(mono));

        self.state = State::Recording;
        Ok(())
    }

    /// Point both tracks at files under `dir` instead of holding their samples
    /// in memory. An hour of 48 kHz stereo is 691 MB per track.
    pub fn attach_files(&mut self, dir: &std::path::Path) -> Result<(), hound::Error> {
        self.mic.attach_wav(&dir.join("mic.wav"))?;
        self.system.attach_wav(&dir.join("system.wav"))?;
        Ok(())
    }

    /// Write both WAV headers, reporting whatever went wrong rather than
    /// stopping at the first. Skipping a finalize leaves a file claiming zero
    /// frames, which every reader believes — so one failure must not cost the
    /// other track its header as well.
    pub fn finalize_files(&mut self) -> Vec<String> {
        let mut problems = Vec::new();
        if let Err(e) = self.mic.finalize() {
            problems.push(format!("mic.wav: {e}"));
        }
        if let Err(e) = self.system.finalize() {
            problems.push(format!("system.wav: {e}"));
        }
        for (name, failed) in [
            ("mic.wav", self.mic.failed_samples()),
            ("system.wav", self.system.failed_samples()),
        ] {
            if failed > 0 {
                problems.push(format!("{name}: {failed} samples could not be written"));
            }
        }
        problems
    }

    /// True when either track is near the 4 GiB a WAV header can describe.
    pub fn at_size_limit(&self) -> bool {
        self.mic.at_size_limit() || self.system.at_size_limit()
    }

    pub fn stop(&mut self, mic: &mut dyn CaptureSource, system: &mut dyn CaptureSource) {
        if self.state == State::Stopped {
            return;
        }
        let mono = self.clock.monotonic_ns();
        if self.state == State::Recording {
            // Same as pause: the tracks reach the stop instant before the map
            // says they do, or the manifest describes audio the file lacks.
            self.mic.pad_to(mono);
            self.system.pad_to(mono);
            self.time_map.extend_to(self.wall_of(mono));
        }
        self.mic.end_segment();
        self.system.end_segment();
        mic.stop();
        system.stop();
        self.state = State::Stopped;
    }
}
