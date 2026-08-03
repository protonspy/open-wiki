//! The real capture device (plan 4.1, 4.2), and the only part of the recorder
//! that touches WASAPI.
//!
//! It is deliberately the thinnest layer in the crate. Everything that can be
//! wrong in a way nobody notices — the alignment of the two tracks, the silence
//! that stands in for frames the API never sends, the pause arithmetic, the
//! time map — lives above `CaptureSource` and is tested on every platform. What
//! is left here is opening a stream, draining it, and reopening it when the
//! default device changes.
//!
//! **Unverified against hardware.** This compiles and its contract is exercised
//! through `ScriptedSource`, but no test in this repository has captured a real
//! frame: CI has no audio device, and the plan's own acceptance criterion for
//! group 4 is three manual checks on an hour-long recording. Treat green CI as
//! "it builds and the session logic is right", not as "audio works".

use std::collections::VecDeque;

use wasapi::{
    initialize_mta, AudioCaptureClient, AudioClient, Device, DeviceEnumerator, Direction, Handle,
    SampleType, StreamMode, WaveFormat,
};

use crate::capture::{AudioFormat, CaptureError, CaptureSource, Poll, Which};
use crate::endpoint::{next_action, resolve, Action, CapturedEndpoint, Endpoint};
use crate::rpc::DeviceInfo;

/// 32-bit float, the format the mixer already works in, so shared mode
/// converts nothing on the way in.
const BITS: usize = 32;

/// The engine buffer to ask for, in 100-nanosecond units: 500 ms. Large enough
/// that a drain running a few times a second loses nothing, and small enough
/// that stopping is prompt.
const BUFFER_DURATION_HNS: i64 = 5_000_000;

fn err(context: &str, e: impl std::fmt::Display) -> CaptureError {
    CaptureError(format!("{context}: {e}"))
}

/// Which endpoint to open: loopback listens to a **render** device.
fn device_direction(which: Which) -> Direction {
    match which {
        Which::Microphone => Direction::Capture,
        Which::Loopback => Direction::Render,
    }
}

/// Which direction to initialise the stream in — always capture, because both
/// of these read audio.
///
/// These are two separate decisions and conflating them is what silently
/// disables loopback: the crate derives `AUDCLNT_STREAMFLAGS_LOOPBACK` from the
/// *pair* (device is Render, stream is Capture). Passing (Render, Render)
/// matches nothing, so the flag is never set, the client initialises as a plain
/// playback stream, and asking it for an `IAudioCaptureClient` fails — taking
/// the whole sidecar down at launch.
fn stream_direction(_which: Which) -> Direction {
    Direction::Capture
}

/// Call once per process before anything else here. Safe to call twice.
pub fn init_com() -> Result<(), CaptureError> {
    initialize_mta()
        .ok()
        .map_err(|e| err("could not initialise COM", e))
}

/// Every device the machine offers, for the `devices` method of 4.5.
pub fn list_devices() -> Result<Vec<DeviceInfo>, CaptureError> {
    init_com()?;
    let enumerator = DeviceEnumerator::new().map_err(|e| err("could not enumerate devices", e))?;
    let mut out = Vec::new();

    // Driven from `Which`, not from a second list of direction/label pairs:
    // the label a reply carries and the label a stored choice is matched
    // against have to be the same string, and two lists is how they stop being.
    for which in [Which::Microphone, Which::Loopback] {
        let direction = device_direction(which);
        let kind = which.kind();
        let default_id = enumerator
            .get_default_device(&direction)
            .ok()
            .and_then(|d| d.get_id().ok());

        let collection = enumerator
            .get_device_collection(&direction)
            .map_err(|e| err("could not list devices", e))?;
        let count = collection
            .get_nbr_devices()
            .map_err(|e| err("could not count devices", e))?;

        for index in 0..count {
            let Ok(device) = collection.get_device_at_index(index) else {
                continue; // one unreadable device is not a reason to list none
            };
            let Ok(id) = device.get_id() else { continue };
            let name = device
                .get_friendlyname()
                .unwrap_or_else(|_| "unknown".into());
            out.push(DeviceInfo {
                default: Some(&id) == default_id.as_ref(),
                id,
                name,
                kind: kind.to_string(),
            });
        }
    }
    Ok(out)
}

/// One open WASAPI stream.
struct Stream {
    client: AudioClient,
    capture: AudioCaptureClient,
    event: Handle,
    block_align: usize,
    format: AudioFormat,
}

