import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExportResult, SourceKind } from "@open-wiki/access";
import type { PageView, ProjectInfo, WikiIndex } from "../main/api.js";
import type { DropOutcome } from "../main/ingest.js";
// From `shared/`, never from `main/watcher.js`. That module starts a chokidar
// watch, and importing it here pulled chokidar and `node:stream` into this
// browser bundle — which vite externalises and rollup then fails on.
import { isOpenPage } from "../shared/changes.js";
import { startFragment } from "../shared/sources.js";
import { useDialogs, type Dialogs } from "./Ask.js";
import { bridge, hasBridge, NoBridgeError } from "./bridge.js";
import {
  deleteQuestion,
  exportQuestion,
  newPageQuestion,
  occasionOf,
  occasionQuestion,
  renameQuestion,
  unsavedQuestion,
} from "./dialogs.js";
import { pageTemplate } from "./page-template.js";
import { Editor, EditorActions, useEditorBuffer } from "./Editor.js";
import { Shell, type LinkTarget, type Location, type Overlay, type Pane } from "./navigation.js";
import {
  clearAt,
  clearFailureAt,
  failure,
  note,
  noticeAt,
  replaceAt,
  type Notice,
} from "./notices.js";
import { fixesFor, writesToDisk, type Fix } from "./fixes.js";
import { closesOverlay, isFieldTag, paneShortcut } from "./keyboard.js";
import { Reader, readerState } from "./Reader.js";
import { Side } from "./Side.js";
import { ChecksPane } from "./ChecksPane.js";
import { History as HistoryPanel } from "./History.js";
import { SourceAt } from "./SourceAt.js";
import { Rail } from "./Rail.js";
import { Reported } from "./Reported.js";
import { WikiPane } from "./WikiPane.js";
import { useRecording } from "./recording.js";
import { StatusBar } from "./StatusBar.js";
import { Titlebar } from "./Titlebar.js";
import { Drawer } from "./ui/Drawer.js";
import { Chat } from "./Chat.js";
import { Launcher } from "./Launcher.js";
import { htmlLang } from "./languages.js";
import { mayAskForProject, windowView } from "./window-view.js";
import { Settings } from "./Settings.js";
import { Sources } from "./Sources.js";
import { Button } from "./ui/Button.js";
import { Empty } from "./ui/Empty.js";
import { Plus } from "lucide-react";

/**
 * How long a burst of folder changes is gathered before the screen redraws.
 * An agent writing twenty pages is twenty events, and both `wikiIndex` and
 * `readPage` walk the whole tree.
 */
const COALESCE_MS = 120;

/**
 * The panes that draw their own bar and scroll their own body.
 *
 * Listed rather than derived by excluding chat, so a pane added later gets the
 * padded `<main>` — the old behaviour — until somebody gives it a frame, rather
 * than silently rendering edge to edge with no bar at all.
 */
