//! `start` carrying an endpoint per track (R1.2), refusing one that is not
//! here (R2.4), and `status` carrying the level (R4.1, R4.2).

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use recorder::capture::{AudioFormat, CaptureSource, Poll, ScriptedSource, Which};
use recorder::clock::SystemClock;
use recorder::endpoint::{CapturedEndpoint, Endpoint};
use recorder::rpc::{parse, DeviceInfo, Request, Response};
use recorder::service::Service;

fn format() -> AudioFormat {
    AudioFormat {
        sample_rate: 1_000,
        channels: 1,
    }
}

fn devices_ok() -> Result<Vec<DeviceInfo>, String> {
    Ok(Vec::new())
}

/// A source that reports the endpoint it was opened on, so the service can be
/// asked whether it honoured a choice.
struct OnEndpoint {
    endpoint: CapturedEndpoint,
    script: Vec<Poll>,
    next: usize,
}

impl CaptureSource for OnEndpoint {
    fn format(&self) -> AudioFormat {
        format()
    }
    fn device_name(&self) -> String {
        self.endpoint.name.clone()
    }
    fn endpoint(&self) -> CapturedEndpoint {
        self.endpoint.clone()
    }
    fn poll(&mut self) -> Result<Poll, recorder::capture::CaptureError> {
        let item = self.script.get(self.next).cloned().unwrap_or(Poll::Idle);
        if self.next < self.script.len() {
            self.next += 1;
        }
        Ok(item)
    }
}

fn following(name: &str) -> Box<dyn CaptureSource> {
    Box::new(OnEndpoint {
        endpoint: CapturedEndpoint {
            id: Some(format!("{{default-{name}}}")),
            name: name.into(),
            pinned: false,
        },
        script: Vec::new(),
        next: 0,
    })
}

/// A directory that does not exist yet, unique to this process.
///
/// The process id is in the path deliberately. A fixed name under the system
/// temp directory is shared with every other run on the machine, so a previous
/// run that legitimately created one leaves this one asserting about somebody
/// else's leftovers — which is exactly how the directory-absence check below
/// fails for a reason that has nothing to do with the code.
fn tempdir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("ow-start-{}-{name}", std::process::id()));
    if dir.exists() {
        std::fs::remove_dir_all(&dir).expect("the previous directory goes");
    }
    dir
}

/// A service whose reopen factory records what it was asked for, and answers
/// with a source pinned to it.
fn service_with_factory(asked: Arc<AtomicUsize>, present: Vec<String>) -> Service<SystemClock> {
    Service::new(
        SystemClock::new,
        following("Webcam Microphone"),
        following("Speakers"),
        devices_ok,
    )
    .reopening_with(Box::new(move |which: Which, choice: &Endpoint| {
        asked.fetch_add(1, Ordering::Relaxed);
        match choice {
            Endpoint::Default => Ok(following(which.track())),
            Endpoint::Pinned(id) if present.iter().any(|p| p == id) => Ok(Box::new(OnEndpoint {
                endpoint: CapturedEndpoint {
                    id: Some(id.clone()),
                    name: format!("chosen {id}"),
                    pinned: true,
                },
                script: Vec::new(),
                next: 0,
            })),
            Endpoint::Pinned(id) => Err(format!(
                "the endpoint chosen for the {} track is not on this machine: {id}",
                which.track()
            )),
        }
    }))
}