/// A capture source backed by a real device.
pub struct WasapiSource {
    which: Which,
    /// Which endpoint this track was asked for — the *choice*, not the device
    /// currently open. `reopen` branches on it, and the two are different
    /// things the moment the default moves under a pinned track (R2.2).
    endpoint: Endpoint,
    device_name: String,
    device_id: String,
    format: AudioFormat,
    stream: Option<Stream>,
    /// Bytes the device handed over that do not yet make a whole frame.
    pending: VecDeque<u8>,
    /// Set when the default device changed and the stream was reopened, so the
    /// next poll reports it once.
    changed: Option<String>,
    /// Set when the endpoint this track captures went away with nothing to
    /// replace it (R2.3). Reported on every poll thereafter — the session
    /// records it once — because it does not resolve and the track is silence
    /// from here on.
    lost: bool,
    /// A reopen failed and has to be tried again. Without this a single
    /// transient failure ends the track silently.
    needs_reopen: bool,
    /// How many times Windows reported that it overwrote frames nobody
    /// collected. A lossy recording has to be able to say so.
    discontinuities: u64,
    /// Whether the stream is started. Starting a running stream fails.
    running: bool,
}

impl WasapiSource {
    /// Open the endpoint this track was asked for (R1.2), falling back to the
    /// Windows default only where nothing was chosen (R1.3).
    ///
    /// A chosen endpoint that is not on this machine is refused here, by name,
    /// rather than answered with the default (R2.4) — see `endpoint::resolve`,
    /// which is where that decision lives and is tested.
    pub fn open(
        which: Which,
        sample_rate: u32,
        channels: u16,
        endpoint: Endpoint,
    ) -> Result<Self, CaptureError> {
        init_com()?;
        let format = AudioFormat {
            sample_rate,
            channels,
        };
        let (device, name, id) = open_endpoint(which, &endpoint)?;
        let stream = open_stream(&device, which, format)?;
        Ok(Self {
            which,
            endpoint,
            device_name: name,
            device_id: id,
            format: stream.format,
            stream: Some(stream),
            pending: VecDeque::new(),
            changed: None,
            lost: false,
            needs_reopen: false,
            discontinuities: 0,
            running: false,
        })
    }

    /// Has the endpoint situation moved out from under us?
    ///
    /// A **pinned** track is not asking, and this is the cheap check on the
    /// idle path — every 20 ms while loopback is silent — so it answers
    /// without enumerating anything (R2.2).
    fn endpoint_may_have_moved(&self) -> bool {
        if self.endpoint.is_pinned() {
            return false;
        }
        default_device(self.which).is_ok_and(|(_, _, id)| id != self.device_id)
    }

    /// Act on what `next_action` decided.
    ///
    /// The decision itself is not made here: it is `endpoint::next_action`, on
    /// plain data, under test on every platform. What is left here is opening
    /// what it named — which is the division this whole module is built on,
    /// because nothing in this file can be tested at all.
    fn reopen(&mut self) -> Result<(), CaptureError> {
        let devices = list_devices()?;
        let action = next_action(
            &self.endpoint,
            &self.device_id,
            &devices,
            self.which,
            self.needs_reopen,
        );
        let (device, name, id, moved) = match action {
            Action::Keep => {
                self.needs_reopen = false;
                return Ok(());
            }
            // The endpoint this track captures is gone and there is no
            // substitute for it (R2.3). Nothing is opened in its place; the
            // stream is dropped so the dead client is not held, and the track
            // is padded with silence by the session from here on.
            Action::Lost => {
                self.lost = true;
                self.needs_reopen = false;
                if let Some(old) = self.stream.take() {
                    let _ = old.client.stop_stream();
                }
                return Ok(());
            }
            // The same endpoint, opened again. Not a move, so nothing is
            // written down: the choice never changed.
            Action::Reopen => {
                let (device, name, id) = open_endpoint(self.which, &self.endpoint)?;
                (device, name, id, false)
            }
            // The default moved and this track follows it (R2.1).
            Action::MoveTo(id) => {
                let (device, name, id) = open_by_id(&id)?;
                (device, name, id, true)
            }
        };
        // Open the new stream **before** dropping the working one. Dropping
        // first and then failing — which a newly promoted device does routinely
        // for a moment after a headset is unplugged — left this source with no
        // stream, no retry, and a track padded with silence for the rest of the
        // meeting, reported as healthy.
        let fresh = match open_stream(&device, self.which, self.format) {
            Ok(stream) => stream,
            Err(e) => {
                self.needs_reopen = true;
                return Err(e);
            }
        };
        if let Some(old) = self.stream.take() {
            let _ = old.client.stop_stream();
        }
        self.format = fresh.format;
        self.stream = Some(fresh);
        self.device_name = name.clone();
        self.device_id = id;
        self.pending.clear();
        // Only a *move* is reported. Reopening the endpoint that was already
        // chosen is recovery, and writing it into `device_changes` would tell
        // a reader the microphone changed when it did not.
        self.changed = moved.then_some(name);
        self.needs_reopen = false;
        if self.running {
            if let Some(stream) = self.stream.as_mut() {
                let _ = stream.client.start_stream();
            }
        }
        Ok(())
    }
}

