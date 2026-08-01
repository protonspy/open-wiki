import { useEffect, useState } from "react";
import { hasBridge, bridge } from "./bridge.js";

/**
 * The persistent recording indicator (plan 8.1 and 8.2).
 *
 * It is persistent because of what happens when it is not: this application
 * captures a meeting, and somebody who forgets it is running ends up with a
 * recording of a conversation the other people in it believe ended. The
 * indicator is in the window chrome, on every screen, and it is red.
 *
 * The state machine is here rather than in the component so it can be tested
 * without a DOM — `describeRecording` is the whole of what the indicator says.
 */

export type RecordingState = "idle" | "recording" | "paused";

export interface Recording {
  state: RecordingState;
  /** How much of the recording exists, in milliseconds. */
  recordedMs: number;
}

export const IDLE: Recording = { state: "idle", recordedMs: 0 };

/**
 * Read a `status` payload from the sidecar. Its `state` is a Rust enum
 * rendered lowercase, and anything this does not recognise reads as idle: an
 * indicator that says "recording" because a field arrived misspelled is worse
 * than one that says nothing.
 */
export function readStatus(payload: unknown): Recording {
  if (typeof payload !== "object" || payload === null) return IDLE;
  const status = payload as { state?: unknown; recorded_ms?: unknown };
  const state = status.state === "recording" || status.state === "paused" ? status.state : "idle";
  const recordedMs = Number.isFinite(status.recorded_ms) ? Number(status.recorded_ms) : 0;
  return { state, recordedMs };
}

/** `1:04:07` while recording an hour, `04:07` before that. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export interface IndicatorText {
  visible: boolean;
  label: string;
  elapsed: string;
  className: string;
}

/** Everything the indicator renders, as data. */
export function describeRecording(recording: Recording): IndicatorText {
  if (recording.state === "idle") {
    return { visible: false, label: "", elapsed: "", className: "recording" };
  }
  return {
    visible: true,
    label: recording.state === "paused" ? "Paused" : "Recording",
    elapsed: formatElapsed(recording.recordedMs),
    className: recording.state === "paused" ? "recording recording--paused" : "recording",
  };
}

/** How often the chrome asks the sidecar where it is. */
export const POLL_MS = 1000;

export function useRecording(pollMs = POLL_MS): Recording {
  const [recording, setRecording] = useState<Recording>(IDLE);
  useEffect(() => {
    if (!hasBridge()) return;
    let live = true;
    const tick = async (): Promise<void> => {
      try {
        const status = await bridge().recordStatus();
        if (live) setRecording(readStatus(status));
      } catch {
        // No sidecar running is the ordinary case, not an error worth a
        // banner: it means nothing is being recorded.
        if (live) setRecording(IDLE);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), pollMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [pollMs]);
  return recording;
}
