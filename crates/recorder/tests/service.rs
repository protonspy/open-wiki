use std::fs;

use recorder::capture::{AudioFormat, Poll, ScriptedSource};
use recorder::clock::SystemClock;
use recorder::manifest::RecordingManifest;
use recorder::rpc::{parse, render, DeviceInfo, Request, Response};
use recorder::service::Service;

fn devices_ok() -> Result<Vec<DeviceInfo>, String> {
    Ok(vec![DeviceInfo {
        id: "{0.0.1}".into(),
        name: "Headset".into(),
        kind: "capture".into(),
        default: true,
    }])
}

fn devices_fail() -> Result<Vec<DeviceInfo>, String> {
    Err("no audio endpoint".into())
}

fn service(script: Vec<Poll>) -> Service<SystemClock> {
    let format = AudioFormat {
        sample_rate: 48_000,
        channels: 1,
    };
    Service::new(
        SystemClock::new,
        Box::new(ScriptedSource::new(format, "mic", script)),
        Box::new(ScriptedSource::new(format, "system", vec![])),
        devices_ok,
    )
}

fn json(response: &Response) -> serde_json::Value {
    serde_json::from_str(&render(response)).expect("valid json")
}

fn tempdir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("ow-rec-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    dir
}

#[test]
fn status_before_anything_says_idle() {
    let service = service(vec![]);
    assert_eq!(json(&service.status())["state"], "idle");
}

