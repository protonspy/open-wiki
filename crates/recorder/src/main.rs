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
    use recorder::capture::AudioFormat;
    use recorder::pump::ThreadedSource;
    use recorder::wasapi_source::{WasapiSource, Which};
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
    let mut mic = ThreadedSource::spawn(format, move || {
        WasapiSource::open(Which::Microphone, 48_000, 2)
    });
    let mut system = ThreadedSource::spawn(format, move || {
        WasapiSource::open(Which::Loopback, 48_000, 2)
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

    let mut service = Service::new(SystemClock::new, mic, system, list_devices);
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();

    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }

        let response = match parse(&line) {
            Ok(request) => {
                let stopping = matches!(request, Request::Stop);
                let response = service.handle(request);
                if stopping {
                    let _ = writeln!(stdout, "{}", render(&response));
                    let _ = stdout.flush();
                    break;
                }
                response
            }
            Err(message) => error(message),
        };

        let _ = writeln!(stdout, "{}", render(&response));
        let _ = stdout.flush();

        // Fold in whatever the capture threads collected. The threads do the
        // draining; this only moves it into the session, so a slow parent
        // costs latency in `status` rather than audio.
        service.pump();
    }
}
