import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageView, ProjectInfo, WikiIndex } from "../main/api.js";
import { bridge, hasBridge } from "./bridge.js";
import { renderPageBody } from "./markdown.js";
import { isOpenPage } from "../main/watcher.js";
import { History, linkTarget, type Location } from "./navigation.js";
import { RecordingIndicator } from "./RecordingIndicator.js";
import { useRecording, type RecordingState } from "./recording.js";

/**
 * How long a burst of folder changes is gathered before the screen redraws.
 * An agent writing twenty pages is twenty events, and both `wikiIndex` and
 * `readPage` walk the whole tree.
 */
const COALESCE_MS = 120;

/**
 * The shell (plan 8.2), and browsing the wiki inside it (plan 8.5).
 *
 * The components in this file are deliberately dumb: every decision they would
 * otherwise make — where Back goes, what an anchor means, how a page becomes
 * HTML — is a function in a `.ts` module beside them, which is what a test can
 * reach. What is left is arranging the results.
 */
export function App(): React.JSX.Element {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [index, setIndex] = useState<WikiIndex>({ pages: [], slugs: [] });
  const [page, setPage] = useState<PageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const history = useRef(new History());
  const [location, setLocation] = useState<Location>({ view: "wiki" });
  const recording = useRecording();

  const refreshIndex = useCallback(async () => {
    try {
      setIndex(await bridge().index());
    } catch (e) {
      setError(message(e));
    }
  }, []);

  const reload = useCallback(async (slug: string) => {
    try {
      setPage(await bridge().page(slug));
      setError(null);
    } catch (e) {
      setPage(null);
      setError(message(e));
    }
  }, []);

  const go = useCallback((next: Location | null) => {
    if (!next) return;
    setLocation(next);
  }, []);

  const visit = useCallback(
    (next: Location) => {
      go(history.current.visit(next));
    },
    [go],
  );

  useEffect(() => {
    if (!hasBridge()) {
      setError("this page is not running inside the application");
      return;
    }
    void bridge()
      .project()
      .then(setProject)
      .catch((e: unknown) => setError(message(e)));
    void refreshIndex();
  }, [refreshIndex]);

  // 8.10 — the folder changed, whoever wrote it. The index is rebuilt because
  // a new page changes which wikilinks resolve, and the open page is re-read
  // only when it is the one that moved.
  //
  // Coalesced: an agent writing twenty pages, or a `git checkout`, is twenty
  // events, and both `wikiIndex` and `readPage` walk the whole tree.
  useEffect(() => {
    if (!hasBridge()) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let reloadPage = false;
    const unsubscribe = bridge().onChanged((change) => {
      if (change.area !== "wiki") return;
      reloadPage ||= isOpenPage(change, location.slug);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void refreshIndex();
        if (reloadPage && location.slug) void reload(location.slug);
        reloadPage = false;
      }, COALESCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [location.slug, refreshIndex, reload]);

  useEffect(() => {
    if (location.view !== "wiki" || !location.slug) {
      setPage(null);
      return;
    }
    void reload(location.slug);
  }, [location, reload]);

  const html = useMemo(
    () => (page ? renderPageBody(page.body, { slugs: index.slugs }) : ""),
    [page, index.slugs],
  );

  // One handler for the whole rendered page. `onAuxClick` as well as `onClick`
  // because Chromium dispatches the middle button as `auxclick` — and a middle
  // click on a link is what asks Electron to open a new window, which is the
  // one path that reaches `shell.openExternal`.
  const onPageClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (event.target as HTMLElement).closest("a, span[title]");
      if (!anchor) return;
      const target = linkTarget(anchor);
      // Only what the application handles is cancelled. An external link is
      // left to the main process, which allowlists the scheme and hands it to
      // the system browser — cancelling here would make every external link in
      // the wiki quietly do nothing.
      if (target.kind === "page") {
        event.preventDefault();
        visit({ view: "wiki", slug: target.slug });
      } else if (target.kind === "source") {
        // 8.6 opens it at the instant. Until then, refusing to navigate is the
        // whole of the correct behaviour.
        event.preventDefault();
      }
    },
    [visit],
  );

  const [recordError, setRecordError] = useState<string | null>(null);
  const record = useCallback(async (action: "start" | "pause" | "resume" | "stop") => {
    try {
      setRecordError(null);
      const ow = bridge();
      if (action === "start") {
        const occasion = globalThis.prompt?.("What are you recording?") ?? "";
        // 4.16: an empty name falls back to the timestamp rather than blocking
        // capture. A recording that started is worth more than a naming rule.
        await ow.recordStart(occasion);
      } else if (action === "pause") await ow.recordPause();
      else if (action === "resume") await ow.recordResume();
      else await ow.recordStop();
    } catch (e) {
      setRecordError(message(e));
    }
  }, []);

  return (
    <div className="app">
      <header className="chrome">
        <span className="chrome__project">{project?.name ?? "…"}</span>
        <nav className="nav">
          <button onClick={() => go(history.current.back())} disabled={!history.current.canGoBack}>
            ←
          </button>
          <button
            onClick={() => go(history.current.forward())}
            disabled={!history.current.canGoForward}
          >
            →
          </button>
          <button aria-current={location.view === "wiki"} onClick={() => visit({ view: "wiki" })}>
            Wiki
          </button>
          <button
            aria-current={location.view === "sources"}
            onClick={() => visit({ view: "sources" })}
          >
            Sources
          </button>
        </nav>
        <span className="chrome__spacer" />
        <RecordingIndicator recording={recording} />
        <RecordControls state={recording.state} onAction={(a) => void record(a)} />
      </header>

      <main className="main">
        {error ? <p className="error">{error}</p> : null}
        {recordError ? <p className="error">{recordError}</p> : null}
        {location.view === "wiki" && !location.slug ? (
          <PageList index={index} onOpen={(slug) => visit({ view: "wiki", slug })} />
        ) : null}
        {location.view === "wiki" && page ? (
          <article className="page">
            <Frontmatter page={page} />
            {/* The markdown is rendered with `html: false`, so what reaches
                here is a closed set of tags this renderer produced. */}
            <div
              onClick={onPageClick}
              onAuxClick={onPageClick}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </article>
        ) : null}
        {location.view === "sources" ? <p className="empty">The sources screen is 6.2.</p> : null}
      </main>
    </div>
  );
}