/// The device this choice names, opened.
///
/// `Default` asks Windows, which is what every caller did before there was a
/// choice. `Pinned` is checked against the enumeration first, so a missing
/// endpoint is refused by name (R2.4) rather than surfacing as whatever
/// `GetDevice` says about an identifier it does not know.
fn open_endpoint(
    which: Which,
    endpoint: &Endpoint,
) -> Result<(Device, String, String), CaptureError> {
    let Some(id) = endpoint.pinned_id() else {
        return default_device(which);
    };
    let devices = list_devices()?;
    let chosen = resolve(endpoint, &devices, which).map_err(CaptureError)?;
    let enumerator = DeviceEnumerator::new().map_err(|e| err("could not enumerate devices", e))?;
    let device = enumerator
        .get_device(id)
        .map_err(|e| err(&format!("could not open the endpoint {id}"), e))?;
    Ok((device, chosen.name.clone(), chosen.id.clone()))
}

/// One endpoint, by its identifier.
fn open_by_id(id: &str) -> Result<(Device, String, String), CaptureError> {
    let enumerator = DeviceEnumerator::new().map_err(|e| err("could not enumerate devices", e))?;
    let device = enumerator
        .get_device(id)
        .map_err(|e| err(&format!("could not open the endpoint {id}"), e))?;
    let name = device
        .get_friendlyname()
        .unwrap_or_else(|_| "unknown".into());
    Ok((device, name, id.to_string()))
}

fn default_device(which: Which) -> Result<(Device, String, String), CaptureError> {
    let enumerator = DeviceEnumerator::new().map_err(|e| err("could not enumerate devices", e))?;
    let device = enumerator
        .get_default_device(&device_direction(which))
        .map_err(|e| err(&format!("no default {} device", which.track()), e))?;
    let name = device
        .get_friendlyname()
        .unwrap_or_else(|_| "unknown".into());
    let id = device.get_id().map_err(|e| err("device has no id", e))?;
    Ok((device, name, id))
}

fn open_stream(device: &Device, which: Which, format: AudioFormat) -> Result<Stream, CaptureError> {
    let mut client = device
        .get_iaudioclient()
        .map_err(|e| err("could not open the client", e))?;
    let wave = WaveFormat::new(
        BITS,
        BITS,
        &SampleType::Float,
        format.sample_rate as usize,
        format.channels as usize,
        None,
    );
    let (_default_period, min_period) = client
        .get_device_period()
        .map_err(|e| err("could not read the device period", e))?;

    // A buffer measured in hundreds of milliseconds, not the device minimum.
    // The minimum is a few milliseconds, and anything the drain loop does not
    // collect inside that window WASAPI overwrites — which the track then
    // backfills with silence that looks, in every number this program
    // reports, exactly like a healthy recording.
    let buffer_duration_hns = min_period.max(BUFFER_DURATION_HNS);

    // Shared mode with autoconvert: the meeting is not the only thing using the
    // sound card, and exclusive mode would take it from whatever is.
    let mode = StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns,
    };
    client
        .initialize_client(&wave, &stream_direction(which), &mode)
        .map_err(|e| err("could not initialise the stream", e))?;

    let event = client
        .set_get_eventhandle()
        .map_err(|e| err("no event handle", e))?;
    let capture = client
        .get_audiocaptureclient()
        .map_err(|e| err("could not open the capture client", e))?;
    // Deliberately **not** started here. The service starts capture when the
    // recording starts; starting on open meant the endpoint buffer was
    // overrunning between process launch and the `start` request, and then
    // `start` itself failed with AUDCLNT_E_NOT_STOPPED on an already-running
    // stream — losing the session that had just been built.

    Ok(Stream {
        capture,
        event,
        block_align: wave.get_blockalign() as usize,
        format,
        client,
    })
}

impl CaptureSource for WasapiSource {
    fn format(&self) -> AudioFormat {
        self.format
    }

