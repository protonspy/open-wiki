use serde::{Deserialize, Serialize};

/// The map from an instant *in the recording* to the instant it really happened
/// (plan 4.3, and the ground 4.7 and 4.11 build on).
///
/// **This is the thing that lies with confidence.** Every provenance link of a
/// claim that came from audio points at a recorded instant; if the map is
/// wrong, the citation opens the recording at the wrong moment, which is worse
/// than having no citation at all. So it is built from segments rather than
/// from an offset: a pause removes real time that the recording does not
/// contain, and adding up "how much pause happened before this point" is the
/// arithmetic that goes quietly wrong.
///
/// A segment is one uninterrupted stretch of capture. Recorded time is
/// contiguous across segments — that is what "the paused stretch leaves both
/// tracks as one block" means — while wall time jumps by the length of the
/// pause.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct TimeMap {
    pub segments: Vec<Segment>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Segment {
    /// Where this segment starts in the recording, in nanoseconds.
    pub recorded_start_ns: u64,
    /// How long it lasts. The last segment grows until the recording stops.
    pub duration_ns: u64,
    /// The wall-clock instant this segment began, in nanoseconds since the
    /// Unix epoch.
    pub wall_start_ns: u64,
}

impl TimeMap {
    pub fn new() -> Self {
        Self {
            segments: Vec::new(),
        }
    }

    /// Total recorded length: what a player's scrubber spans.
    pub fn recorded_duration_ns(&self) -> u64 {
        self.segments
            .last()
            .map_or(0, |last| last.recorded_start_ns + last.duration_ns)
    }

    /// The wall-clock instant a recorded instant happened at, or `None` when
    /// the offset falls outside the recording.
    ///
    /// A segment owns `[start, start + duration)` — half-open. A segment that
    /// captured two seconds holds samples at offsets 0 up to but not including
    /// 2s; the sample *at* 2s is the first one of whatever came next. Owning
    /// the boundary at both ends would put every citation landing exactly on a
    /// pause at the wrong side of it, by the whole length of the pause.
    ///
    /// The one exception is the final instant of the recording, which has no
    /// next segment to belong to and so belongs to the last one.
    pub fn to_wall_ns(&self, recorded_ns: u64) -> Option<u64> {
        let last = self.last_recording_index()?;
        for (i, segment) in self.segments.iter().enumerate() {
            // A zero-length segment recorded nothing, so it answers for no
            // instant — including its own start, which the next one owns.
            if segment.duration_ns == 0 {
                continue;
            }
            let offset = recorded_ns.checked_sub(segment.recorded_start_ns)?;
            let owns = if i == last {
                offset <= segment.duration_ns
            } else {
                offset < segment.duration_ns
            };
            if owns {
                return Some(segment.wall_start_ns + offset);
            }
        }
        None
    }

    /// The index of the last segment that recorded anything.
    fn last_recording_index(&self) -> Option<usize> {
        self.segments.iter().rposition(|s| s.duration_ns > 0)
    }

    /// The recorded offset of a wall-clock instant, or `None` when that instant
    /// falls in a pause — or outside the recording entirely. A moment nobody
    /// captured has no place in the recording, and answering with the nearest
    /// one would be the map lying.
    pub fn to_recorded_ns(&self, wall_ns: u64) -> Option<u64> {
        let last = self.last_recording_index()?;
        for (i, segment) in self.segments.iter().enumerate() {
            if segment.duration_ns == 0 {
                continue;
            }
            if wall_ns < segment.wall_start_ns {
                // Before this segment and after the previous one: the instant
                // falls in a pause, or before the recording began.
                return None;
            }
            let offset = wall_ns - segment.wall_start_ns;
            let owns = if i == last {
                offset <= segment.duration_ns
            } else {
                offset < segment.duration_ns
            };
            if owns {
                return Some(segment.recorded_start_ns + offset);
            }
        }
        None
    }

    /// Begin a segment at `wall_start_ns`, continuing the recorded timeline
    /// from wherever the previous segment ended.
    pub fn begin_segment(&mut self, wall_start_ns: u64) {
        let recorded_start_ns = self.recorded_duration_ns();
        self.segments.push(Segment {
            recorded_start_ns,
            duration_ns: 0,
            wall_start_ns,
        });
    }

    /// Extend the open segment to `wall_now_ns`. Called as frames arrive and
    /// when the segment closes, so the last segment is always current.
    pub fn extend_to(&mut self, wall_now_ns: u64) {
        let Some(open) = self.segments.last_mut() else {
            return;
        };
        // Saturating, and never shortening: a clock that went backwards is not
        // a reason to un-record frames that were written.
        let duration = wall_now_ns.saturating_sub(open.wall_start_ns);
        open.duration_ns = open.duration_ns.max(duration);
    }
}