/** Record, pause, stop — the affordance 8.2 asks for. */
function RecordControls({
  state,
  onAction,
}: {
  state: RecordingState;
  onAction: (action: "start" | "pause" | "resume" | "stop") => void;
}): React.JSX.Element {
  if (state === "idle") {
    return <button onClick={() => onAction("start")}>Record</button>;
  }
  return (
    <span className="nav">
      {state === "paused" ? (
        <button onClick={() => onAction("resume")}>Resume</button>
      ) : (
        <button onClick={() => onAction("pause")}>Pause</button>
      )}
      <button className="danger" onClick={() => onAction("stop")}>
        Stop
      </button>
    </span>
  );
}

function PageList({
  index,
  onOpen,
}: {
  index: WikiIndex;
  onOpen: (slug: string) => void;
}): React.JSX.Element {
  if (index.pages.length === 0) {
    return <p className="empty">This wiki has no pages yet.</p>;
  }
  return (
    <ul className="list">
      {index.pages.map((ref) => (
        <li key={ref.path}>
          <button onClick={() => onOpen(ref.slug)}>{ref.slug}</button>
        </li>
      ))}
    </ul>
  );
}

/** The page's frontmatter, shown as itself — 8.5 asks for it on the page. */
function Frontmatter({ page }: { page: PageView }): React.JSX.Element | null {
  if (page.frontmatterBroken) {
    return <p className="error">This page&rsquo;s frontmatter will not parse.</p>;
  }
  if (!page.frontmatter) return null;
  return (
    <dl className="frontmatter">
      {Object.entries(page.frontmatter).map(([key, value]) => (
        <div key={key} style={{ display: "contents" }}>
          <dt>{key}</dt>
          <dd>{Array.isArray(value) ? value.join(", ") : String(value ?? "")}</dd>
        </div>
      ))}
    </dl>
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
