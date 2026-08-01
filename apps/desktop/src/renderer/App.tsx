import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageView, ProjectInfo, WikiIndex } from "../main/api.js";
import type { DropOutcome } from "../main/ingest.js";
import { isOpenPage } from "../main/watcher.js";
import { bridge, hasBridge } from "./bridge.js";
import { Editor } from "./Editor.js";
import { renderPageBody } from "./markdown.js";
import { History, linkTarget, type Location } from "./navigation.js";
import { Findings, History as HistoryPanel, SourceAt } from "./Panels.js";
import { RecordingIndicator } from "./RecordingIndicator.js";
import { useRecording, type RecordingState } from "./recording.js";
import { Sources } from "./Sources.js";

/**
 * How long a burst of folder changes is gathered before the screen redraws.
 * An agent writing twenty pages is twenty events, and both `wikiIndex` and
 * `readPage` walk the whole tree.
 */
const COALESCE_MS = 120;

/**
 * The shell (plan 8.2), browsing the wiki inside it (8.5), and the screens
 * that hang off it — sources (6.2 to 6.7), editing (8.7 to 8.9), the checks
 * (7.6), the history (8.11), what a citation opens (8.6) and what a drop
 * ingests (3.5).
 *
 * The components here are deliberately dumb: every decision they would
 * otherwise make — where Back goes, what an anchor means, how a page becomes
 * HTML, whether a change is about the open page, whether a save is stale — is
 * a function in a module beside them, which is what a test can reach. What is
 * left is arranging the results.
 */