const FRAMED_PANES: ReadonlySet<Pane> = new Set<Pane>([
  "wiki",
  "sources",
  "checks",
  "chat",
  "settings",
]);

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
  /** False until the first index read comes back — see `readerState`. */
  const [indexKnown, setIndexKnown] = useState(false);
  const [page, setPage] = useState<PageView | null>(null);
  // 1.5 — one slot per place rather than one for the window. What failed is
  // said where it failed, and a failure in one place no longer erases another.
  const [notices, setNotices] = useState<readonly Notice[]>([]);
  // Where the window is, and the overlays that are not places. The `Shell`
  // owns the rules (spec `desktop-shell`); these two mirror it so React
  // re-renders, because a mutable object in a ref does not.
  const shell = useRef(new Shell());
  const [location, setLocation] = useState<Location>(shell.current.location);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const recording = useRecording();
  // 1.1 — every question this shell asks. `window.prompt` answers nothing in
  // Electron, so the four controls that used it did nothing at all.
  const { ask, askFully, confirm, element: dialog } = useDialogs();

  /** How many findings the checks last reported; null while none has come back. */
  const [findings, setFindings] = useState<number | null>(null);
  /** Whether the last attempt failed — which is not the same as none yet. */
  const [checksFailed, setChecksFailed] = useState(false);
  const [lastWrite, setLastWrite] = useState<string | null>(null);
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
      // Only on success: `indexKnown` is what tells an empty wiki apart from a
      // wiki nobody has read yet, and a failed read has not read it.
      setIndexKnown(true);
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

  /** Arrive somewhere: whatever the `Shell` decided, put it on screen. */
  const arrive = useCallback((at: Location) => {
    setEditing(false);
    setLocation(at);
    // The page left behind takes its notices with it. A rename's note is set
    // after the navigation that carried it, so it survives this on purpose.
    setNotices((current) => clearAt(current, "page"));
  }, []);

  /**
   * Whether leaving where we are would throw away unsaved work (uxpass 2.3).
   *
   * A ref, because every navigation callback below would otherwise have to be
   * rebuilt on every keystroke in the editor — and the window's keydown listener
   * with them.
   */
  const unsaved = useRef(false);

  /**
   * Go somewhere, unless there is a draft that would be lost by going.
   *
   * The move itself is deferred until the question is answered: `Shell.visit`
   * mutates the history, so calling it first and then asking would leave the
   * back stack believing in a navigation that never happened.
   */
  const leaveFor = useCallback(
    async (move: () => Location) => {
      if (unsaved.current && !(await confirm(unsavedQuestion()))) return;
      arrive(move());
    },
    [arrive, confirm],
  );

  const visit = useCallback(
    (next: Location) => void leaveFor(() => shell.current.visit(next)),
    [leaveFor],
  );

  const goTo = useCallback(
    (pane: Pane) => void leaveFor(() => shell.current.goTo(pane)),
    [leaveFor],
  );

  const show = useCallback((next: Overlay) => {
    shell.current.show(next);
    setOverlay(next);
  }, []);

  const dismiss = useCallback(() => {
    shell.current.dismiss();
    setOverlay(null);
  }, []);

  const view = windowView(hasProject);
  const mayAsk = mayAskForProject(view);

  useEffect(() => {
    // The two failures that really are the window's, and the only two: without
    // a bridge or a project nothing on any pane would work either.
    if (!hasBridge()) {
      say(failure("shell", new NoBridgeError()));
      return;
    }
    // The index waits for the answer. Asking alongside `project()` is asking
    // before knowing whether this window has one, and a launcher window that
    // asked was refused — a failure painted on a window with nothing wrong.
    void bridge()
      .project()
      .then((info) => {
        setProject(info);
        setHasProject(info !== null);
        if (info !== null) void refreshIndex();
      })
      .catch((e: unknown) => say(failure("shell", e)));
  }, [refreshIndex, say]);

  /**
   * The document's language is the project's (uxpass 4.4).
   *
   * `index.html` hard-wires `en`, and the wiki is the overwhelming majority of
   * the text in this window: a Portuguese project read out with English
   * phonemes is not an accent, it is unintelligible. Set here rather than in the
   * HTML because the answer arrives with `project()` and changes in the settings
   * sheet.
   */
  useEffect(() => {
    document.documentElement.lang = htmlLang(project?.language);
  }, [project?.language]);

  // 8.10 — the folder changed, whoever wrote it. Coalesced: an agent writing
  // twenty pages is twenty events, and every panel walks the tree.
  useEffect(() => {
    if (!hasBridge()) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let reloadPage = false;
    const unsubscribe = bridge().onChanged((change) => {
      reloadPage ||= isOpenPage(change, location.selection);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void refreshIndex();
        if (reloadPage && location.selection) void reload(location.selection);
        reloadPage = false;
        setReloadKey((n) => n + 1);
      }, COALESCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [location.selection, refreshIndex, reload]);

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

  // Whether there is anything to undo (R5.4, R5.5). The newest operation, and
  // nothing of it beyond the fact that it exists — the drawer is what shows the
  // rest, and a copy of it in the status bar would be a second record of one
  // fact, which is the one that goes stale.
  useEffect(() => {
    if (!hasBridge() || !mayAsk) return;
    void bridge()
      .history()
      .then((operations) => setLastWrite(operations[0]?.id ?? null))
      .catch(() => setLastWrite(null));
  }, [reloadKey, mayAsk]);

  /**
   * The checks, asked once and again after every write (uxpass 9.2).
   *
   * **The status bar used to say *not checked yet* until somebody opened the
   * checks pane**, which is honest and leaves the default state of the window
   * saying nothing at all about the wiki's health — on an application whose
   * whole argument is that a wiki is worth trusting because something checks it.
   *
   * `StatusBar`'s note about not computing the count here still holds and this
   * does not break it: the count is still never computed *for the bar* on a
   * render, and `ow check` walks the project exactly once per change, in the
   * background, off the paint path.
   *
   * Skipped while the checks pane is the one on screen, because that pane runs
   * the same walk and reports it through `onCount`. Read from a ref rather than
   * a dependency, or every pane switch would be another walk of the project.
   */
  const currentPane = useRef(location.pane);
  currentPane.current = location.pane;
  useEffect(() => {
    if (!hasBridge() || !mayAsk || currentPane.current === "checks") return;
    let live = true;
    void bridge()
      .findings()
      .then((found) => {
        if (!live) return;
        setFindings(found.length);
        setChecksFailed(false);
      })
      .catch(() => {
        // **Not a zero.** A count is a claim, and a walk that threw reached no
        // verdict — the same rule `ChecksPane` follows for its own body.
        if (live) setChecksFailed(true);
      });
    return () => {
      live = false;
    };
  }, [mayAsk, reloadKey]);

  useEffect(() => {
    if (location.pane !== "wiki" || !location.selection) {
      setPage(null);
      return;
    }
    void reload(location.selection);
  }, [location, reload]);

  /**
   * Where a link in the prose goes. The reader decides what was clicked; this
   * decides what that means, because navigating and opening an overlay are the
   * shell's, not the page's.
   */
  const onLink = useCallback(
    (target: LinkTarget) => {
      if (target.kind === "page") visit({ pane: "wiki", selection: target.slug });
      else if (target.kind === "source") {
        show({ kind: "provenance", source: target.id, fragment: target.fragment });
      }
      // An external link is left to the main process, which allowlists the
      // scheme and hands it to the system browser.
    },
    [visit, show],
  );

  /**
   * The keyboard (8.1): reach a pane, and close what Escape does not reach.
   *
   * On the window rather than on a component, because a shortcut that works
   * only while the rail has focus is a shortcut nobody finds. Every decision it
   * makes is in `keyboard.ts`; what is here is the listener.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const inField = isFieldTag((event.target as HTMLElement | null)?.tagName);
      const pane = paneShortcut(event);
      if (pane && !inField) {
        event.preventDefault();
        goTo(pane);
        return;
      }
      if (closesOverlay(event, shell.current.overlay?.kind ?? null, inField)) {
        event.preventDefault();
        dismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, dismiss]);

  /**
   * The edit session's buffer (uxpass 2.3, 2.4).
   *
   * It lives here rather than inside `Editor` because Save and Cancel moved
   * into the pane bar, and the bar is `WikiPane`'s: two components need the same
   * buffer, so it belongs above both of them.
   */
  const editor = useEditorBuffer({
    page,
    editing,
    onSaved: () => {
      setEditing(false);
      if (location.selection) void reload(location.selection);
    },
  });
  unsaved.current = editor.dirty;

  /** Closing the editor is leaving too, so it asks the same question (2.3). */
  const cancelEdit = useCallback(async () => {
    if (editor.dirty && !(await confirm(unsavedQuestion()))) return;
    setEditing(false);
  }, [confirm, editor.dirty]);

  /** Which slugs a fix button may offer to open (5.3). */
  const knownSlugs = useMemo(() => new Set(index.slugs), [index.slugs]);

  /** What the reader column is showing, when it is not showing a page (R4). */
  const reading = readerState({
    pageCount: indexKnown ? index.pages.length : null,
    selection: location.selection,
    loaded: page !== null,
    failed: noticeAt(notices, "page")?.tone === "error",
  });

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
        setDropped((current) => [
          ...(current ?? []),
          { name: "that drop", ok: false, reason: message(e) },
        ]),
      );
  }, []);

  // 8.4 — a window opened outside a project shows the launcher. Nothing else
  // on screen would work: every other channel refuses without a project.
  //
  // And until the answer arrives it shows neither, because the project shell
  // fetches on mount: rendering it while `project()` is in flight is how a
  // launcher window came to ask for a wiki index, a history and an inbox it had
  // no project for. The notices stay, so a `project()` that *failed* still says
  // so rather than leaving a window that is blank forever.
  if (view !== "project") {
    return (
      <div className="app">
        <header className="chrome">
          <span className="chrome__project">open-wiki</span>
        </header>
        <main className="main">
          <div className="main__notices">
            <Reported notices={notices} place="shell" />
          </div>
          {view === "launcher" ? <Launcher /> : null}
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
      <Titlebar
        project={project?.name ?? "…"}
        recording={recording}
        onRecord={(action) => void record(action)}
        /* A pane now, so the gear navigates rather than opening a sheet. It
           stays in the titlebar as well as in the rail: it is the door people
           already know, and the rail entry is the one they find. */
        onSettings={() => goTo("settings")}
        onBack={() => void leaveFor(() => shell.current.back())}
        onForward={() => void leaveFor(() => shell.current.forward())}
        canGoBack={shell.current.canGoBack}
        canGoForward={shell.current.canGoForward}
      />

      <div className="app-body">
        <Rail current={location.pane} onGoTo={goTo} language={project?.language ?? "en"} />

        {/* Every pane draws its own frame — a bar, and a body that scrolls
            inside it — so `<main>` stops padding and stops scrolling. The chat
            pane joined them when it got a bar of its own (uxpass 6.1); a pane
            added later still gets the padded `<main>` until somebody frames it,
            rather than silently rendering edge to edge with no bar at all. */}
        <main className={FRAMED_PANES.has(location.pane) ? "main main--bleed" : "main"}>
          {/* Beside the controls they are about: the recording notice under
              the titlebar, the shell's own above every pane. */}
          <div className="main__notices">
            <Reported notices={notices} place="recording" />
            <Reported notices={notices} place="shell" />
            {dropped ? <Dropped outcomes={dropped} onDismiss={() => setDropped(null)} /> : null}
            <InboxWaiting
              reloadKey={reloadKey}
              onTaken={(outcomes) => {
                setDropped((current) => [...(current ?? []), ...outcomes]);
                setReloadKey((n) => n + 1);
              }}
            />
            {dragging ? <p className="empty">Drop files to add them as sources.</p> : null}
          </div>

          {location.pane === "wiki" ? (
            <WikiPane
              index={index}
              page={page}
              selection={location.selection}
              notices={notices}
              onOpen={(slug) => visit({ pane: "wiki", selection: slug })}
              onCreate={() => void createPage(index, askFully, visit, say)}
              onExport={() => void exportWiki(confirm, say)}
              onEdit={() => setEditing(true)}
              onRename={() => {
                if (page) void renameFlow(page.slug, ask, visit, say);
              }}
              onDelete={() => {
                if (page) void deleteFlow(page.slug, confirm, visit, say);
              }}
              editing={editing}
              editorActions={<EditorActions buffer={editor} onCancel={() => void cancelEdit()} />}
              side={
                page
                  ? /* 6.5 — where this page came from, and what the checks say
                       about it, beside the page rather than behind a button.
                       Below ~1000px it is a sheet, and whether it is open is
                       the pane's (uxpass 1.1). */
                    (open) => (
                      <Side
                        page={page}
                        open={open}
                        reloadKey={reloadKey}
                        onOpenSource={(id, fragment) =>
                          show({ kind: "provenance", source: id, fragment })
                        }
                      />
                    )
                  : undefined
              }
              reader={
                <>
                  {/* R4 — each of these rendered nothing before, which reads as
                      "there is nothing here" whichever of them it was. */}
                  {reading === "loading-wiki" ? (
                    <p className="empty">Reading the wiki&hellip;</p>
                  ) : null}

                  {reading === "empty-wiki" ? <EmptyWiki root={project?.root ?? ""} /> : null}

                  {/* uxpass 8.1 — it was *"Pick a page on the left to read
                      it."* pinned to the top-left of 650px of void: a report of
                      the state rather than what the pane is for, with nothing
                      offered about it. */}
                  {reading === "no-selection" ? (
                    <Empty
                      title="Nothing open"
                      action={
                        <Button
                          icon={Plus}
                          onClick={() => void createPage(index, askFully, visit, say)}
                        >
                          New page
                        </Button>
                      }
                    >
                      <p>
                        This is the wiki — the pages this project has accumulated, and what they
                        rest on. Pick one from the list to read it.
                      </p>
                      <p>
                        {index.pages.length} {index.pages.length === 1 ? "page" : "pages"} so far,
                        and the agent writes most of them: the Chat pane runs it against this
                        project.
                      </p>
                    </Empty>
                  ) : null}

                  {reading === "loading" ? <p className="empty">Opening&hellip;</p> : null}

                  {reading === "failed" ? <Reported notices={notices} place="page" /> : null}

                  {page && !editing ? (
                    <>
                      {/* On the page, under the bar whose buttons caused it. */}
                      <Reported notices={notices} place="page" />
                      <Reader page={page} slugs={index.slugs} onLink={onLink} />
                    </>
                  ) : null}

                  {page && editing ? <Editor buffer={editor} slugs={index.slugs} /> : null}
                </>
              }
            />
          ) : null}

          {location.pane === "sources" ? (
            <Sources
              reloadKey={reloadKey}
              onOpenPage={(slug) => visit({ pane: "wiki", selection: slug })}
              onOpenSource={(id, fragment) => show({ kind: "provenance", source: id, fragment })}
            />
          ) : null}
          {location.pane === "checks" ? (
            <ChecksPane
              reloadKey={reloadKey}
              onCount={(count) => {
                setFindings(count);
                setChecksFailed(false);
              }}
              notice={<Reported notices={notices} place="checks" />}
              /* 5.3 — reaching what the finding named, from the finding. */
              actionFor={(finding) => (
                <Fixes
                  fixes={fixesFor(finding, knownSlugs)}
                  onOpenPage={(slug) => visit({ pane: "wiki", selection: slug })}
                  onOpenSource={(id) => void openSourceAt(id, show)}
                  onOpenAt={(id, fragment) => show({ kind: "provenance", source: id, fragment })}
                  onFixed={() => setReloadKey((n) => n + 1)}
                  say={say}
                />
              )}
            />
          ) : null}
          {/* A pane rather than a sheet over the window — see `navigation.ts`.
              Unmounted when you are elsewhere, unlike the chat pane below: it
              holds nothing a main process has heard of, so coming back to it
              simply re-reads the two files it is about. */}
          {location.pane === "settings" ? <Settings /> : null}

          {/* The chat pane stays mounted and is hidden when you are elsewhere.
              Unmounting it would reset the reducer holding the transcript and
              the `threadId` generated once per window (R7.1) — you would come
              back from the wiki pane to an empty conversation addressing a
              thread the main process has never heard of, with the checkpointed
              one unreachable. The wrapper is `display: contents`, so what the
              pane lays out against is unchanged. */}
          <div className="pane-chat" hidden={location.pane !== "chat"}>
            <Chat active={location.pane === "chat"} onOpenSettings={() => goTo("settings")} />
          </div>
        </main>
      </div>

      <StatusBar
        root={project?.root ?? ""}
        findings={findings}
        checksFailed={checksFailed}
        onGoToChecks={() => goTo("checks")}
        onUndo={lastWrite ? () => show({ kind: "history" }) : null}
      />

      {/* The overlays. Neither is a place you went (R2.2), so neither is in the
          history — closing one puts you back exactly where it opened. The
          settings were the third of these and are a pane above. */}
      {overlay?.kind === "history" ? (
        <Drawer title="History" onClose={dismiss}>
          <HistoryPanel reloadKey={reloadKey} />
        </Drawer>
      ) : null}

      {overlay?.kind === "provenance" ? (
        <SourceAt id={overlay.source} fragment={overlay.fragment} onClose={dismiss} />
      ) : null}

      {/* The open question, if there is one. A modal is in the top layer, so
          this sits at the end of the tree rather than beside what asked it. */}
      {dialog}
    </div>
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
      <div className="notice-row">
        <strong>
          {outcomes.length - failed.length} of {outcomes.length} added
        </strong>
        <span className="chrome__spacer" />
        <Button onClick={onDismiss}>Dismiss</Button>
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

/**
 * Creating a page. Every way it can fail is reported in the wiki pane, beside
 * the list and the button that started it — not in a line above the whole
 * window, where it was indistinguishable from a failed drop.
 */
async function createPage(
  index: WikiIndex,
  askFully: Dialogs["askFully"],
  visit: (location: Location) => void,
  say: (notice: Notice) => void,
): Promise<void> {
  // 8.2 — the slug *and* the type. The type is half of the `id`, so a window
  // that only made topics made every person and every project wrong in the one
  // field a later save validates.
  const answer = await askFully(newPageQuestion());
  const slug = answer?.text;
  if (!slug) return;
  if (index.slugs.includes(slug)) {
    say(failure("wiki", `a page named "${slug}" already exists — open it, or pick another name`));
    return;
  }
  try {
    const today = new Date().toISOString().slice(0, 10);
    const result = await bridge().create({
      slug,
      markdown: pageTemplate(slug, answer.chosen, today),
    });
    if (!result.saved) {
      say(
        failure("wiki", result.reason === "stale" ? "that page moved" : result.problems.join("; ")),
      );
      return;
    }
    visit({ pane: "wiki", selection: slug });
  } catch (e) {
    say(failure("wiki", e));
  }
}

/**
 * Take the project away as one zip (`specs/wiki-export` R4.3, wiki-pane R6).
 *
 * **The survey happens before the question and the question before the save
 * dialog.** `raw/` is where the bytes are, and a several-hundred-megabyte file
 * is a decision to make rather than one to discover afterwards — which is the
 * property the settings sheet had by printing the size beside the button, and
 * the only thing that had to be rebuilt when the button moved into a bar with no
 * room for a sentence.
 *
 * Where it goes is the save dialog's answer and never this window's: a path
 * crossing the bridge would be a compromised renderer naming anywhere the user
 * can write, which is the correction `record:start` already took.
 */
async function exportWiki(
  confirm: Dialogs["confirm"],
  say: (notice: Notice) => void,
): Promise<void> {
  let survey: ExportResult | null = null;
  try {
    survey = await bridge().exportSurvey();
  } catch {
    // Not knowing the size is a reason to say so, not a reason to refuse — the
    // question says which of the two it is asking under.
  }
  if (!(await confirm(exportQuestion(survey)))) return;
  try {
    const outcome = await bridge().exportRun();
    // Cancelling the save dialog is the feature working, so it says nothing
    // rather than reporting a failure the user caused on purpose.
    if (!outcome.ok) say(failure("wiki", outcome.reason));
    else if (!outcome.canceled) {
      say(note("wiki", `Exported ${outcome.files} files to ${outcome.path}`));
    }
  } catch (e) {
    say(failure("wiki", e));
  }
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
    visit({ pane: "wiki", selection: to });
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
    visit({ pane: "wiki" });
  } catch (e) {
    // Still on the page, because the delete did not happen.
    say(failure("page", e));
  }
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
        you the result. The pages themselves are an agent&rsquo;s to write — open the{" "}
        <strong>Chat</strong> pane to run the embedded agent against this project, or open this
        directory in your harness. An empty wiki is the ordinary way a project starts.
      </p>
      <p>
        The Chat pane runs the agent in this window, reading the project and writing pages through
        the gate, pausing for your approval on every write. The scaffold left{" "}
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
      <div className="notice-row">
        <strong>
          {names.length} {names.length === 1 ? "file is" : "files are"} waiting in raw/_inbox
        </strong>
        <span className="chrome__spacer" />
        <Button onClick={() => void take()} disabled={busy}>
          {busy ? "Adding…" : "Add them"}
        </Button>
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

/**
 * The fix buttons a finding carries (desktop-ui 5.3).
 *
 * Three, not the draft's five. What is missing and why is in `fixes.ts`: a
 * `Finding` does not carry the slug a broken link names, the instant a citation
 * overran, or the two words a synonym finding is about — those live inside the
 * prose of `message`, and cutting them back out is the failure `checks.ts`
 * already names at the site that would produce it.
 */
function Fixes({
  fixes,
  onOpenPage,
  onOpenSource,
  onOpenAt,
  onFixed,
  say,
}: {
  fixes: Fix[];
  onOpenPage: (slug: string) => void;
  onOpenSource: (id: string) => void;
  onOpenAt: (id: string, fragment: string) => void;
  onFixed: () => void;
  say: (notice: Notice) => void;
}): React.JSX.Element | null {
  const [busy, setBusy] = useState(false);
  if (fixes.length === 0) return null;

  const take = async (fix: Fix): Promise<void> => {
    if (fix.kind === "open-page") return onOpenPage(fix.target);
    if (fix.kind === "open-source") return onOpenSource(fix.target);
    // 5.6 — the recording opens at the last instant it actually contains, which
    // the finding carried rather than the button parsing it out of a sentence.
    if (fix.kind === "open-at") return onOpenAt(fix.target, fix.at ?? "0:00");

    setBusy(true);
    try {
      // 5.6 — write the page a broken wikilink names. It goes through the same
      // create the editor uses, so the page arrives valid, indexed and undoable
      // rather than as an empty file somebody has to finish.
      if (fix.kind === "create-page") {
        // `topic` is the type a page gets when nobody chose one, which is what
        // a broken link tells us: somebody meant to write this and has not yet.
        // The page opens straight away, because naming it is the easy half.
        const result = await bridge().create({
          slug: fix.target,
          markdown: pageTemplate(fix.target, "topic", new Date().toISOString().slice(0, 10)),
        });
        if (!result.saved) {
          say(
            note(
              "checks",
              result.reason === "stale" ? "that page moved" : result.problems.join("; "),
            ),
          );
        } else {
          onOpenPage(fix.target);
        }
        onFixed();
        return;
      }

      // 5.6 — rewrite the avoided synonym. `replaced` is reported because a
      // button that says nothing about how much it changed is a button nobody
      // trusts twice.
      if (fix.kind === "replace" && fix.replace) {
        const result = await bridge().replaceWord(fix.target, fix.replace.avoid, fix.replace.use);
        if (!result.ok) {
          say(note("checks", "problems" in result ? result.problems.join(" ") : result.reason));
        } else {
          say(
            note(
              "checks",
              `Replaced ${result.replaced} ${result.replaced === 1 ? "use" : "uses"} of "${fix.replace.avoid}".`,
            ),
          );
        }
        onFixed();
        return;
      }

      const result = await bridge().addToIndex(fix.target);
      // Already linked is not a failure and not a success either: the finding
      // was stale, and saying so is better than a button that appears to do
      // nothing.
      if (!result.added) {
        say(note("checks", `${fix.target} was already linked from the index.`));
      }
      onFixed();
    } catch (e) {
      say(failure("checks", e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="check__fixes">
      {fixes.map((fix) => (
        <Button
          key={fix.kind}
          size="sm"
          /* uxpass 7.5 — the ones that change the wiki look like it, and the
             ones that only take you somewhere do not. */
          variant={writesToDisk(fix.kind) ? "default" : "ghost"}
          disabled={busy}
          onClick={() => void take(fix)}
        >
          {fix.label}
        </Button>
      ))}
    </span>
  );
}

/**
 * Open a source at its own start (5.3).
 *
 * The kind decides the fragment — `0:00` for a recording, `p1` for a document
 * (`startFragment`) — and only the main process knows which this is, so the
 * detail is fetched rather than guessed. A guess would resolve to nothing on
 * half the sources while reading perfectly reasonably.
 */
async function openSourceAt(id: string, show: (overlay: Overlay) => void): Promise<void> {
  let kind: SourceKind | null = null;
  try {
    kind = (await bridge().sourceDetail(id)).kind;
  } catch {
    // A source the finding names and the project cannot describe still opens:
    // the panel says what is wrong with it, which is the answer either way.
  }
  show({ kind: "provenance", source: id, fragment: startFragment(kind) });
}
