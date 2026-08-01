use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use crate::capture::{AudioFormat, CaptureError, CaptureSource, Poll};

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
    running: Arc<AtomicBool>,
    lost: Arc<AtomicU64>,
    /// A device change taken out of the channel behind frames that have to be
    /// reported first. Held, not dropped.
    deferred: Option<Poll>,
    /// What the thread found when it tried to open the device. `None` while it
    /// has not answered yet.
    opened: Arc<Mutex<Option<Result<String, String>>>>,
    handle: Option<JoinHandle<()>>,
}

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
        let (tx, rx) = mpsc::channel::<Poll>();
        let (commands, orders) = mpsc::channel::<Command>();
        let running = Arc::new(AtomicBool::new(false));
        let lost = Arc::new(AtomicU64::new(0));

        let opened: Arc<Mutex<Option<Result<String, String>>>> = Arc::new(Mutex::new(None));

        let thread_running = Arc::clone(&running);
        let thread_lost = Arc::clone(&lost);
        let thread_opened = Arc::clone(&opened);
        let handle = thread::spawn(move || {
            let mut source = match open() {
                Ok(source) => {
                    let name = source.device_name();
                    *thread_opened.lock().unwrap_or_else(|e| e.into_inner()) = Some(Ok(name));
                    source
                }
                Err(e) => {
                    // Say so and stop. A thread that dies quietly looks to the
                    // session exactly like a device that is merely silent.
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
                        thread_lost.store(source.lost_frames(), Ordering::Relaxed);
                        if tx.send(poll).is_err() {
                            source.stop();
                            return;
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
            deferred: None,
            opened,
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

    fn lost_frames(&self) -> u64 {
        self.lost.load(Ordering::Relaxed)
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
                    // Hand back the audio from before the change first; the
                    // change itself is still queued for the next call.
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
