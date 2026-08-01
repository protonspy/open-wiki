use recorder::timemap::{Segment, TimeMap};

const MS: u64 = 1_000_000;
const S: u64 = 1_000_000_000;

/// Wall clock 1000s, recording runs 0-2s, paused 3s, then runs 2-5s recorded.
fn paused_once() -> TimeMap {
    let mut map = TimeMap::new();
    map.begin_segment(1000 * S);
    map.extend_to(1002 * S);
    // Three seconds of pause: the next segment begins at wall 1005s but at
    // recorded 2s, because the recording contains none of the pause.
    map.begin_segment(1005 * S);
    map.extend_to(1008 * S);
    map
}

#[test]
fn an_empty_map_spans_nothing_and_answers_nothing() {
    let map = TimeMap::new();
    assert_eq!(map.recorded_duration_ns(), 0);
    assert_eq!(map.to_wall_ns(0), None);
    assert_eq!(map.to_recorded_ns(1000 * S), None);
}

#[test]
fn a_single_segment_maps_straight_through() {
    let mut map = TimeMap::new();
    map.begin_segment(1000 * S);
    map.extend_to(1010 * S);

    assert_eq!(map.recorded_duration_ns(), 10 * S);
    assert_eq!(map.to_wall_ns(0), Some(1000 * S));
    assert_eq!(map.to_wall_ns(4 * S), Some(1004 * S));
    // The final instant was recorded, so it has an answer.
    assert_eq!(map.to_wall_ns(10 * S), Some(1010 * S));
    assert_eq!(map.to_wall_ns(10 * S + 1), None);
}

#[test]
fn recorded_time_is_contiguous_across_a_pause() {
    // "The paused stretch leaves both tracks as one block" — the recording has
    // no gap in it, so nothing in the recorded timeline jumps.
    let map = paused_once();
    assert_eq!(map.recorded_duration_ns(), 5 * S);
    assert_eq!(map.segments[0].recorded_start_ns, 0);
    assert_eq!(map.segments[1].recorded_start_ns, 2 * S);
}

#[test]
fn wall_time_jumps_by_the_length_of_the_pause() {
    let map = paused_once();
    // Just before the pause.
    assert_eq!(map.to_wall_ns(2 * S - 1), Some(1002 * S - 1));
    // The first instant after it: three seconds later on the wall, one
    // nanosecond later in the recording.
    assert_eq!(map.to_wall_ns(2 * S), Some(1005 * S));
    assert_eq!(map.to_wall_ns(3 * S), Some(1006 * S));
    assert_eq!(map.to_wall_ns(5 * S), Some(1008 * S));
    assert_eq!(map.to_wall_ns(5 * S + 1), None);
}

#[test]
fn the_boundary_instant_belongs_to_the_segment_that_recorded_it() {
    // Exactly 2s is the first instant of segment *two*: a segment owns
    // [start, start + duration), so the boundary belongs to whatever resumed.
    // Getting this backwards moves every citation landing on a pause three
    // seconds, silently — and silently is the whole problem with a time map.
    let map = paused_once();
    assert_eq!(map.to_wall_ns(2 * S - 1), Some(1002 * S - 1));
    assert_eq!(map.to_wall_ns(2 * S), Some(1005 * S));
}

#[test]
fn a_wall_instant_inside_the_recording_maps_back() {
    let map = paused_once();
    assert_eq!(map.to_recorded_ns(1000 * S), Some(0));
    assert_eq!(map.to_recorded_ns(1001 * S), Some(S));
    assert_eq!(map.to_recorded_ns(1006 * S), Some(3 * S));
    assert_eq!(map.to_recorded_ns(1008 * S), Some(5 * S));
}

#[test]
fn a_wall_instant_inside_the_pause_has_no_place_in_the_recording() {
    // Nobody captured it. Answering with the nearest recorded instant would be
    // the map inventing provenance.
    let map = paused_once();
    assert_eq!(map.to_recorded_ns(1003 * S), None);
    assert_eq!(map.to_recorded_ns(1004 * S + 999 * MS), None);
}

