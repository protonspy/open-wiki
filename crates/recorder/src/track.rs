/// One recorded track: the samples, and the silence that stands in for the
/// frames the API never delivered (plan 4.1).
///
/// **The silence is not padding for tidiness.** WASAPI loopback returns no
/// frames at all while nobody is playing sound, so a track written only from
/// what arrives is shorter than the meeting by however long the far end was
/// quiet — and every instant after the first silence points at the wrong
/// moment. The track's length has to be a function of elapsed time, not of how
/// much audio the device felt like handing over.
pub struct TrackWriter {
    sample_rate: u32,
    channels: u16,
    frames_written: u64,
    /// Where the open segment began on the wall clock, and at what frame.
    segment: Option<SegmentAnchor>,
    /// Retained only while no file is attached — a test inspects these. An
    /// hour of 48 kHz stereo is 691 MB, so a real recording streams instead of
    /// holding them.
    samples: Vec<f32>,
    wav: Option<hound::WavWriter<std::io::BufWriter<std::fs::File>>>,
    /// Samples the file refused. A disk that fills mid-meeting must not leave
    /// a manifest describing audio the file does not contain.
    failed_samples: u64,
}

#[derive(Debug, Clone, Copy)]
struct SegmentAnchor {
    wall_start_ns: u64,
    frames_at_start: u64,
}

impl TrackWriter {
    pub fn new(sample_rate: u32, channels: u16) -> Self {
        Self {
            sample_rate,
            channels,
            frames_written: 0,
            segment: None,
            samples: Vec::new(),
            wav: None,
            failed_samples: 0,
        }
    }

    /// Stream to a WAV file instead of holding the samples in memory.
    ///
    /// 32-bit float, the format the device hands over, so nothing is quantised
    /// on the way to a file that ffmpeg reads once and deletes
    /// (`adr:0006-opus-as-the-provenance-format`).
    pub fn attach_wav(&mut self, path: &std::path::Path) -> Result<(), hound::Error> {
        let spec = hound::WavSpec {
            channels: self.channels,
            sample_rate: self.sample_rate,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };
        let mut writer = hound::WavWriter::create(path, spec)?;
        // Anything buffered before the file existed still belongs in it.
        for sample in self.samples.drain(..) {
            writer.write_sample(sample)?;
        }
        self.wav = Some(writer);
        Ok(())
    }

    /// Finish the WAV file, writing its header. Losing this leaves a file
    /// whose header claims zero frames, which every reader believes.
    pub fn finalize(&mut self) -> Result<(), hound::Error> {
        if let Some(writer) = self.wav.take() {
            writer.finalize()?;
        }
        Ok(())
    }

    /// Samples the file would not take. Non-zero means the manifest's frame
    /// count is larger than what is actually on disk.
    pub fn failed_samples(&self) -> u64 {
        self.failed_samples
    }

    /// The largest a WAV may grow. `hound` counts data bytes in a `u32`, so
    /// past 4 GiB the header wraps and claims a small length — every reader
    /// then sees a fraction of the file and the rest of the meeting is gone.
    /// At 48 kHz stereo float that is a little over three hours.
    pub fn at_size_limit(&self) -> bool {
        let bytes = self.frames_written * u64::from(self.channels) * 4 + 44;
        bytes >= u64::from(u32::MAX) - 1_000_000
    }

    /// Send samples to wherever this track is writing.
    fn emit(&mut self, frames: &[f32]) {
        match self.wav.as_mut() {
            Some(writer) => {
                let mut failed = 0u64;
                for sample in frames {
                    // A write that fails mid-recording must not take the
                    // session down; the frames are lost, the recording is not.
                    // But they are counted, because a frame count that
                    // includes samples no file holds is a time map that points
                    // at audio which is not there.
                    if writer.write_sample(*sample).is_err() {
                        failed += 1;
                    }
                }
                self.failed_samples += failed;
            }
            None => self.samples.extend_from_slice(frames),
        }
    }

    /// Send `count` frames of silence.
    fn emit_silence(&mut self, frames: u64) {
        let samples = frames
            .saturating_mul(u64::from(self.channels))
            .try_into()
            .unwrap_or(usize::MAX);
        match self.wav.as_mut() {
            Some(writer) => {
                let mut failed = 0u64;
                for _ in 0..samples {
                    if writer.write_sample(0.0f32).is_err() {
                        failed += 1;
                    }
                }
                self.failed_samples += failed;
            }
            None => self.samples.resize(self.samples.len() + samples, 0.0),
        }
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn channels(&self) -> u16 {
        self.channels
    }

    /// Frames written so far, silence included. This is the track's length.
    pub fn frames_written(&self) -> u64 {
        self.frames_written
    }

    /// The interleaved samples written so far.
    pub fn samples(&self) -> &[f32] {
        &self.samples
    }

    /// Open a segment. Frames continue from where the last one ended, which is
    /// what leaves a paused recording as one block rather than two files.
    pub fn begin_segment(&mut self, wall_start_ns: u64) {
        self.segment = Some(SegmentAnchor {
            wall_start_ns,
            frames_at_start: self.frames_written,
        });
    }

    /// Close the open segment. Nothing is padded on close: the frames that
    /// arrived are the frames that were recorded, and inventing silence up to
    /// the moment the user pressed pause would lengthen the track by the
    /// latency of the click.
    pub fn end_segment(&mut self) {
        self.segment = None;
    }

    /// How many frames this track *should* hold at `wall_ns`, given where the
    /// open segment started.
    pub fn expected_frames_at(&self, wall_ns: u64) -> u64 {
        let Some(anchor) = self.segment else {
            return self.frames_written;
        };
        let elapsed_ns = wall_ns.saturating_sub(anchor.wall_start_ns);
        // 128-bit for the multiply: `elapsed_ns * sample_rate` passes 2^64
        // after about six minutes at 48 kHz, and a meeting is an hour.
        let frames = (u128::from(elapsed_ns) * u128::from(self.sample_rate)) / 1_000_000_000u128;
        anchor.frames_at_start + u64::try_from(frames).unwrap_or(u64::MAX)
    }

    /// Manufacture silence up to `wall_ns`. Returns the number of silent frames
    /// inserted. Called when the device delivered nothing.
    pub fn pad_to(&mut self, wall_ns: u64) -> u64 {
        if self.segment.is_none() {
            return 0;
        }
        let expected = self.expected_frames_at(wall_ns);
        let Some(missing) = expected.checked_sub(self.frames_written) else {
            return 0;
        };
        if missing == 0 {
            return 0;
        }
        self.emit_silence(missing);
        self.frames_written += missing;
        missing
    }

    /// Append frames the device just handed over. Returns the frames appended.
    ///
    /// Nothing is padded here. Silence is a **trailing** fill: the session
    /// appends whatever arrived and then pads both tracks to one shared clock
    /// reading, which is what keeps them exactly the same length. Padding
    /// ahead of the frames as well would count the elapsed second twice — once
    /// as silence and once as the audio that filled it — and double the track.
    pub fn append(&mut self, frames: &[f32]) -> u64 {
        if self.segment.is_none() || frames.is_empty() {
            return 0;
        }
        // Whole frames only. Writing a trailing partial frame put samples in
        // the file that `frames_written` never counted, so every later
        // `pad_to` computed its gap from a length the file did not have.
        let channels = usize::from(self.channels.max(1));
        let whole = (frames.len() / channels) * channels;
        if whole == 0 {
            return 0;
        }
        self.emit(&frames[..whole]);
        let appended = (whole / channels) as u64;
        self.frames_written += appended;
        appended
    }
}
