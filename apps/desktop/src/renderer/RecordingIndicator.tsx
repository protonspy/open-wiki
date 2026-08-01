import { describeRecording, type Recording } from "./recording.js";

/** The chrome's recording indicator. Everything it decides is in `recording.ts`. */
export function RecordingIndicator({
  recording,
}: {
  recording: Recording;
}): React.JSX.Element | null {
  const text = describeRecording(recording);
  if (!text.visible) return null;
  return (
    <span className={text.className} role="status" aria-live="polite">
      <span className="recording__dot" aria-hidden="true" />
      {text.label} {text.elapsed}
    </span>
  );
}
