import { Copy, Pause, Play, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SourceLocation } from "../main/sources.js";
import { bridge } from "./bridge.js";
import { citationOf, playheadPercent, transportLabel } from "./provenance.js";
import { Button } from "./ui/Button.js";
import { IconButton } from "./ui/IconButton.js";

/**
 * What a provenance link opens (plan 8.6, then desktop-ui 5.4): audio at the
 * instant, a document at the page.
 *
 * **Seeked to the instant rather than started at zero** — that difference is
 * the whole of 8.6. A citation the recording does not contain says so instead,
 * which is the same answer 5.4's checks give when they refuse one.
 *
 * It sits beside the page rather than over it (spec `desktop-shell`, R2.6): you
 * open a citation to check a claim you are in the middle of reading, and a
 * panel that makes the paragraph behind it unreadable has answered the question
 * by taking away the thing that raised it.
 *
 * Every number on screen comes from `provenance.ts`, which is `(TDD)` and goes
 * through `@open-wiki/audio`'s one instant format. Nothing here does time
 * arithmetic of its own.
 */
export function SourceAt({
  id,
  fragment,
  onClose,
}: {
  id: string;
  fragment: string;
  onClose: () => void;
}): React.JSX.Element {
  const [at, setAt] = useState<SourceLocation | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  /** Where the transport is, in seconds — the citation is copied from this. */
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setAt(null);
    setCopied(false);
    setPlaying(false);
    setDuration(null);
    void bridge()
      .locate(id, fragment)
      .then((found) => {
        setAt(found);
        // The instant the citation named, before a single frame has played.
        // Copying before pressing play must give back the citation you opened.
        setPosition(found.kind === "audio" ? found.seconds : 0);
      })
      .catch((e: unknown) =>
        setAt({ kind: "missing", reason: e instanceof Error ? e.message : String(e) }),
      );
  }, [id, fragment]);

  const toggle = useCallback(() => {
    const element = audio.current;
    if (!element) return;
    if (element.paused) void element.play();
    else element.pause();
  }, []);

  /**
   * Copy the citation for where the transport is *now* (5.4).
   *
   * Not the fragment this panel was opened with: the point of listening on is
   * finding the moment the claim was actually made, and a copy button that
   * handed back the citation you already had would make that the one thing the
   * panel cannot do.
   */
  const copy = useCallback(() => {
    if (!at) return;
    const citation = citationOf(id, at.kind === "audio" ? { ...at, seconds: position } : at);
    if (!citation) return;
    void navigator.clipboard.writeText(citation).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  }, [at, id, position]);

  return (
    <aside className="source-at" aria-label="The source this citation opens">
      <div className="pane-bar">
        <span className="pane-title">{id}</span>
        <code className="pane-bar__path">#{fragment}</code>
        <span className="pane-bar__spacer" />
        <IconButton icon={X} label="Close this source" onClick={onClose} />
      </div>

      <div className="source-at__body">
        {!at ? <p className="empty">Looking&hellip;</p> : null}
        {at?.kind === "missing" ? <p className="error">{at.reason}</p> : null}

        {at?.kind === "audio" ? (
          <>
            <div className="transport">
              <Button
                variant="primary"
                size="sm"
                icon={playing ? Pause : Play}
                onClick={toggle}
                aria-pressed={playing}
              >
                {playing ? "Pause" : "Play"}
              </Button>
              <span className="transport__at">{transportLabel(position, duration)}</span>
              <span className="pane-bar__spacer" />
              <Button variant="ghost" size="sm" icon={Copy} onClick={copy}>
                {copied ? "Copied" : "Copy this citation"}
              </Button>
            </div>

            {/* Where in the recording this is. The waveform 5.5 draws goes
                behind it; until then the bar is the shape of the answer. */}
            <div className="playbar">
              <span
                className="playbar__head"
                style={{ left: `${playheadPercent(position, duration)}%` }}
              />
            </div>

            <audio
              ref={audio}
              controls
              src={fileUrl(at.file)}
              // The instant is the point. `preload` has to be metadata or
              // better, or the seek lands before the browser knows how long the
              // file is.
              preload="metadata"
              onLoadedMetadata={(event) => {
                event.currentTarget.currentTime = at.seconds;
                setDuration(
                  Number.isFinite(event.currentTarget.duration)
                    ? event.currentTarget.duration
                    : null,
                );
              }}
              onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
          </>
        ) : null}

        {at?.kind === "document" ? (
          <div className="transport">
            <span className="transport__at">page {at.page}</span>
            <span className="pane-bar__spacer" />
            <Button variant="ghost" size="sm" icon={Copy} onClick={copy}>
              {copied ? "Copied" : "Copy this citation"}
            </Button>
          </div>
        ) : null}

        {at?.kind === "document" ? <p className="empty">{at.file}</p> : null}
      </div>
    </aside>
  );
}

/** A local path as a URL the renderer may load, per the CSP's `media-src`. */
function fileUrl(path: string): string {
  return `file:///${path.replace(/\\/g, "/").replace(/^\/+/, "")}`;
}
