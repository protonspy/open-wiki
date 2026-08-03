use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use crate::capture::{AudioFormat, CaptureError, CaptureSource, Poll};
use crate::endpoint::CapturedEndpoint;

/// A capture source drained by a thread of its own.
///
/// **This is what makes the recorder record.** Draining only when an RPC
/// request arrives meant the device was polled at whatever rate the parent
/// happened to send lines — and WASAPI overwrites anything not collected
/// within the engine buffer. The frames are gone, `pad_to` fills the hole with
/// manufactured silence, and every number this program reports — the WAV
/// length, `recorded_ms`, the time map — describes a complete, healthy hour of
/// which most is silent. A recording that fails loudly is recoverable; one
/// that fails looking like this is not.
///
/// So the device is drained continuously here, and `poll` hands the session
/// whatever accumulated since it last asked.
pub struct ThreadedSource {
    format: AudioFormat,
    device: String,
    rx: Receiver<Poll>,
    commands: Sender<Command>,
    /// Frames the queue had no room for, so a lossy recording can say so.
    dropped: Arc<AtomicU64>,
    /// Cleared when the capture thread returns, for any reason.
    alive: Arc<AtomicBool>,
    /// Why it returned, when it did.
    fault: Arc<Mutex<Option<String>>>,
    running: Arc<AtomicBool>,
    lost: Arc<AtomicU64>,
    /// A device change taken out of the channel behind frames that have to be
    /// reported first. Held, not dropped.
    deferred: Option<Poll>,
    /// What the thread found when it tried to open the device. `None` while it
    /// has not answered yet.
    opened: Arc<Mutex<Option<Result<String, String>>>>,
    /// The endpoint the thread actually opened (R3.3). Published once, when it
    /// opened: the manifest records what each track *started* on, and a move
    /// after that is a `device_change` rather than a different answer here.
    endpoint: Arc<Mutex<CapturedEndpoint>>,
    handle: Option<JoinHandle<()>>,
}

/// Packets the queue holds before it starts dropping. At a few milliseconds
/// per packet this is seconds of slack, which is far more than the pump loop
/// needs and still bounded.
const QUEUE_DEPTH: usize = 2048;

enum Command {
    Start,
    Stop,
    Quit,
}

impl ThreadedSource {
    /// Open a device **on the capture thread** and start draining it.
    ///
    /// The device is opened by the closure rather than handed in already open,
    /// because a WASAPI client is a COM interface: it is apartment-bound and
    /// not `Send`, so it cannot be created on one thread and used on another.
    /// `initialize_mta` therefore also runs inside the closure, on the thread
    /// that will make every call.
    pub fn spawn<S, F>(format: AudioFormat, open: F) -> Self
    where
        S: CaptureSource,
        F: FnOnce() -> Result<S, CaptureError> + Send + 'static,
    {
        let device = "opening".to_string();
        // Bounded. Unbounded meant the capture threads pushed ~384 KB/s per
        // device for as long as the session went without polling, and nothing
        // capped it. Bounded, the oldest audio is lost instead of the machine
        // — and the loss is counted, because a recording that lost audio has
        // to be able to say so rather than presenting silence as the real
        // thing. Sized for several seconds of packets.
        let (tx, rx) = mpsc::sync_channel::<Poll>(QUEUE_DEPTH);
        let (commands, orders) = mpsc::channel::<Command>();
        let running = Arc::new(AtomicBool::new(false));
        let lost = Arc::new(AtomicU64::new(0));
        let dropped = Arc::new(AtomicU64::new(0));
        let alive = Arc::new(AtomicBool::new(true));
        let fault: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

        let opened: Arc<Mutex<Option<Result<String, String>>>> = Arc::new(Mutex::new(None));
        let endpoint: Arc<Mutex<CapturedEndpoint>> = Arc::new(Mutex::new(CapturedEndpoint {
            id: None,
            name: device.clone(),
            pinned: false,
        }));

        let thread_endpoint = Arc::clone(&endpoint);
        let thread_running = Arc::clone(&running);
        let thread_lost = Arc::clone(&lost);
        let thread_opened = Arc::clone(&opened);
        let thread_dropped = Arc::clone(&dropped);
        let thread_alive = Arc::clone(&alive);
        let thread_fault = Arc::clone(&fault);
        let handle = thread::spawn(move || {
            // Whatever happens below, the session finds out. A thread that
            // returns quietly is indistinguishable from a device that is
            // merely silent, which is the whole failure this guards.
            let _guard = AliveGuard(thread_alive);
            let mut source = match open() {
                Ok(source) => {
                    let name = source.device_name();
                    // The endpoint is read here, on the thread that owns the
                    // source — it is the only place that can, and the manifest
                    // needs it (R3.3).
                    *thread_endpoint.lock().unwrap_or_else(|e| e.into_inner()) = source.endpoint();
                    *thread_opened.lock().unwrap_or_else(|e| e.into_inner()) = Some(Ok(name));
                    source
                }
                Err(e) => {
                    // Say so and stop. A thread that dies quietly looks to the
                    // session exactly like a device that is merely silent.
                    *thread_fault.lock().unwrap_or_else(|e| e.into_inner()) = Some(e.to_string());
                    *thread_opened.lock().unwrap_or_else(|e| e.into_inner()) =
                        Some(Err(e.to_string()));
                    return;
                }
            };
            loop {
                match orders.try_recv() {
                    Ok(Command::Start) => {
                        if source.start().is_ok() {
                            thread_running.store(true, Ordering::Relaxed);
                        }
                    }
                    Ok(Command::Stop) => {
                        source.stop();
                        thread_running.store(false, Ordering::Relaxed);
                    }
                    Ok(Command::Quit) | Err(TryRecvError::Disconnected) => {
                        source.stop();
                        return;
                    }
                    Err(TryRecvError::Empty) => {}
                }

                if !thread_running.load(Ordering::Relaxed) {
                    // Not recording: idle without burning a core.
                    thread::sleep(std::time::Duration::from_millis(20));
                    continue;
                }

                match source.poll() {
                    // A closed channel means the session is gone; so is the point
                    // of this thread.
                    Ok(poll) => {
                        thread_lost.store(source.discontinuities(), Ordering::Relaxed);
                        // `try_send`, never `send`: a full queue must not block
                        // the drain, because a blocked drain is exactly how
                        // WASAPI comes to overwrite frames nobody collected.
                        // The oldest audio is lost instead, and counted.
                        match tx.try_send(poll) {
                            Ok(()) => {}
                            Err(TrySendError::Full(unsent)) => {
                                if let Poll::Frames { samples, .. } = unsent {
                                    thread_dropped
                                        .fetch_add(samples.len() as u64, Ordering::Relaxed);
                                }
                            }
                            Err(TrySendError::Disconnected(_)) => {
                                source.stop();
                                return;
                            }
                        }
                    }
                    Err(_) => {
                        // The source reports its own recovery (a reopen sets
                        // `needs_reopen`); this thread's job is not to give up.
                        thread::sleep(std::time::Duration::from_millis(5));
                    }
                }
            }
        });

        Self {
            format,
            device,
            rx,
            commands,
            running,
            lost,
            dropped,
            alive,
            fault,
            deferred: None,
            opened,
            endpoint,
            handle: Some(handle),
        }
    }

