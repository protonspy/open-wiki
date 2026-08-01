use recorder::track::TrackWriter;

const S: u64 = 1_000_000_000;
const RATE: u32 = 48_000;

/// One second of mono frames at `value`.
fn frames(n: usize, value: f32) -> Vec<f32> {
    vec![value; n]
}

#[test]
fn a_new_track_is_empty() {
    let track = TrackWriter::new(RATE, 1);
    assert_eq!(track.frames_written(), 0);
    assert_eq!(track.samples().len(), 0);
    assert_eq!(track.sample_rate(), RATE);
    assert_eq!(track.channels(), 1);
}

#[test]
fn appending_writes_only_its_own_frames() {
    let mut track = TrackWriter::new(RATE, 1);
    track.begin_segment(1000 * S);
    assert_eq!(track.append(&frames(480, 0.5)), 480);
    assert_eq!(track.frames_written(), 480);
    assert_eq!(track.samples()[0], 0.5);
}

#[test]
fn silence_covers_the_stretch_the_device_gave_nothing_for() {
    // The loopback delivered nothing for half a second because nobody was
    // playing sound. The track still has to be half a second long, or every
    // instant after this points half a second early.
    let mut track = TrackWriter::new(RATE, 1);
    track.begin_segment(1000 * S);
    let inserted = track.pad_to(1000 * S + S / 2);
    track.append(&frames(480, 0.5));

    assert_eq!(inserted, 24_000, "half a second at 48kHz");
    assert_eq!(track.frames_written(), 24_480);
    assert!(track.samples()[..24_000].iter().all(|s| *s == 0.0));
    assert_eq!(track.samples()[24_000], 0.5);
}

#[test]
fn audio_that_arrived_counts_against_the_silence_that_would_have_filled_it() {
    // A second of wall time with a second of audio in it is one second of
    // track, not two. Padding to "now" and then appending the frames that
    // covered that same second doubles the recording.
    let mut track = TrackWriter::new(RATE, 1);
    track.begin_segment(1000 * S);
    track.append(&frames(48_000, 0.5));
    assert_eq!(
        track.pad_to(1000 * S + S),
        0,
        "the audio already covers the second"
    );
    assert_eq!(track.frames_written(), 48_000);
}

#[test]
fn pad_to_lengthens_the_track_when_nothing_arrived_at_all() {
    let mut track = TrackWriter::new(RATE, 1);
    track.begin_segment(1000 * S);
    assert_eq!(track.pad_to(1000 * S + S), 48_000);
    assert_eq!(track.frames_written(), 48_000);
    assert!(track.samples().iter().all(|s| *s == 0.0));
}

#[test]
fn padding_is_idempotent_at_the_same_instant() {
    let mut track = TrackWriter::new(RATE, 1);
    track.begin_segment(1000 * S);
    track.pad_to(1000 * S + S);
    assert_eq!(track.pad_to(1000 * S + S), 0);
    assert_eq!(track.frames_written(), 48_000);
}

#[test]
fn padding_to_an_earlier_instant_does_not_rewind_the_track() {
    // A clock reading that goes backwards, or frames that arrived late, must
    // not truncate audio that is already written.
    let mut track = TrackWriter::new(RATE, 1);
    track.begin_segment(1000 * S);
    track.pad_to(1000 * S + S);
    assert_eq!(track.pad_to(1000 * S + S / 2), 0);
    assert_eq!(track.frames_written(), 48_000);
}

#[test]
fn channels_are_counted_as_frames_not_as_samples() {
    // A stereo packet of 480 frames is 960 samples. Confusing the two halves
    // or doubles every timestamp downstream.
    let mut track = TrackWriter::new(RATE, 2);
    track.begin_segment(1000 * S);
    track.append(&frames(960, 0.25));
    assert_eq!(track.frames_written(), 480);
    assert_eq!(track.samples().len(), 960);
}

#[test]
fn a_gap_in_a_stereo_track_inserts_silence_for_every_channel() {
    let mut track = TrackWriter::new(RATE, 2);
    track.begin_segment(1000 * S);
    let inserted = track.pad_to(1000 * S + S / 2);
    track.append(&frames(960, 0.25));
    assert_eq!(inserted, 24_000, "frames, not samples");
    assert_eq!(track.samples().len(), 24_000 * 2 + 960);
}

#[test]
fn a_paused_stretch_leaves_the_track_as_one_block() {
    // This is the property 4.3 names: the recording contains no pause, so the
    // second segment continues straight on from the first.
    let mut track = TrackWriter::new(RATE, 1);
    track.begin_segment(1000 * S);
    track.append(&frames(48_000, 0.5));
    track.end_segment();

    // Ten seconds of pause, then resume.
    track.begin_segment(1010 * S);
    track.append(&frames(48_000, 0.75));

    assert_eq!(track.frames_written(), 96_000, "no silence for the pause");
    assert_eq!(track.samples()[47_999], 0.5);
    assert_eq!(track.samples()[48_000], 0.75);
}

#[test]
fn closing_a_segment_pads_nothing() {
    // Padding to the moment the user clicked would stretch the track by the
    // latency of the click, on every pause.
    let mut track = TrackWriter::new(RATE, 1);
    track.begin_segment(1000 * S);
    track.append(&frames(480, 0.5));
    track.end_segment();
    assert_eq!(track.frames_written(), 480);
}

#[test]
fn expected_frames_track_elapsed_time_within_a_segment() {
    let mut track = TrackWriter::new(RATE, 1);
    track.begin_segment(1000 * S);
    assert_eq!(track.expected_frames_at(1000 * S), 0);
    assert_eq!(track.expected_frames_at(1001 * S), 48_000);

    // Frames actually written, so the assertion below is binding: without
    // them it passes whether or not `begin_segment` resets the count.
    track.append(&frames(24_000, 0.5));
    track.end_segment();

    track.begin_segment(2000 * S);
    // The second segment continues the frame count rather than restarting it.
    assert_eq!(track.expected_frames_at(2001 * S), 24_000 + 48_000);
}

#[test]
fn nothing_is_written_before_a_segment_opens() {
    let mut track = TrackWriter::new(RATE, 1);
    assert_eq!(track.pad_to(1000 * S), 0);
    assert_eq!(track.append(&frames(480, 0.5)), 0);
    assert_eq!(track.frames_written(), 0, "a closed track records nothing");
}

#[test]
fn an_hour_of_silence_is_the_right_length() {
    // The arithmetic that goes wrong at scale: 3600s at 48kHz is 172.8M frames,
    // well past what 32 bits holds.
    let mut track = TrackWriter::new(RATE, 1);
    track.begin_segment(0);
    assert_eq!(track.pad_to(3600 * S), 172_800_000);
    assert_eq!(track.frames_written(), 172_800_000);
}
