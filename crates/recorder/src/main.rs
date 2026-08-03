//! The recorder sidecar's process entrypoint (plan 4.5).
//!
//! One JSON object per line on stdin, one per line on stdout. Everything it
//! does lives in the library, so this file holds only what a test cannot have:
//! real stdin, real stdout, and a real exit code.

use std::io::{BufRead, Write};

use recorder::capture::CaptureSource;
use recorder::clock::SystemClock;
use recorder::rpc::{error, parse, render, Request};
use recorder::service::Service;

/// The microphone and the loopback, opened.
type Devices = (Box<dyn CaptureSource>, Box<dyn CaptureSource>);

#[cfg(windows)]
fn open_devices() -> Result<Devices, String> {
    use recorder::capture::{AudioFormat, Which};
    use recorder::endpoint::Endpoint;
    use recorder::pump::ThreadedSource;
    use recorder::wasapi_source::WasapiSource;
    // 48 kHz stereo float is what the Windows mixer works in, so shared mode
    // converts nothing on the way in. ffmpeg downmixes later (4.6).
    let format = AudioFormat {
        sample_rate: 48_000,
        channels: 2,
    };
    // Each device is opened *on* its own capture thread — a WASAPI client is a
    // COM interface and cannot cross threads — and drained there continuously.
    // Draining only when a request arrives loses whatever the device buffered
    // in between, and the loss is invisible: the track is padded with silence
    // and every number the sidecar reports says the hour is fine.
    // Both follow the Windows default here. The endpoints a project chose
    // arrive on `start` (R1.2), which is where the parent knows them.
    let mut mic = ThreadedSource::spawn(format, move || {
        WasapiSource::open(Which::Microphone, 48_000, 2, Endpoint::Default)
    });
    let mut system = ThreadedSource::spawn(format, move || {
        WasapiSource::open(Which::Loopback, 48_000, 2, Endpoint::Default)
    });

    let wait = std::time::Duration::from_secs(5);
    mic.wait_until_open(wait)
        .map_err(|e| format!("microphone: {e}"))?;
    system
        .wait_until_open(wait)
        .map_err(|e| format!("system audio: {e}"))?;

    Ok((Box::new(mic), Box::new(system)))
}

#[cfg(not(windows))]
fn open_devices() -> Result<Devices, String> {
    // WASAPI is Windows, and Windows is the only platform this product
    // supports (`adr:0005`). Saying so beats pretending to record.
    Err("the recorder captures through WASAPI and runs on Windows only".into())
}

#[cfg(windows)]
fn list_devices() -> Result<Vec<recorder::rpc::DeviceInfo>, String> {
    recorder::wasapi_source::list_devices().map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn list_devices() -> Result<Vec<recorder::rpc::DeviceInfo>, String> {
    Err("the recorder captures through WASAPI and runs on Windows only".into())
}

/// Open one track on the endpoint `start` named (R1.2).
///
/// Both devices are opened on the Windows default when the process launches,
/// before anybody has said what to record. This is what puts a track on the
/// endpoint somebody chose, and it is reached only from `start` — the
/// `peek`/`ensure` split exists so that polling never opens a device, and this
/// must not become the hole in it.
#[cfg(windows)]
fn open_source(
    which: recorder::capture::Which,
    endpoint: &recorder::endpoint::Endpoint,
) -> Result<Box<dyn CaptureSource>, String> {
    use recorder::capture::AudioFormat;
    use recorder::pump::ThreadedSource;
    use recorder::wasapi_source::WasapiSource;

    let format = AudioFormat {
        sample_rate: 48_000,
        channels: 2,
    };
    let chosen = endpoint.clone();
    let mut source =
        ThreadedSource::spawn(format, move || WasapiSource::open(which, 48_000, 2, chosen));
    // Wait for the answer rather than returning a source that may be about to
    // fail: a chosen endpoint that is not on this machine has to refuse the
    // recording by name (R2.4), and it can only do that if the failure is in
    // hand before `start` replies.
    source
        .wait_until_open(std::time::Duration::from_secs(5))
        .map_err(|e| format!("{}: {e}", which.track()))?;
    Ok(Box::new(source))
}

#[cfg(not(windows))]
fn open_source(
    _which: recorder::capture::Which,
    _endpoint: &recorder::endpoint::Endpoint,
) -> Result<Box<dyn CaptureSource>, String> {
    Err("the recorder captures through WASAPI and runs on Windows only".into())
}

fn main() {
    let (mic, system) = match open_devices() {
        Ok(pair) => pair,
        Err(message) => {
            // Report it in the protocol the caller speaks, then leave. A
            // sidecar that dies silently looks to its parent like one that is
            // still starting up.
            let mut out = std::io::stdout();
            let _ = writeln!(out, "{}", render(&error(message)));
            let _ = out.flush();
            std::process::exit(1);
        }
    };

    let mut service = Service::new(SystemClock::new, mic, system, list_devices)
        .reopening_with(Box::new(open_source));
    let mut stdout = std::io::stdout();

    // stdin on a thread of its own, so the loop below is free to pump on a
    // timer. Blocking on `lines()` and pumping once per request meant the
    // capture queues grew for as long as the parent stayed quiet — and the
    // parent has no reason to send anything between `start` and `stop`.
    let (tx, requests) = std::sync::mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if tx.send(line).is_err() {
                break;
            }
        }
    });

    // Often enough that a bounded queue never fills, cheap enough to ignore.
    let tick = std::time::Duration::from_millis(50);
    loop {
        match requests.recv_timeout(tick) {
            Ok(line) => {
                if line.trim().is_empty() {
                    continue;
                }
                let response = match parse(&line) {
                    Ok(request) => {
                        let stopping = matches!(request, Request::Stop);
                        let response = service.handle(request);
                        let _ = writeln!(stdout, "{}", render(&response));
                        let _ = stdout.flush();
                        if stopping {
                            break;
                        }
                        continue;
                    }
                    Err(message) => error(message),
                };
                let _ = writeln!(stdout, "{}", render(&response));
                let _ = stdout.flush();
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => service.pump(),
            // The parent closed stdin: finish whatever is open rather than
            // leaving a half-written recording behind.
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                let _ = service.handle(Request::Stop);
                break;
            }
        }
    }
}
