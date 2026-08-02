import { Mic, Pause, Play, Settings2, Square } from "lucide-react";
import { RecordingIndicator } from "./RecordingIndicator.js";
import type { Recording } from "./recording.js";
import { Button } from "./ui/Button.js";
import { IconButton } from "./ui/IconButton.js";

/**
 * The titlebar (spec `desktop-shell`, R3).
 *
 * **What is here is what is true regardless of which pane is open**, and that
 * is the whole rule for what belongs: which project you are in, and whether you
 * are being recorded. Both are questions whose answer must never require
 * looking somewhere — and the recording one especially, because this
 * application captures other people's conversation and somebody who forgets it
 * is running has a recording of a meeting the room thinks ended.
 *
 * The pause and stop controls sit beside the indicator rather than on the
 * sources pane for the same reason: the moment you need them is the moment you
 * are looking at something else.
 */
export interface TitlebarProps {
  project: string;
  recording: Recording;
  onRecord: (action: "start" | "pause" | "resume" | "stop") => void;
  onSettings: () => void;
}

export function Titlebar({
  project,
  recording,
  onRecord,
  onSettings,
}: TitlebarProps): React.JSX.Element {
  const running = recording.state !== "idle";
  return (
    <header className="titlebar">
      <span className="chrome__project">{project}</span>
      <span className="chrome__spacer" />

      <RecordingIndicator recording={recording} />

      {running ? (
        <>
          {recording.state === "paused" ? (
            <IconButton icon={Play} label="Resume recording" onClick={() => onRecord("resume")} />
          ) : (
            <IconButton icon={Pause} label="Pause recording" onClick={() => onRecord("pause")} />
          )}
          <IconButton icon={Square} label="Stop recording" onClick={() => onRecord("stop")} />
        </>
      ) : (
        <Button size="sm" icon={Mic} onClick={() => onRecord("start")}>
          Record
        </Button>
      )}

      <IconButton icon={Settings2} label="Settings" onClick={onSettings} />
    </header>
  );
}
