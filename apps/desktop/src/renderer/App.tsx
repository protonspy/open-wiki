import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageView, ProjectInfo, WikiIndex } from "../main/api.js";
import type { DropOutcome } from "../main/ingest.js";
// From `shared/`, never from `main/watcher.js`. That module starts a chokidar
// watch, and importing it here pulled chokidar and `node:stream` into this
// browser bundle — which vite externalises and rollup then fails on.
import { isOpenPage } from "../shared/changes.js";
import { useDialogs, type Dialogs } from "./Ask.js";
import { bridge, hasBridge, NoBridgeError } from "./bridge.js";
import {
  deleteQuestion,
  newPageQuestion,
  occasionOf,
  occasionQuestion,
  renameQuestion,
} from "./dialogs.js";
import { Editor } from "./Editor.js";
import { renderPageBody } from "./markdown.js";
import { History, linkTarget, type Location } from "./navigation.js";
import {
  clearAt,
  clearFailureAt,
  failure,
  note,
  noticeAt,
  replaceAt,
  type Notice,
  type Place,
} from "./notices.js";
import { Findings, History as HistoryPanel, PageSources, SourceAt } from "./Panels.js";
import { RecordingIndicator } from "./RecordingIndicator.js";
import { useRecording, type RecordingState } from "./recording.js";
import { Launcher } from "./Launcher.js";
import { Settings } from "./Settings.js";
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
  /** Null until the first answer arrives; false once we know there is none. */
  const [hasProject, setHasProject] = useState<boolean | null>(null);
  const [index, setIndex] = useState<WikiIndex>({ pages: [], slugs: [] });
  const [page, setPage] = useState<PageView | null>(null);
  // 1.5 — one slot per place rather than one for the window. What failed is
  // said where it failed, and a failure in one place no longer erases another.
  const [notices, setNotices] = useState<readonly Notice[]>([]);
  const history = useRef(new History());
  const [location, setLocation] = useState<Location>({ view: "wiki" });
  const recording = useRecording();
  // 1.1 — every question this shell asks. `window.prompt` answers nothing in
  // Electron, so the four controls that used it did nothing at all.
  const { ask, confirm, element: dialog } = useDialogs();

  const [openSource, setOpenSource] = useState<{ id: string; fragment: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<DropOutcome[] | null>(null);
  /** Bumped whenever the project changed, so every panel refetches. */
  const [reloadKey, setReloadKey] = useState(0);

  const say = useCallback((notice: Notice) => {
    setNotices((current) => replaceAt(current, notice));
  }, []);

  const refreshIndex = useCallback(async () => {
    try {
      setIndex(await bridge().index());
      setNotices((current) => clearFailureAt(current, "wiki"));
    } catch (e) {
      say(failure("wiki", e));
    }
  }, [say]);

  const reload = useCallback(
    async (slug: string) => {
      try {
        setPage(await bridge().page(slug));
        setNotices((current) => clearFailureAt(current, "page"));
      } catch (e) {
        setPage(null);
        say(failure("page", e));
      }
    },
    [say],
  );

  const go = useCallback((next: Location | null) => {
    if (!next) return;
    setEditing(false);
    setLocation(next);
    // The page left behind takes its notices with it. A rename's note is set
    // after the navigation that carried it, so it survives this on purpose.
    setNotices((current) => clearAt(current, "page"));
  }, []);

  const visit = useCallback(
    (next: Location) => {
      go(history.current.visit(next));
    },
    [go],
  );

  useEffect(() => {
    // The two failures that really are the window's, and the only two: without
    // a bridge or a project nothing on any pane would work either.
    if (!hasBridge()) {
      say(failure("shell", new NoBridgeError()));
      return;
    }
    void bridge()
      .project()
      .then((info) => {
        setProject(info);
        setHasProject(info !== null);
      })
      .catch((e: unknown) => say(failure("shell", e)));
    void refreshIndex();
  }, [refreshIndex, say]);

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

  // 3.7 — the doorway. A file an agent wrote into `raw/_inbox/` while this
  // window was open becomes a source with nobody clicking anything, so the
  // window reports it where a drop is reported: material the user did not
  // initiate is still material they have to see arrive, or a refusal is silence.
  //
  // No `reloadKey` bump. The ingest writes under `raw/`, which 8.10's watcher
  // already reports — and that path coalesces, where thirty files arriving here
  // would be thirty un-coalesced walks of the whole project.
  useEffect(() => {
    if (!hasBridge()) return;
    return bridge().onInbox((outcome) => {
      setDropped((current) => append(current, outcome));
    });
  }, []);

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

  const record = useCallback(
    async (action: "start" | "pause" | "resume" | "stop") => {
      try {
        setNotices((current) => clearAt(current, "recording"));
        const ow = bridge();
        if (action === "start") {
          // 4.16: an empty name falls back to the timestamp rather than blocking
          // capture. A recording that started is worth more than a naming rule,
          // so not answering the box still records — and the box's other button
          // says so rather than saying "Cancel" and recording anyway.
          await ow.recordStart(occasionOf(await ask(occasionQuestion())));
        } else if (action === "pause") await ow.recordPause();
        else if (action === "resume") await ow.recordResume();
        else await ow.recordStop();
      } catch (e) {
        // Beside the control that failed, in the titlebar — where the record
        // button is, and visible from whichever pane is open.
        say(failure("recording", e));
      }
    },
    [ask, say],
  );

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
        // Appended, not replaced: an inbox arrival the user has not dismissed
        // is a report, and a drop is no reason to discard it.
        setDropped((current) => [...(current ?? []), ...outcomes]);
        setReloadKey((n) => n + 1);
      })
      // 1.5 — a drop that failed is reported where a drop is reported. It used
      // to land in the shell's one error line, beside failures from four other
      // things, saying nothing about which files it was about.
      .catch((e: unknown) =>
        setDropped((current) => [...(current ?? []), { name: "that drop", ok: false, reason: message(e) }]),
      );
  }, []);

  // 8.4 — a window opened outside a project shows the launcher. Nothing else
  // on screen would work: every other channel refuses without a project.
  if (hasProject === false) {
    return (
      <div className="app">
        <header className="chrome">
          <span className="chrome__project">open-wiki</span>
        </header>
        <main className="main">
          <Launcher />
        </main>
      </div>
    );
  }

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
          {(["wiki", "sources", "checks", "history", "settings"] as const).map((view) => (
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

      {/* Beside the controls it is about, and above every pane because it is
          about the window rather than about any one of them. */}
      <Reported notices={notices} place="recording" />
      <Reported notices={notices} place="shell" />

      <main className="main">
        {dropped ? <Dropped outcomes={dropped} onDismiss={() => setDropped(null)} /> : null}
        <InboxWaiting
          reloadKey={reloadKey}
          onTaken={(outcomes) => {
            setDropped((current) => [...(current ?? []), ...outcomes]);
            setReloadKey((n) => n + 1);
          }}
        />
        {dragging ? <p className="empty">Drop files to add them as sources.</p> : null}

        {location.view === "wiki" && !location.slug ? (
          <>
            {/* The wiki pane's own: reading the index failed, or creating a
                page from this list did. */}
            <Reported notices={notices} place="wiki" />
            <PageList
              index={index}
              root={project?.root ?? ""}
              onOpen={(slug) => visit({ view: "wiki", slug })}
              onCreate={() => void createPage(index, ask, visit, say)}
            />
          </>
        ) : null}

        {location.view === "wiki" && !page && location.slug ? (
          <Reported notices={notices} place="page" />
        ) : null}

        {location.view === "wiki" && page && !editing ? (
          <article className="page">
            <PageBar
              page={page}
              onEdit={() => setEditing(true)}
              onRename={() => void renameFlow(page.slug, ask, visit, say)}
              onDelete={() => void deleteFlow(page.slug, confirm, visit, say)}
            />
            {/* On the page, under the bar whose buttons caused it. */}
            <Reported notices={notices} place="page" />
            <Frontmatter page={page} />
            {/* 6.5 — where this page came from, and a way into each source. */}
            <PageSources
              slug={page.slug}
              reloadKey={reloadKey}
              onOpen={(id, fragment) => setOpenSource({ id, fragment })}
            />
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
        {location.view === "settings" ? <Settings /> : null}
      </main>

      {openSource ? (
        <SourceAt
          id={openSource.id}
          fragment={openSource.fragment}
          onClose={() => setOpenSource(null)}
        />
      ) : null}

      {/* The open question, if there is one. A modal is in the top layer, so
          this sits at the end of the tree rather than beside what asked it. */}
      {dialog}
    </div>
  );
}

/**
 * What one place has to say, if it has anything (plan 1.5).
 *
 * Rendered at each place rather than once at the top, which is the whole of
 * this task: the component is trivial and where it is put is the point.
 */
function Reported({
  notices,
  place,
}: {
  notices: readonly Notice[];
  place: Place;
}): React.JSX.Element | null {
  const notice = noticeAt(notices, place);
  if (!notice) return null;
  return <p className={notice.tone === "error" ? "error" : "empty"}>{notice.text}</p>;
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
        {/* Keyed by position as well as name: the inbox (3.7) appends to this
            list over time, and two files can carry one name across batches. */}
        {outcomes.map((outcome, i) => (
          <li key={`${outcome.name}-${i}`}>
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

/**
 * Creating a page. Every way it can fail is reported in the wiki pane, beside
 * the list and the button that started it — not in a line above the whole
 * window, where it was indistinguishable from a failed drop.
 */
async function createPage(
  index: WikiIndex,
  ask: Dialogs["ask"],
  visit: (location: Location) => void,
  say: (notice: Notice) => void,
): Promise<void> {
  const slug = await ask(newPageQuestion());
  if (!slug) return;
  if (index.slugs.includes(slug)) {
    say(failure("wiki", `a page named "${slug}" already exists — open it, or pick another name`));
    return;
  }
  try {
    const result = await bridge().create({ slug, markdown: template(slug) });
    if (!result.saved) {
      say(failure("wiki", result.reason === "stale" ? "that page moved" : result.problems.join("; ")));
      return;
    }
    visit({ view: "wiki", slug });
  } catch (e) {
    say(failure("wiki", e));
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
  ask: Dialogs["ask"],
  visit: (location: Location) => void,
  say: (notice: Notice) => void,
): Promise<void> {
  const to = await ask(renameQuestion(slug));
  if (!to || to === slug) return;
  try {
    const result = await bridge().rename(slug, to);
    // **After the navigation, and a note rather than an error.** It reported a
    // success through the error channel before, in the same red box a failed
    // rename used — so the one outcome worth reading looked like the other.
    visit({ view: "wiki", slug: to });
    if (result.repointed.length > 0) {
      say(note("page", `Renamed. Repointed the links on: ${result.repointed.join(", ")}`));
    }
  } catch (e) {
    say(failure("page", e));
  }
}

async function deleteFlow(
  slug: string,
  confirm: Dialogs["confirm"],
  visit: (location: Location) => void,
  say: (notice: Notice) => void,
): Promise<void> {
  // A delete leaves the links that pointed here alone, on purpose — they are
  // the record that something was expected to be there, and 7.1 reports them.
  // `deleteQuestion` is where that sentence lives, beside the button that acts
  // on it.
  if (!(await confirm(deleteQuestion(slug)))) return;
  try {
    await bridge().remove(slug);
    visit({ view: "wiki" });
  } catch (e) {
    // Still on the page, because the delete did not happen.
    say(failure("page", e));
  }
}

function PageList({
  index,
  root,
  onOpen,
  onCreate,
}: {
  index: WikiIndex;
  root: string;
  onOpen: (slug: string) => void;
  onCreate: () => void;
}): React.JSX.Element {
  return (
    <>
      <div className="editor__bar">
        <button onClick={onCreate}>New page</button>
      </div>
      {index.pages.length === 0 ? (
        <EmptyWiki root={root} />
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

/**
 * What an empty wiki says (plan 1.4).
 *
 * **The central fact about this product is not visible anywhere else.** The
 * application does not call an LLM and never writes a page: it scaffolds,
 * validates, records and shows, and the pages are the agent's to write. A
 * person who installs the binary, opens a project and finds nothing has no way
 * to learn that — *This wiki has no pages yet* reads as a defect, and the
 * conclusion it invites is that the application is broken.
 *
 * So the empty state is where the sentence goes, together with the path to
 * open in a harness, because the next thing to do is somewhere else.
 */
function EmptyWiki({ root }: { root: string }): React.JSX.Element {
  return (
    <div className="doorway">
      <p className="doorway__lead">This wiki is empty, and this window is not what fills it.</p>
      <p>
        open-wiki scaffolds a project, checks what is written into it, records every write and shows
        you the result. The pages themselves are your agent&rsquo;s to write — there is no model
        behind this window, and an empty wiki is the ordinary way a project starts.
      </p>
      <p>
        Open this directory in your harness and ask it for a page. The scaffold left{" "}
        <code>.claude/skills/</code> and a <code>CLAUDE.md</code> inside it that say how a page here
        is written, linked from <code>wiki/index.md</code> and recorded in{" "}
        <code>wiki/changelog.md</code>.
      </p>
      {root ? <p className="doorway__path">{root}</p> : null}
      <p className="empty">
        Writing the first one yourself is fine too — <strong>New page</strong>, above.
      </p>
    </div>
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

/**
 * Add an outcome, unless it repeats the one before it (plan 3.7).
 *
 * `watchInbox` deduplicates its own refusals, but a watcher error does not go
 * through that — a directory raising EPERM raises it again and again, and an
 * identical line appended thirty times is a banner nobody can read past.
 */
function append(current: DropOutcome[] | null, outcome: DropOutcome): DropOutcome[] {
  const list = current ?? [];
  const last = list[list.length - 1];
  if (last && sameOutcome(last, outcome)) return list;
  return [...list, outcome];
}

function sameOutcome(a: DropOutcome, b: DropOutcome): boolean {
  if (a.name !== b.name || a.ok !== b.ok) return false;
  return a.ok && b.ok ? a.id === b.id : !a.ok && !b.ok && a.reason === b.reason;
}

/**
 * What is sitting in `raw/_inbox/` and was not taken on sight (plan 3.7).
 *
 * **Asked for, not pushed.** What was already in the doorway when the window
 * opened would be announced before the renderer had subscribed and vanish, so
 * the renderer asks — and it is left alone until somebody says to take it,
 * because `raw/` arrives with a clone and a file that came out of `git clone`
 * is not an agent handing something over.
 */
function InboxWaiting({
  reloadKey,
  onTaken,
}: {
  reloadKey: number;
  onTaken: (outcomes: DropOutcome[]) => void;
}): React.JSX.Element | null {
  const [names, setNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // 1.5 — its own, because taking the doorway's files is its own operation.
  // It reported upwards into the shell's one line before, where it read as a
  // failure of whatever pane happened to be open.
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!hasBridge()) return;
    void bridge()
      .inboxWaiting()
      .then(setNames)
      .catch(() => setNames([]));
  }, []);

  useEffect(load, [load, reloadKey]);

  const take = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      onTaken(await bridge().inboxDrain());
      load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }, [load, onTaken]);

  if (names.length === 0) return null;

  return (
    <div className="empty">
      <div className="editor__bar">
        <strong>
          {names.length} {names.length === 1 ? "file is" : "files are"} waiting in raw/_inbox
        </strong>
        <span className="chrome__spacer" />
        <button onClick={() => void take()} disabled={busy}>
          {busy ? "Adding…" : "Add them"}
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <ul>
        {names.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </div>
  );
}