fn start(dir: &std::path::Path, mic: Option<&str>, system: Option<&str>) -> Request {
    let mut line = format!(
        r#"{{"method":"start","title":"a meeting","dir":{}"#,
        serde_json::to_string(&dir.to_string_lossy()).unwrap()
    );
    if let Some(id) = mic {
        line.push_str(&format!(r#","mic":{}"#, serde_json::to_string(id).unwrap()));
    }
    if let Some(id) = system {
        line.push_str(&format!(
            r#","system":{}"#,
            serde_json::to_string(id).unwrap()
        ));
    }
    line.push('}');
    parse(&line).expect("the line parses")
}

fn is_ok(response: &Response) -> bool {
    matches!(response, Response::Ok(_))
}

fn message(response: &Response) -> String {
    match response {
        Response::Err { error } => error.clone(),
        Response::Ok(_) => panic!("expected a refusal, got success"),
    }
}

#[test]
fn a_start_that_names_no_endpoint_records_as_it_always_did() {
    // R1.3, and every caller written before this field existed. The absence of
    // a choice must not become a refusal.
    let asked = Arc::new(AtomicUsize::new(0));
    let mut service = service_with_factory(Arc::clone(&asked), Vec::new());
    let dir = tempdir("no-endpoint");

    let response = service.handle(start(&dir, None, None));

    assert!(is_ok(&response));
    assert_eq!(
        asked.load(Ordering::Relaxed),
        0,
        "nothing was reopened, because nothing was asked for"
    );
}

#[test]
fn a_start_that_names_an_endpoint_opens_that_endpoint() {
    // R1.2. The whole point: the meeting is on the headset, which is not the
    // Windows default.
    let asked = Arc::new(AtomicUsize::new(0));
    let mut service = service_with_factory(Arc::clone(&asked), vec!["{mic-headset}".into()]);
    let dir = tempdir("chosen");

    let response = service.handle(start(&dir, Some("{mic-headset}"), None));

    assert!(is_ok(&response), "got {}", message(&response));
    assert_eq!(asked.load(Ordering::Relaxed), 1, "one track was reopened");
}

#[test]
fn the_two_tracks_are_chosen_independently() {
    // R1.2 says "independently". Pinning the microphone must not disturb what
    // the system track captures, and vice versa.
    let asked = Arc::new(AtomicUsize::new(0));
    let mut service = service_with_factory(
        Arc::clone(&asked),
        vec!["{mic-headset}".into(), "{out-headphones}".into()],
    );
    let dir = tempdir("both");

    let response = service.handle(start(&dir, Some("{mic-headset}"), Some("{out-headphones}")));

    assert!(is_ok(&response), "got {}", message(&response));
    assert_eq!(asked.load(Ordering::Relaxed), 2);
}

#[test]
fn a_chosen_endpoint_that_is_not_on_this_machine_refuses_the_recording_by_name() {
    // R2.4. Recording the default in its place is the failure the whole spec
    // exists to prevent, and it is worst here — nothing is wrong yet, and
    // nobody finds out until the hour is over.
    let asked = Arc::new(AtomicUsize::new(0));
    let mut service = service_with_factory(Arc::clone(&asked), Vec::new());
    let dir = tempdir("missing");

    let response = service.handle(start(&dir, Some("{mic-from-another-machine}"), None));

    let refusal = message(&response);
    assert!(
        refusal.contains("{mic-from-another-machine}"),
        "the refusal names the endpoint, got: {refusal}"
    );
}

#[test]
fn a_refused_start_leaves_nothing_recording() {
    // A refusal that had already begun a session would leave the sidecar
    // claiming to record while no file was being written.
    let asked = Arc::new(AtomicUsize::new(0));
    let mut service = service_with_factory(Arc::clone(&asked), Vec::new());
    let dir = tempdir("refused");

    let _ = service.handle(start(&dir, Some("{gone}"), None));

    assert!(service.session().is_none(), "no session was left behind");
    // And nothing on disk. `raw/` is where sources live, so an empty directory
    // per refused recording is debris somebody has to learn to recognise — and
    // it looks exactly like a recording that failed to transcribe.
    assert!(
        !dir.exists(),
        "a refused start created {} anyway",
        dir.display()
    );
    let status = service.status();
    match status {
        Response::Ok(_) => {}
        Response::Err { error } => panic!("status should still answer: {error}"),
    }
}

#[test]
fn a_recorder_that_cannot_reopen_refuses_rather_than_recording_the_default() {
    // Without a factory the service has only the devices it was handed. It
    // must say so rather than serve the open one under the chosen one's name.
    let mut service = Service::new(
        SystemClock::new,
        following("Webcam Microphone"),
        following("Speakers"),
        devices_ok,
    );
    let dir = tempdir("no-factory");

    let response = service.handle(start(&dir, Some("{mic-headset}"), None));

    let refusal = message(&response);
    assert!(
        refusal.contains("mic"),
        "the refusal says which track, got: {refusal}"
    );
    assert!(service.session().is_none());
}

#[test]
fn asking_for_the_endpoint_already_open_reopens_nothing() {
    // Reopening a device that is already right costs the first second of the
    // recording for no reason.
    let asked = Arc::new(AtomicUsize::new(0));
    let mut service = Service::new(
        SystemClock::new,
        Box::new(OnEndpoint {
            endpoint: CapturedEndpoint {
                id: Some("{mic-headset}".into()),
                name: "Headset Microphone".into(),
                pinned: true,
            },
            script: Vec::new(),
            next: 0,
        }),
        following("Speakers"),
        devices_ok,
    )
    .reopening_with({
        let asked = Arc::clone(&asked);
        Box::new(move |_which, _choice| {
            asked.fetch_add(1, Ordering::Relaxed);
            Ok(following("unexpected"))
        })
    });
    let dir = tempdir("already");

    let response = service.handle(start(&dir, Some("{mic-headset}"), None));

    assert!(is_ok(&response), "got {}", message(&response));
    assert_eq!(asked.load(Ordering::Relaxed), 0);
}

#[test]
fn a_following_track_sitting_on_the_chosen_endpoint_is_still_reopened() {
    // The mode matters as much as the identifier. A track that merely happens
    // to be on the headset is still following, and will walk off it the moment
    // Windows changes its mind (R2.2) — so pinning it has to actually pin it.
    let asked = Arc::new(AtomicUsize::new(0));
    let mut service = Service::new(
        SystemClock::new,
        Box::new(OnEndpoint {
            endpoint: CapturedEndpoint {
                id: Some("{mic-headset}".into()),
                name: "Headset Microphone".into(),
                pinned: false,
            },
            script: Vec::new(),
            next: 0,
        }),
        following("Speakers"),
        devices_ok,
    )
    .reopening_with({
        let asked = Arc::clone(&asked);
        Box::new(move |_which, choice| {
            asked.fetch_add(1, Ordering::Relaxed);
            Ok(Box::new(OnEndpoint {
                endpoint: CapturedEndpoint {
                    id: choice.pinned_id().map(str::to_string),
                    name: "Headset Microphone".into(),
                    pinned: choice.is_pinned(),
                },
                script: Vec::new(),
                next: 0,
            }))
        })
    });
    let dir = tempdir("same-id-different-mode");

    let response = service.handle(start(&dir, Some("{mic-headset}"), None));

    assert!(is_ok(&response), "got {}", message(&response));
    assert_eq!(asked.load(Ordering::Relaxed), 1, "pinning it re-opened it");
}

#[test]
fn the_endpoint_recorded_in_the_manifest_is_the_one_that_was_chosen() {
    // R3.3, end to end through the protocol rather than through the session.
    let asked = Arc::new(AtomicUsize::new(0));
    let mut service = service_with_factory(Arc::clone(&asked), vec!["{mic-headset}".into()]);
    let dir = tempdir("manifest");

    let response = service.handle(start(&dir, Some("{mic-headset}"), None));
    assert!(is_ok(&response), "got {}", message(&response));

    let session = service.session().expect("a session is recording");
    assert!(session.mic_endpoint().pinned);
    assert_eq!(session.mic_endpoint().id.as_deref(), Some("{mic-headset}"));
    assert!(!session.system_endpoint().pinned);
}

#[test]
fn status_carries_a_level_for_each_track() {
    // R4.1 and R4.2: the level rides the poll that already exists rather than
    // becoming a second framing mode on a protocol that has one.
    let mut service = Service::new(
        SystemClock::new,
        Box::new(ScriptedSource::new(
            format(),
            "Headset Microphone",
            vec![Poll::Frames {
                wall_ns: 0,
                samples: vec![0.5; 200],
            }],
        )),
        Box::new(ScriptedSource::new(format(), "Speakers", Vec::new())),
        devices_ok,
    );
    let dir = tempdir("levels");
    assert!(is_ok(&service.handle(start(&dir, None, None))));

    service.pump();

    let line = recorder::rpc::render(&service.status());
    let parsed: serde_json::Value = serde_json::from_str(&line).expect("valid json");
    assert!(
        parsed["mic_level"]["peak"].as_f64().unwrap_or(0.0) > 0.0,
        "the microphone is hearing something: {line}"
    );
    assert_eq!(parsed["mic_level"]["silent"], false);
    assert_eq!(
        parsed["system_level"]["silent"], true,
        "and the system track is not"
    );
}

#[test]
fn status_before_a_recording_reports_no_level_rather_than_a_quiet_one() {
    let service = Service::new(
        SystemClock::new,
        following("Webcam Microphone"),
        following("Speakers"),
        devices_ok,
    );

    let line = recorder::rpc::render(&service.status());
    let parsed: serde_json::Value = serde_json::from_str(&line).expect("valid json");

    assert_eq!(parsed["state"], "idle");
    assert_eq!(parsed["mic_level"]["peak"], 0.0);
    assert_eq!(parsed["mic_level"]["silent"], true);
}

#[test]
fn the_status_line_is_still_one_object_per_line_with_the_levels_on_it() {
    let service = Service::new(
        SystemClock::new,
        following("Webcam Microphone"),
        following("Speakers"),
        devices_ok,
    );

    let line = recorder::rpc::render(&service.status());

    assert!(!line.contains('\n'), "the framing is one object per line");
}

#[test]
fn an_empty_endpoint_string_means_follow_the_default() {
    // Belt and braces for the wire: a caller that sends `"mic": ""` because a
    // form was left blank means "no choice", not an endpoint whose identifier
    // is the empty string — which would refuse every recording.
    let asked = Arc::new(AtomicUsize::new(0));
    let mut service = service_with_factory(Arc::clone(&asked), Vec::new());
    let dir = tempdir("empty");

    let response = service.handle(start(&dir, Some(""), None));

    assert!(is_ok(&response), "got {}", message(&response));
    assert_eq!(asked.load(Ordering::Relaxed), 0);
}

#[test]
fn a_hostile_identifier_cannot_break_the_line_framing() {
    // The identifier is interpolated into the refusal, and the refusal is a
    // line on stdout. A newline in it would let a caller forge a second reply
    // — `{"ok":"true"}` — that the parent would read as a different answer to
    // a different request.
    //
    // `serde_json` escapes it, and this asserts that rather than trusting it:
    // the property is the whole framing contract of `adr:0005`.
    let asked = Arc::new(AtomicUsize::new(0));
    let mut service = service_with_factory(Arc::clone(&asked), Vec::new());
    let dir = tempdir("hostile");

    let response = service.handle(start(&dir, Some("{evil}\n{\"ok\":\"true\"}"), None));
    let line = recorder::rpc::render(&response);

    assert!(!line.contains('\n'), "one object per line, got: {line}");
    let parsed: serde_json::Value = serde_json::from_str(&line).expect("still valid json");
    assert_eq!(parsed["ok"], "false", "and it is still the refusal");
}

#[test]
fn a_control_character_in_an_identifier_does_not_reach_the_line_raw() {
    let asked = Arc::new(AtomicUsize::new(0));
    let mut service = service_with_factory(Arc::clone(&asked), Vec::new());
    let dir = tempdir("control");

    let response = service.handle(start(&dir, Some("{evil}\r\u{1b}[2K"), None));
    let line = recorder::rpc::render(&response);

    assert!(!line.contains('\r'));
    assert!(!line.contains('\u{1b}'));
    let _: serde_json::Value = serde_json::from_str(&line).expect("valid json");
}

#[test]
fn one_track_resolving_and_the_other_not_leaves_neither_swapped() {
    // A refusal has to leave the recorder exactly as it was, and "exactly" is
    // the whole claim. Installing each track as it resolved put the microphone
    // on a source nobody had asked to record with, under a `start` that was
    // then refused — invisible, because the next `start` corrects it.
    let asked = Arc::new(AtomicUsize::new(0));
    let mut service = service_with_factory(Arc::clone(&asked), vec!["{mic-headset}".into()]);
    let dir = tempdir("half");

    // The microphone resolves; the system endpoint is not on this machine.
    let response = service.handle(start(&dir, Some("{mic-headset}"), Some("{out-gone}")));

    assert!(
        matches!(response, Response::Err { .. }),
        "the start is refused"
    );
    assert!(service.session().is_none());
    assert!(!dir.exists());

    // Both tracks were asked for during the refused start: the microphone
    // resolved, the system endpoint did not.
    let after_refusal = asked.load(Ordering::Relaxed);
    assert_eq!(after_refusal, 2);

    // Now ask for the default on both. A track still *following* satisfies
    // that and is not reopened — so if nothing more is opened, nothing was
    // swapped. If the microphone had been left pinned by the refused start it
    // would fail `satisfies(Default)` and be reopened here, which is the
    // defect stated as something observable rather than as a field nobody can
    // reach.
    let second = tempdir("half-again");
    let response = service.handle(start(&second, None, None));

    assert!(is_ok(&response), "got {}", message(&response));
    assert_eq!(
        asked.load(Ordering::Relaxed),
        after_refusal,
        "the refused start left a track swapped, and the next start had to undo it"
    );
}