    fn device_name(&self) -> String {
        self.device_name.clone()
    }

    fn endpoint(&self) -> CapturedEndpoint {
        CapturedEndpoint {
            // The endpoint actually open, not the one asked for. A following
            // track was never asked for one, and a track that has moved since
            // it started is on its second (R2.1).
            id: Some(self.device_id.clone()),
            name: self.device_name.clone(),
            pinned: self.endpoint.is_pinned(),
        }
    }

    fn discontinuities(&self) -> u64 {
        self.discontinuities
    }

    fn poll(&mut self) -> Result<Poll, CaptureError> {
        // A device change is reported once, before any frames from the new
        // device, so the session records it at the right instant.
        if let Some(device) = self.changed.take() {
            return Ok(Poll::DeviceChanged { device });
        }

        // The endpoint this track captures is gone and nothing may replace it
        // (R2.3). Said on every poll — the session records it once — and
        // without re-enumerating: this runs on the capture thread's own loop,
        // and a COM enumeration per poll would spin a core for the rest of the
        // meeting looking for a device that is not there.
        //
        // It is terminal for the session. The endpoint coming back is not
        // something the spec decided about, and re-adopting it silently would
        // leave a hole in the track that nothing reports.
        if self.lost {
            return Ok(Poll::DeviceLost {
                device: self.device_name.clone(),
            });
        }

        // Retry a reopen that failed, before anything short-circuits on a
        // missing stream.
        if self.needs_reopen || self.stream.is_none() {
            match self.reopen() {
                Ok(()) => {
                    if let Some(device) = self.changed.take() {
                        return Ok(Poll::DeviceChanged { device });
                    }
                }
                Err(_) => return Ok(Poll::Idle), // try again on the next poll
            }
        }

        let Some(stream) = self.stream.as_mut() else {
            return Ok(Poll::Idle);
        };

        // Wait briefly for the device to say it has something. A timeout is
        // not an error: loopback signals nothing at all while the machine is
        // silent, which is the normal state for most of a meeting.
        if stream.event.wait_for_event(20).is_err() {
            // The stream may have died with the device. Check before giving up.
            if self.endpoint_may_have_moved() {
                // A failure here is not fatal: `needs_reopen` makes the next
                // poll try again rather than leaving the track dead.
                let _ = self.reopen();
                return Ok(self
                    .changed
                    .take()
                    .map_or(Poll::Idle, |device| Poll::DeviceChanged { device }));
            }
            return Ok(Poll::Idle);
        }

        // Every packet the device is holding, not one. `read_from_device_to_deque`
        // does a single GetBuffer/ReleaseBuffer, so stopping after one leaves
        // the rest to be overwritten on the next cycle.
        loop {
            match stream.capture.get_next_packet_size() {
                Ok(Some(frames)) if frames > 0 => {}
                Ok(_) => break,
                Err(e) => return Err(err("could not read the packet size", e)),
            }
            let info = match stream.capture.read_from_device_to_deque(&mut self.pending) {
                Ok(info) => info,
                Err(_) => {
                    // The usual way a device change announces itself is the
                    // *read* failing (AUDCLNT_E_DEVICE_INVALIDATED), not the
                    // event timing out. Treating it as fatal ended the capture
                    // in exactly the case 4.2 exists to survive.
                    self.needs_reopen = true;
                    return Ok(Poll::Idle);
                }
            };
            // Windows says so when it has overwritten frames nobody collected.
            // Counting it is the difference between a recording that is lossy
            // and one that only looks complete.
            if info.flags.data_discontinuity {
                self.discontinuities += 1;
            }
        }

        let block = stream.block_align.max(1);
        let whole = (self.pending.len() / block) * block;
        if whole == 0 {
            return Ok(Poll::Idle);
        }

        let mut bytes = Vec::with_capacity(whole);
        for _ in 0..whole {
            bytes.push(self.pending.pop_front().unwrap_or(0));
        }
        let samples = bytes
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect();

        Ok(Poll::Frames {
            wall_ns: 0,
            samples,
        })
    }

    fn stop(&mut self) {
        if let Some(stream) = self.stream.as_mut() {
            let _ = stream.client.stop_stream();
        }
    }

    fn start(&mut self) -> Result<(), CaptureError> {
        match self.stream.as_mut() {
            Some(stream) => stream
                .client
                .start_stream()
                .map_err(|e| err("could not restart the stream", e)),
            None => Err(CaptureError("the stream is closed".into())),
        }
    }
}