    /// Wait briefly for the thread to say whether the device opened. `Ok(name)`
    /// once it has; an error when it could not.
    pub fn wait_until_open(&mut self, timeout: std::time::Duration) -> Result<String, String> {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            if let Some(result) = self
                .opened
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone()
            {
                if let Ok(name) = &result {
                    self.device = name.clone();
                }
                return result;
            }
            if std::time::Instant::now() >= deadline {
                return Err("the device did not open in time".into());
            }
            thread::sleep(std::time::Duration::from_millis(10));
        }
    }
}

impl CaptureSource for ThreadedSource {
    fn format(&self) -> AudioFormat {
        self.format
    }

    fn device_name(&self) -> String {
        self.device.clone()
    }

    fn endpoint(&self) -> CapturedEndpoint {
        self.endpoint
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    fn discontinuities(&self) -> u64 {
        self.lost.load(Ordering::Relaxed)
    }

    fn dropped_samples(&self) -> u64 {
        self.dropped.load(Ordering::Relaxed)
    }

    fn health(&self) -> Result<(), String> {
        if self.alive.load(Ordering::Relaxed) {
            return Ok(());
        }
        Err(self
            .fault
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .unwrap_or_else(|| "the capture thread stopped".into()))
    }

    /// Everything the thread collected since the last call, as one packet.
    ///
    /// A device change is reported on its own, ahead of the frames that
    /// followed it, so the session stamps it at the right offset.
    fn poll(&mut self) -> Result<Poll, CaptureError> {
        // Anything held back from the last call comes first.
        if let Some(held) = self.deferred.take() {
            return Ok(held);
        }
        let mut samples = Vec::new();
        loop {
            match self.rx.try_recv() {
                Ok(Poll::Frames { samples: more, .. }) => samples.extend_from_slice(&more),
                Ok(Poll::DeviceChanged { device }) => {
                    self.device = device.clone();
                    if samples.is_empty() {
                        return Ok(Poll::DeviceChanged { device });
                    }
                    // Hand back the audio from before the change first — but
                    // *hold* the change. It has already been taken out of the
                    // channel, so returning the frames without keeping it drops
                    // it, and the recording carries on with no record that the
                    // device moved, which is the one thing 4.2 writes down.
                    self.deferred = Some(Poll::DeviceChanged { device });
                    return Ok(Poll::Frames {
                        wall_ns: 0,
                        samples,
                    });
                }
                // A loss is carried exactly like a change, and for the same
                // reason: it has already been taken out of the channel, so
                // returning the frames without holding it would drop the one
                // thing R2.3 exists to write down.
                Ok(Poll::DeviceLost { device }) => {
                    if samples.is_empty() {
                        return Ok(Poll::DeviceLost { device });
                    }
                    self.deferred = Some(Poll::DeviceLost { device });
                    return Ok(Poll::Frames {
                        wall_ns: 0,
                        samples,
                    });
                }
                Ok(Poll::Idle) => {}
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => break,
            }
        }
        if samples.is_empty() {
            Ok(Poll::Idle)
        } else {
            Ok(Poll::Frames {
                wall_ns: 0,
                samples,
            })
        }
    }

    fn stop(&mut self) {
        let _ = self.commands.send(Command::Stop);
        self.running.store(false, Ordering::Relaxed);
    }

    fn start(&mut self) -> Result<(), CaptureError> {
        self.commands
            .send(Command::Start)
            .map_err(|_| CaptureError("the capture thread has gone".into()))
    }
}

impl Drop for ThreadedSource {
    fn drop(&mut self) {
        let _ = self.commands.send(Command::Quit);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

/// Clears the alive flag however the thread leaves — return, or panic.
struct AliveGuard(Arc<AtomicBool>);

impl Drop for AliveGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Relaxed);
    }
}