#[test]
fn start_creates_the_directory_and_begins_recording() {
    let dir = tempdir("start");
    let mut service = service(vec![]);

    let response = service.handle(
        parse(&format!(
            r#"{{"method":"start","title":"Weekly","dir":{:?}}}"#,
            dir.to_str().unwrap()
        ))
        .unwrap(),
    );

    assert_eq!(json(&response)["state"], "recording");
    assert!(
        dir.join("mic.wav").exists(),
        "the track files exist from the start"
    );
    assert!(dir.join("system.wav").exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn starting_twice_is_refused_rather_than_losing_the_first_recording() {
    let dir = tempdir("twice");
    let mut service = service(vec![]);
    let start = parse(&format!(
        r#"{{"method":"start","dir":{:?}}}"#,
        dir.to_str().unwrap()
    ))
    .unwrap();
    service.handle(start);

    let again = parse(&format!(
        r#"{{"method":"start","dir":{:?}}}"#,
        dir.to_str().unwrap()
    ))
    .unwrap();
    assert_eq!(json(&service.handle(again))["error"], "already recording");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn pause_and_resume_before_a_recording_say_so() {
    let mut service = service(vec![]);
    assert_eq!(
        json(&service.handle(Request::Pause))["error"],
        "not recording"
    );
    assert_eq!(
        json(&service.handle(Request::Resume))["error"],
        "not recording"
    );
    assert_eq!(
        json(&service.handle(Request::Stop))["error"],
        "not recording"
    );
}

#[test]
fn a_recording_runs_through_pause_resume_and_stop() {
    let dir = tempdir("cycle");
    let mut service = service(vec![Poll::Frames {
        wall_ns: 0,
        samples: vec![0.5; 4800],
    }]);
    let start = parse(&format!(
        r#"{{"method":"start","title":"Fenix","dir":{:?}}}"#,
        dir.to_str().unwrap()
    ))
    .unwrap();
    service.handle(start);
    service.pump();

    assert_eq!(json(&service.handle(Request::Pause))["state"], "paused");
    assert_eq!(json(&service.handle(Request::Resume))["state"], "recording");

    let stopped = json(&service.handle(Request::Stop));
    assert_eq!(stopped["done"], true);

    // The manifest is the record of what happened, and 4.4 names its contents.
    let manifest: RecordingManifest =
        serde_json::from_str(&fs::read_to_string(dir.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(manifest.kind, "recording");
    assert_eq!(manifest.title, "Fenix");
    assert_eq!(manifest.pauses.len(), 1);
    assert!(
        manifest.pauses[0].end_wall_ns.is_some(),
        "a resumed pause is closed"
    );
    assert_eq!(manifest.tracks.mic.file, "mic.wav");
    assert!(manifest.first_frames.mic_wall_ns.is_some());
    assert_eq!(
        manifest.time_map.segments.len(),
        2,
        "one segment either side of the pause"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn the_wav_files_are_readable_and_carry_the_frames() {
    let dir = tempdir("wav");
    let mut service = service(vec![Poll::Frames {
        wall_ns: 0,
        samples: vec![0.5; 4800],
    }]);
    let start = parse(&format!(
        r#"{{"method":"start","dir":{:?}}}"#,
        dir.to_str().unwrap()
    ))
    .unwrap();
    service.handle(start);
    service.pump();
    service.handle(Request::Stop);

    // A header claiming zero frames is what a WAV left unfinished looks like,
    // and every reader believes it.
    let reader = hound::WavReader::open(dir.join("mic.wav")).expect("a readable wav");
    assert!(reader.duration() >= 4800, "the frames are in the file");
    assert_eq!(reader.spec().sample_rate, 48_000);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn devices_are_listed_when_the_machine_has_them() {
    let mut service = service(vec![]);
    let listed = json(&service.handle(Request::Devices));
    assert_eq!(listed["devices"][0]["name"], "Headset");
}

#[test]
fn a_machine_with_no_audio_says_so_rather_than_returning_an_empty_list() {
    let format = AudioFormat {
        sample_rate: 48_000,
        channels: 1,
    };
    let mut service = Service::new(
        SystemClock::new,
        Box::new(ScriptedSource::new(format, "mic", vec![])),
        Box::new(ScriptedSource::new(format, "system", vec![])),
        devices_fail,
    );
    assert_eq!(
        json(&service.handle(Request::Devices))["error"],
        "no audio endpoint"
    );
}

#[test]
fn a_start_into_an_unusable_directory_reports_it() {
    let mut service = service(vec![]);
    // A path whose parent is a file cannot be created.
    let file = std::env::temp_dir().join(format!("ow-rec-file-{}", std::process::id()));
    fs::write(&file, "x").unwrap();
    let dir = file.join("inside");

    let start = parse(&format!(
        r#"{{"method":"start","dir":{:?}}}"#,
        dir.to_str().unwrap()
    ))
    .unwrap();
    let response = json(&service.handle(start));
    assert_eq!(response["ok"], "false");
    assert!(response["error"]
        .as_str()
        .unwrap()
        .contains("could not create"));
    let _ = fs::remove_file(&file);
}

#[test]
fn a_device_change_reaches_the_manifest() {
    let dir = tempdir("devchange");
    let mut service = service(vec![Poll::DeviceChanged {
        device: "new-mic".into(),
    }]);
    let start = parse(&format!(
        r#"{{"method":"start","dir":{:?}}}"#,
        dir.to_str().unwrap()
    ))
    .unwrap();
    service.handle(start);
    service.pump();
    service.handle(Request::Stop);

    let manifest: RecordingManifest =
        serde_json::from_str(&fs::read_to_string(dir.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(manifest.device_changes.len(), 1);
    assert_eq!(manifest.device_changes[0].device, "new-mic");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn status_reports_what_the_recording_lost_and_whether_capture_is_alive() {
    // Silence that nobody flagged, presented as a healthy hour, is the failure
    // this sidecar exists to avoid. Both counters and the fault are in the one
    // response a parent already polls.
    let service = service(vec![]);
    let status = json(&service.status());
    assert_eq!(status["dropped_samples"], 0);
    assert_eq!(status["discontinuities"], 0);
    assert_eq!(status["capture_fault"], serde_json::Value::Null);
}

#[test]
fn a_system_device_that_will_not_start_rolls_the_microphone_back() {
    use recorder::capture::{CaptureError, CaptureSource, Poll};

    struct WontStart(AudioFormat);
    impl CaptureSource for WontStart {
        fn format(&self) -> AudioFormat {
            self.0
        }
        fn device_name(&self) -> String {
            "wont-start".into()
        }
        fn poll(&mut self) -> Result<Poll, CaptureError> {
            Ok(Poll::Idle)
        }
        fn start(&mut self) -> Result<(), CaptureError> {
            Err(CaptureError("device in use".into()))
        }
    }

    let format = AudioFormat {
        sample_rate: 48_000,
        channels: 1,
    };
    let mic = ScriptedSource::new(format, "mic", vec![]);
    let mut service = Service::new(
        SystemClock::new,
        Box::new(mic),
        Box::new(WontStart(format)),
        devices_ok,
    );

    let dir = tempdir("rollback");
    let start = parse(&format!(
        r#"{{"method":"start","dir":{:?}}}"#,
        dir.to_str().unwrap()
    ))
    .unwrap();
    let response = json(&service.handle(start));

    assert_eq!(response["ok"], "false");
    assert!(response["error"].as_str().unwrap().contains("system audio"));
    // Leaving the microphone running would fail the next start with
    // AUDCLNT_E_NOT_STOPPED on a device nobody asked for.
    assert_eq!(json(&service.status())["state"], "idle");
    let _ = fs::remove_dir_all(&dir);
}
