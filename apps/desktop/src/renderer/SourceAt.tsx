import { Copy, Pause, Play, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SourceBrowse, SourceLocation } from "../main/sources.js";
import { humanBytes } from "@open-wiki/access/format";
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
  const [peaks, setPeaks] = useState<number[] | null>(null);

  /**
   * The shape of the sound (5.5), or null while nobody has drawn it yet.
   *
   * Fetched beside the location rather than with it: an hour of Opus takes a
   * moment to decode the first time, and the citation — which is what the
   * panel is *for* — must not wait behind a picture of it.
   */
  useEffect(() => {
    setPeaks(null);
    let live = true;
    void bridge()
      .waveform(id)
      .then((found) => {
        if (live) setPeaks(found);
      })
      .catch(() => {
        // A recording with no Opus yet, a file source, an ffmpeg that is not
        // there: none of them is worth an error in a panel whose subject is
        // the citation. The transport draws a plain bar instead.
        if (live) setPeaks(null);
      });
    return () => {
      live = false;
    };
  }, [id]);

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

            {/* Where in the recording this is, over the shape of the sound
                (5.5). Clicking seeks: the waveform is the one place a reader
                can see where the talking is and go straight to it. */}
            <div className="playbar">
              <Waveform peaks={peaks} />
              <span
                className="playbar__head"
                style={{ left: `${playheadPercent(position, duration)}%` }}
              />
              <button
                type="button"
                className="playbar__seek"
                aria-label="Seek in this recording"
                onClick={(event) => {
                  const element = audio.current;
                  if (!element || duration === null) return;
                  const box = event.currentTarget.getBoundingClientRect();
                  const at = ((event.clientX - box.left) / box.width) * duration;
                  element.currentTime = Math.min(duration, Math.max(0, at));
                }}
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

        {/* 7.4 — an image as an image. The bytes arrive as a `data:` URL
            because the CSP's `img-src` is `'self' data:` and has no `file:`
            in it: `media-src` does, which is how the audio above loads off
            disk, and widening `img-src` to show a picture would answer a real
            constraint by removing it. */}
        {at?.kind === "image" ? (
          <div className="source-at__image">
            <img src={at.dataUrl} alt={at.file} />
          </div>
        ) : null}

        {/* 7.4, 7.5 — an unpacked archive as the listing it is. There is no one
            file to show, and opening the zip beside it shows nobody anything. */}
        {at?.kind === "tree" ? <SourceTree id={id} /> : null}

        {/* 7.4 — anything else: named, and offered to the system. */}
        {at?.kind === "external" ? (
          <div className="transport">
            <span className="transport__at">{at.file}</span>
            <span className="pane-bar__spacer" />
            <Button variant="ghost" size="sm" onClick={() => void bridge().revealSource(id)}>
              Show in folder
            </Button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

/**
 * The files an unpacked archive holds (plan 7.5).
 *
 * Fetched here rather than carried on the location, because a tree is thousands
 * of entries and a citation panel opens on every click: the location answers
 * *what this is* immediately, and the listing arrives after.
 */
function SourceTree({ id }: { id: string }): React.JSX.Element {
  const [browse, setBrowse] = useState<SourceBrowse | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setBrowse(null);
    setFailed(null);
    void bridge()
      .browseSource(id)
      .then((found) => {
        if (live) setBrowse(found);
      })
      .catch((e: unknown) => {
        if (live) setFailed(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [id]);

  if (failed) return <p className="empty">{failed}</p>;
  if (!browse) return <p className="empty">Reading…</p>;
  return (
    <div className="source-tree">
      {/* 6.6 — the tree below is part of an archive rather than all of one. */}
      {browse.incomplete ? (
        <p className="src-name__error">
          This archive was never fully unpacked, so what is below is part of it.
        </p>
      ) : null}
      <ul className="source-tree__list">
        {browse.entries.map((entry) => (
          <li key={entry.path} className={entry.kind === "dir" ? "is-dir" : undefined}>
            <span className="source-tree__path">{entry.path}</span>
            {entry.kind === "file" ? (
              <span className="source-tree__size">{humanBytes(entry.bytes ?? 0)}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {browse.truncated > 0 ? <p className="empty">{browse.truncated} more not shown.</p> : null}
    </div>
  );
}

/** A local path as a URL the renderer may load, per the CSP's `media-src`. */
function fileUrl(path: string): string {
  return `file:///${path.replace(/\\/g, "/").replace(/^\/+/, "")}`;
}

/**
 * The recording, drawn (desktop-ui 5.5).
 *
 * **An SVG rather than a canvas**, which is where this departs from the draft.
 * A canvas needs a pixel width to draw into, and the panel's is whatever the
 * window is — so it would need a resize observer, a device-pixel-ratio
 * multiplier and a redraw on both, to produce a picture that an SVG scales for
 * free. The draft drew a canvas because it was a static HTML mock at a fixed
 * width; nothing else about it argued for one.
 *
 * Static, and rendered once per source: the peaks come from the main process
 * already bucketed, and they cannot change, because sound in `raw/` is sealed.
 * There is no live meter here and there is not meant to be — the recorder is a
 * separate process on purpose, and this is the one place a waveform earns its
 * keep.
 */
function Waveform({ peaks }: { peaks: number[] | null }): React.JSX.Element | null {
  if (!peaks || peaks.length === 0) return null;
  return (
    <svg
      className="playbar__wave"
      viewBox={`0 0 ${peaks.length} 2`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {peaks.map((peak, i) => (
        // Drawn from the centre out, so quiet is a line and loud is a band —
        // the shape somebody scans for "where is the talking".
        <rect key={i} x={i} y={1 - peak} width={1} height={Math.max(0.04, peak * 2)} />
      ))}
    </svg>
  );
}
