/// The clock the recording is timed against.
///
/// Two readings, deliberately separate: a monotonic one that cannot jump when
/// the system clock is corrected, and a wall-clock one that says what time it
/// actually was. Alignment and durations come from the monotonic reading; only
/// the recording's start instant comes from the wall clock, and the manifest
/// records that once.
pub trait Clock {
    /// Nanoseconds from an arbitrary origin, never decreasing. QPC on Windows.
    fn monotonic_ns(&self) -> u64;
    /// Nanoseconds since the Unix epoch.
    fn wall_ns(&self) -> u64;
}

/// A borrowed clock is a clock. This is what lets a test hold a `FakeClock`,
/// hand the session `&clock`, and still advance it — the session's timing is
/// driven entirely by clock readings, so a test that cannot move the clock
/// cannot exercise any of it.
impl<T: Clock + ?Sized> Clock for &T {
    fn monotonic_ns(&self) -> u64 {
        (**self).monotonic_ns()
    }

    fn wall_ns(&self) -> u64 {
        (**self).wall_ns()
    }
}

/// The real clock.
pub struct SystemClock {
    origin: std::time::Instant,
}

impl Default for SystemClock {
    fn default() -> Self {
        Self::new()
    }
}

impl SystemClock {
    pub fn new() -> Self {
        Self {
            origin: std::time::Instant::now(),
        }
    }
}

impl Clock for SystemClock {
    fn monotonic_ns(&self) -> u64 {
        // `Instant` is QPC on Windows, which is the clock adr:0005 names.
        u64::try_from(self.origin.elapsed().as_nanos()).unwrap_or(u64::MAX)
    }

    fn wall_ns(&self) -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| u64::try_from(d.as_nanos()).unwrap_or(u64::MAX))
            .unwrap_or(0)
    }
}

/// A clock a test drives by hand.
#[derive(Debug, Default)]
pub struct FakeClock {
    monotonic_ns: std::cell::Cell<u64>,
    wall_offset_ns: u64,
}

impl FakeClock {
    pub fn starting_at(wall_ns: u64) -> Self {
        Self {
            monotonic_ns: std::cell::Cell::new(0),
            wall_offset_ns: wall_ns,
        }
    }

    pub fn advance(&self, ns: u64) {
        self.monotonic_ns.set(self.monotonic_ns.get() + ns);
    }

    pub fn set(&self, ns: u64) {
        self.monotonic_ns.set(ns);
    }
}

impl Clock for FakeClock {
    fn monotonic_ns(&self) -> u64 {
        self.monotonic_ns.get()
    }

    fn wall_ns(&self) -> u64 {
        self.wall_offset_ns + self.monotonic_ns.get()
    }
}