export function App(): React.JSX.Element {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [index, setIndex] = useState<WikiIndex>({ pages: [], slugs: [] });
  const [page, setPage] = useState<PageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const history = useRef(new History());
  const [location, setLocation] = useState<Location>({ view: "wiki" });
  const recording = useRecording();

  const [openSource, setOpenSource] = useState<{ id: string; fragment: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<DropOutcome[] | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  /** Bumped whenever the project changed, so every panel refetches. */
  const [reloadKey, setReloadKey] = useState(0);

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
    setEditing(false);
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

  // 8.10 — the folder changed, whoever wrote it. Coalesced: an agent writing
  // twenty pages is twenty events, and every panel walks the tree.
  useEffect(() => {
    if (!hasBridge()) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let reloadPage = false;
    const unsubscribe = bridge().onChanged((change) => {
      reloadPage ||= isOpenPage(change, location.slug);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void refreshIndex();
        if (reloadPage && location.slug) void reload(location.slug);
        reloadPage = false;
        setReloadKey((n) => n + 1);
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

  // One handler for the whole rendered page. `onAuxClick` as well, because
  // Chromium dispatches the middle button as `auxclick` — and a middle click
  // on a link is what asks Electron to open a new window.
  const onPageClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (event.target as HTMLElement).closest("a, span[title]");
      if (!anchor) return;
      const target = linkTarget(anchor);
      // Only what the application handles is cancelled. An external link is
      // left to the main process, which allowlists the scheme and hands it to
      // the system browser.
      if (target.kind === "page") {
        event.preventDefault();
        visit({ view: "wiki", slug: target.slug });
      } else if (target.kind === "source") {
        event.preventDefault();
        setOpenSource({ id: target.id, fragment: target.fragment });
      }
    },
    [visit],
  );

  const record = useCallback(async (action: "start" | "pause" | "resume" | "stop") => {
    try {
      setRecordError(null);
      const ow = bridge();
      if (action === "start") {
        // 4.16: an empty name falls back to the timestamp rather than blocking
        // capture. A recording that started is worth more than a naming rule.
        await ow.recordStart(globalThis.prompt?.("What are you recording?") ?? "");
      } else if (action === "pause") await ow.recordPause();
      else if (action === "resume") await ow.recordResume();
      else await ow.recordStop();
    } catch (e) {
      setRecordError(message(e));
    }
  }, []);

  // 3.5 — files dropped onto the window. Chromium gives a drop as paths; the
  // main process reads them, because the bytes are what becomes a source.
  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    // `File.path` was removed in Electron 32, so the path comes from the
    // preload via `webUtils.getPathForFile`. Reading `file.path` here produced
    // an empty list and returned silently — the opposite of the task.
    const ow = bridge();
    const paths = [...event.dataTransfer.files].map((file) => ow.pathForFile(file)).filter(Boolean);
    if (paths.length === 0) {
      setDropped([
        { name: "that drop", ok: false, reason: "nothing in it looked like a file on disk" },
      ]);
      return;
    }
    void ow
      .drop(paths)
      .then((outcomes) => {
        setDropped(outcomes);
        setReloadKey((n) => n + 1);
      })
      .catch((e: unknown) => setError(message(e)));
  }, []);

  return (
    <div
      className={dragging ? "app app--dragging" : "app"}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
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
          {(["wiki", "sources", "checks", "history"] as const).map((view) => (
            <button
              key={view}
              aria-current={location.view === view}
              onClick={() => visit({ view })}
            >
              {view[0]!.toUpperCase() + view.slice(1)}
            </button>
          ))}
        </nav>
        <span className="chrome__spacer" />
        <RecordingIndicator recording={recording} />
        <RecordControls state={recording.state} onAction={(a) => void record(a)} />
      </header>

      <main className="main">
        {error ? <p className="error">{error}</p> : null}
        {recordError ? <p className="error">{recordError}</p> : null}
        {dropped ? <Dropped outcomes={dropped} onDismiss={() => setDropped(null)} /> : null}
        {dragging ? <p className="empty">Drop files to add them as sources.</p> : null}

        {location.view === "wiki" && !location.slug ? (
          <PageList
            index={index}
            onOpen={(slug) => visit({ view: "wiki", slug })}
            onCreate={() => void createPage(index, visit, setError)}
          />
        ) : null}

        {location.view === "wiki" && page && !editing ? (
          <article className="page">
            <PageBar
              page={page}
              onEdit={() => setEditing(true)}
              onRename={() => void renameFlow(page.slug, visit, setError)}
              onDelete={() => void deleteFlow(page.slug, visit, setError)}
            />
            <Frontmatter page={page} />
            {/* Rendered with `html: false` and two token rules, so what reaches
                here is a closed set of tags this renderer produced. */}
            <div
              onClick={onPageClick}
              onAuxClick={onPageClick}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </article>
        ) : null}

        {location.view === "wiki" && page && editing ? (
          <Editor
            page={page}
            slugs={index.slugs}
            onSaved={() => {
              setEditing(false);
              void reload(page.slug);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : null}

        {location.view === "sources" ? (
          <Sources reloadKey={reloadKey} onOpenPage={(slug) => visit({ view: "wiki", slug })} />
        ) : null}
        {location.view === "checks" ? <Findings reloadKey={reloadKey} /> : null}
        {location.view === "history" ? <HistoryPanel reloadKey={reloadKey} /> : null}
      </main>

      {openSource ? (
        <SourceAt
          id={openSource.id}
          fragment={openSource.fragment}
          onClose={() => setOpenSource(null)}
        />
      ) : null}
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

/** What a drop did — 3.5 asks for what was recognised *and* what was not. */
function Dropped({
  outcomes,
  onDismiss,
}: {
  outcomes: DropOutcome[];
  onDismiss: () => void;
}): React.JSX.Element {
  const failed = outcomes.filter((o) => !o.ok);
  return (
    <div className={failed.length > 0 ? "error" : "empty"}>
      <div className="editor__bar">
        <strong>
          {outcomes.length - failed.length} of {outcomes.length} added
        </strong>
        <span className="chrome__spacer" />
        <button onClick={onDismiss}>Dismiss</button>
      </div>
      <ul>
        {outcomes.map((outcome) => (
          <li key={outcome.name}>
            {outcome.name} — {outcome.ok ? `added as ${outcome.id}` : outcome.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PageBar({
  page,
  onEdit,
  onRename,
  onDelete,
}: {
  page: PageView;
  onEdit: () => void;
  onRename: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  return (
    <div className="editor__bar">
      <code>{page.path}</code>
      <span className="chrome__spacer" />
      <button onClick={onEdit}>Edit</button>
      <button onClick={onRename}>Rename</button>
      <button className="danger" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}

async function createPage(
  index: WikiIndex,
  visit: (location: Location) => void,
  onError: (message: string) => void,
): Promise<void> {
  const slug = globalThis.prompt?.("New page slug")?.trim();
  if (!slug) return;
  if (index.slugs.includes(slug)) {
    onError(`a page named "${slug}" already exists`);
    return;
  }
  try {
    const result = await bridge().create({ slug, markdown: template(slug) });
    if (!result.saved) {
      onError(result.reason === "stale" ? "that page moved" : result.problems.join("; "));
      return;
    }
    visit({ view: "wiki", slug });
  } catch (e) {
    onError(message(e));
  }
}

/** A new page that already satisfies the schema, so the first save is not a fight. */
function template(slug: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    "---",
    `id: topic:${slug}`,
    "type: topic",
    `title: ${slug}`,
    "status: active",
    "aliases: []",
    `updated: ${today}`,
    "sources: []",
    'superseded-by: ""',
    "---",
    "",
    "",
  ].join("\n");
}

async function renameFlow(
  slug: string,
  visit: (location: Location) => void,
  onError: (message: string) => void,
): Promise<void> {
  const to = globalThis.prompt?.("Rename this page to", slug)?.trim();
  if (!to || to === slug) return;
  try {
    const result = await bridge().rename(slug, to);
    if (result.repointed.length > 0) {
      onError(`Renamed. Repointed links on: ${result.repointed.join(", ")}`);
    }
    visit({ view: "wiki", slug: to });
  } catch (e) {
    onError(message(e));
  }
}

async function deleteFlow(
  slug: string,
  visit: (location: Location) => void,
  onError: (message: string) => void,
): Promise<void> {
  // A delete leaves the links that pointed here alone, on purpose — they are
  // the record that something was expected to be there, and 7.1 reports them.
  const ok = globalThis.confirm?.(
    `Delete "${slug}"? Links pointing at it stay, and the checks will report them.`,
  );
  if (!ok) return;
  try {
    await bridge().remove(slug);
    visit({ view: "wiki" });
  } catch (e) {
    onError(message(e));
  }
}

function PageList({
  index,
  onOpen,
  onCreate,
}: {
  index: WikiIndex;
  onOpen: (slug: string) => void;
  onCreate: () => void;
}): React.JSX.Element {
  return (
    <>
      <div className="editor__bar">
        <button onClick={onCreate}>New page</button>
      </div>
      {index.pages.length === 0 ? (
        <p className="empty">This wiki has no pages yet.</p>
      ) : (
        <ul className="list">
          {index.pages.map((ref) => (
            <li key={ref.path}>
              <button onClick={() => onOpen(ref.slug)}>{ref.slug}</button>
            </li>
          ))}
        </ul>
      )}
    </>
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
