use recorder::rpc::{
    error, parse, render, DeviceInfo, Payload, Request, Response, StatusPayload, TrackLevel,
};

#[test]
fn every_method_the_contract_names_parses() {
    // adr:0005 fixes these six. A seventh needs a record that supersedes it.
    assert!(matches!(
        parse(r#"{"method":"start","title":"Weekly","dir":"/tmp/rec"}"#),
        Ok(Request::Start(_))
    ));
    assert_eq!(parse(r#"{"method":"pause"}"#), Ok(Request::Pause));
    assert_eq!(parse(r#"{"method":"resume"}"#), Ok(Request::Resume));
    assert_eq!(parse(r#"{"method":"stop"}"#), Ok(Request::Stop));
    assert_eq!(parse(r#"{"method":"status"}"#), Ok(Request::Status));
    assert_eq!(parse(r#"{"method":"devices"}"#), Ok(Request::Devices));
}

#[test]
fn start_carries_the_title_and_the_directory() {
    let Ok(Request::Start(params)) = parse(r#"{"method":"start","title":"Fenix","dir":"/tmp/r"}"#)
    else {
        panic!("start should parse");
    };
    assert_eq!(params.title, "Fenix");
    assert_eq!(params.dir, "/tmp/r");
}

#[test]
fn a_start_with_no_title_is_accepted_rather_than_blocking_capture() {
    // 4.16: an empty occasion falls back to the timestamp rather than refusing
    // to record, because the recording is the thing that cannot be redone.
    let Ok(Request::Start(params)) = parse(r#"{"method":"start","dir":"/tmp/r"}"#) else {
        panic!("start should parse without a title");
    };
    assert_eq!(params.title, "");
}

#[test]
fn a_method_outside_the_contract_is_refused() {
    assert!(parse(r#"{"method":"levels"}"#).is_err());
}

#[test]
fn a_malformed_line_is_an_error_not_a_panic() {
    // The caller is a program. A panic leaves it waiting forever.
    assert!(parse("not json at all").is_err());
    assert!(parse("").is_err());
    assert!(parse("{}").is_err());
}

#[test]
fn a_start_without_a_directory_is_refused() {
    assert!(parse(r#"{"method":"start","title":"x"}"#).is_err());
}

#[test]
fn a_status_response_renders_as_one_line_of_json() {
    let response = Response::Ok(Payload::Status(StatusPayload {
        state: "recording".into(),
        recorded_ms: 1234,
        mic_frames: 59_232,
        system_frames: 59_232,
        pauses: 1,
        dropped_samples: 0,
        discontinuities: 0,
        capture_fault: None,
        device_changes: 0,
        lost_tracks: Vec::new(),
        mic_level: TrackLevel::default(),
        system_level: TrackLevel::default(),
    }));
    let line = render(&response);
    assert!(!line.contains('\n'), "the framing is one object per line");
    let parsed: serde_json::Value = serde_json::from_str(&line).expect("valid json");
    assert_eq!(parsed["ok"], "true");
    assert_eq!(parsed["state"], "recording");
    assert_eq!(parsed["recorded_ms"], 1234);
    // A clean recording says so, rather than leaving the caller to infer it.
    assert_eq!(parsed["dropped_samples"], 0);
    assert_eq!(parsed["capture_fault"], serde_json::Value::Null);
}

#[test]
fn a_device_list_renders_with_what_the_ui_needs_to_choose() {
    let response = Response::Ok(Payload::Devices {
        devices: vec![DeviceInfo {
            id: "{0.0.1}".into(),
            name: "Headset".into(),
            kind: "capture".into(),
            default: true,
        }],
    });
    let parsed: serde_json::Value = serde_json::from_str(&render(&response)).expect("valid json");
    assert_eq!(parsed["devices"][0]["name"], "Headset");
    assert_eq!(parsed["devices"][0]["kind"], "capture");
    assert_eq!(parsed["devices"][0]["default"], true);
}

#[test]
fn an_error_says_what_went_wrong() {
    let parsed: serde_json::Value =
        serde_json::from_str(&render(&error("no capture device"))).expect("valid json");
    assert_eq!(parsed["ok"], "false");
    assert_eq!(parsed["error"], "no capture device");
}