#[test]
fn a_wall_instant_outside_the_recording_has_no_place_either() {
    let map = paused_once();
    assert_eq!(map.to_recorded_ns(999 * S), None);
    assert_eq!(map.to_recorded_ns(1009 * S), None);
}

#[test]
fn the_two_directions_agree_everywhere_they_are_defined() {
    // The round trip is the property that matters: if these disagree, one of
    // them is pointing a citation at the wrong moment.
    let map = paused_once();
    let mut checked = 0;
    for recorded in (0..=5 * S).step_by(10 * MS as usize) {
        let wall = map.to_wall_ns(recorded).expect("inside the recording");
        assert_eq!(
            map.to_recorded_ns(wall),
            Some(recorded),
            "at recorded {recorded}"
        );
        checked += 1;
    }
    assert!(
        checked > 400,
        "the sweep has to actually cover the recording"
    );
}

#[test]
fn extend_to_moves_only_the_open_segment() {
    let mut map = paused_once();
    map.extend_to(1010 * S);
    assert_eq!(
        map.segments[0].duration_ns,
        2 * S,
        "a closed segment is closed"
    );
    assert_eq!(map.segments[1].duration_ns, 5 * S);
    assert_eq!(map.recorded_duration_ns(), 7 * S);
}

#[test]
fn extending_backwards_does_not_shorten_a_segment() {
    // A clock that goes backwards is not a reason to shorten the recording:
    // the frames were written.
    let mut map = TimeMap::new();
    map.begin_segment(1000 * S);
    map.extend_to(1005 * S);
    map.extend_to(1004 * S);
    assert_eq!(map.recorded_duration_ns(), 5 * S);
}

#[test]
fn many_pauses_accumulate_correctly() {
    // The failure this guards is the plausible one: adding up the pauses
    // before a point, and getting it right for one pause but not for four.
    let mut map = TimeMap::new();
    let mut wall = 1000 * S;
    for _ in 0..4 {
        map.begin_segment(wall);
        map.extend_to(wall + S);
        wall += S + 10 * S; // one second recorded, ten seconds paused
    }
    assert_eq!(map.recorded_duration_ns(), 4 * S);
    assert_eq!(map.to_wall_ns(0), Some(1000 * S));
    // Exactly 1s is the first instant of the *second* segment, not the last of
    // the first: a segment owns [start, start + duration). Owning both ends
    // would put a citation landing on a pause boundary ten seconds early here.
    assert_eq!(map.to_wall_ns(S - 1), Some(1000 * S + 999_999_999));
    assert_eq!(map.to_wall_ns(S), Some(1011 * S));
    assert_eq!(map.to_wall_ns(S + 1), Some(1011 * S + 1));
    assert_eq!(map.to_wall_ns(3 * S + 500 * MS), Some(1033 * S + 500 * MS));
    assert_eq!(map.to_wall_ns(4 * S), Some(1034 * S));
}

#[test]
fn a_zero_length_segment_is_skipped_rather_than_answering_for_an_instant() {
    // Start and stop with no frames between: it recorded nothing, so it must
    // not claim an instant that the next segment owns.
    let mut map = TimeMap::new();
    map.begin_segment(1000 * S);
    map.begin_segment(1005 * S);
    map.extend_to(1006 * S);
    assert_eq!(map.recorded_duration_ns(), S);
    assert_eq!(map.to_wall_ns(0), Some(1005 * S));
}

#[test]
fn segments_serialise_as_data_a_later_stage_can_read() {
    // 4.7 and 4.11 read this back to reconstruct absolute timestamps.
    let map = paused_once();
    let json = serde_json::to_string(&map).expect("serialises");
    let back: TimeMap = serde_json::from_str(&json).expect("round trips");
    assert_eq!(back, map);
    assert_eq!(
        back.segments[0],
        Segment {
            recorded_start_ns: 0,
            duration_ns: 2 * S,
            wall_start_ns: 1000 * S
        }
    );
}
