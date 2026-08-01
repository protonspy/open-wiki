import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CHANNELS, createApi, dispatch, INBOX_STABILITY_MS } from "./ipc.js";
import { PUSH_CHANNELS } from "./channels.js";
import { asDropOutcome, inboxFailure } from "./ingest.js";
import { resolveProject } from "./project.js";
import { RecorderSession, resolveRecorder, spawnTransport } from "./recorder.js";
import { applyPackagedBinaries } from "./resources.js";
import { serveQueries } from "@open-wiki/access/socket";
import { drainInbox, watchInbox, type InboxOutcome, type InboxWatcher } from "@open-wiki/access";
import { isOpenableExternally } from "../renderer/navigation.js";
import { watchProject } from "./watcher.js";

/**
 * The Electron entry point (plan 8.2).
 *
 * Deliberately thin. Everything worth being right about — which project this
 * is, what the renderer may ask for, what a change to the folder means —
 * lives in a module beside it that a test can call without starting a window.
 * What is left here is the wiring, and wiring is the part no test in this
 * repository can run: CI has no display.
 */

const here = fileURLToPath(import.meta.url);

function createWindow(projectRoot: string | null): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: "#101216",
    webPreferences: {
      // `.cjs`, and that is not a detail: a sandboxed preload cannot be an ES
      // module, and this package is `"type": "module"`, so a `.js` bundle here
      // would be parsed as ESM and fail to load — leaving a window with no
      // `window.ow` at all.
      preload: join(here, "..", "preload.cjs"),
      // The three that matter. This window renders markdown an agent wrote,
      // and a renderer with Node in it is one prompt injection away from being
      // the agent's hands.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // One recorder per window: two would fight over the microphone and the
  // second would silently capture nothing.
  //
  // `ensure` is reached only by `record:start`. `recorder.exe` opens both
  // WASAPI devices the moment it launches, before reading a request, so
  // anything else that constructed a session would hold the microphone from
  // the moment the window opened — with the chrome saying nothing was being
  // recorded.
  let session: RecorderSession | null = null;
  const recorder = {
    ensure(): RecorderSession {
      // A session whose sidecar has died is not reusable. Without this, one
      // crash makes recording impossible until the window is reopened.
      if (session?.isClosed) session = null;
      session ??= new RecorderSession(spawnTransport(resolveRecorder()));
      return session;
    },
    peek(): RecorderSession | null {
      if (session?.isClosed) session = null;
      return session;
    },
  };

  // 3.7 — the doorway's watcher, which arrives asynchronously; see below.
  let inbox: InboxWatcher | null = null;
  let closed = false;

  // The window's own watcher once its initial scan has finished, so an explicit
  // drain and an event cannot both read the same file and both try to register
  // the same id. Standalone until then: a drain must still work in the seconds
  // between the window opening and the scan completing.
  const inboxDrain = (root: string): Promise<InboxOutcome[]> =>
    inbox ? inbox.drain() : drainInbox(root, { stabilityMs: INBOX_STABILITY_MS });

  const api = createApi({
    projectRoot,
    recorder,
    ...(projectRoot ? { inbox: { drain: () => inboxDrain(projectRoot) } } : {}),
  });
  for (const channel of Object.values(CHANNELS)) {
    if (PUSH_CHANNELS.has(channel)) continue; // main → renderer only
    ipcMain.handle(channel, (_event, ...args: unknown[]) => dispatch(api, channel, args));
  }

  /**
   * Tell the window something.
   *
   * **Buffered until the document has loaded.** `webContents.send` before that
   * is dropped on the floor with no queue and no error, and the things pushed
   * here are reports — a file that arrived, a watcher that died. A report that
   * silently goes nowhere is the failure this channel exists to prevent.
   */
  let loaded = false;
  const waiting: Array<{ channel: string; payload: unknown }> = [];
  const send = (channel: string, payload: unknown): void => {
    if (window.isDestroyed()) return;
    if (!loaded) {
      waiting.push({ channel, payload });
      return;
    }
    window.webContents.send(channel, payload);
  };
  window.webContents.once("did-finish-load", () => {
    loaded = true;
    for (const message of waiting) {
      if (!window.isDestroyed()) window.webContents.send(message.channel, message.payload);
    }
    waiting.length = 0;
  });

  // 9.14 — the CLI asks here rather than starting a process, when this
  // window already has the project open. Read and validate only; the socket
  // never carries a write.
  const queries = projectRoot ? serveQueries(projectRoot) : null;

  // 8.10 — whoever wrote it, the screen follows. A launcher window has no
  // project to watch.
  const watcher = projectRoot
    ? watchProject(projectRoot, (change) => send(CHANNELS.changed, change))
    : null;

  // 3.7 — the doorway. An agent that fetched something writes it into
  // `raw/_inbox/` with its own tools, and it becomes a source through the same
  // registration a dropped file goes through. This is the process that holds
  // the watcher open; until it existed the doorway only worked when something
  // called `drainInbox` by hand.
  //
  // Started asynchronously — `watchInbox` waits for chokidar's initial scan, and
  // a window that blocked on it would be a window that does not open. So the
  // handle arrives late, and a window closed before it does has to close it
  // anyway or the watcher outlives its window.
  //
  // **`ingestExisting: false`.** What is already in the doorway when a window
  // opens is listed and left alone; only what arrives while it is open is taken
  // on sight. `raw/` comes with a clone, so the alternative is a repository
  // shipping `raw/_inbox/x.pdf` and this application parsing a stranger's bytes
  // in the main process — and deleting the file out of the user's tree — before
  // anybody clicked anything.
  if (projectRoot) {
    void watchInbox(
      projectRoot,
      {
        onOutcome: (outcome) => send(CHANNELS.inbox, asDropOutcome(outcome)),
        onError: (error) => send(CHANNELS.inbox, inboxFailure(error)),
      },
      { ingestExisting: false },
    )
      .then((started) => {
        // `return`, not `void`: a discarded promise here escapes the `.catch`
        // below and becomes an unhandled rejection in the main process.
        if (closed) return started.close();
        inbox = started;
        return undefined;
      })
      .catch((error: unknown) => {
        send(
          CHANNELS.inbox,
          inboxFailure(error instanceof Error ? error : new Error(String(error))),
        );
      });
  }

  window.on("closed", () => {
    closed = true;
    void watcher?.close();
    void inbox?.close();
    queries?.close();
    session?.dispose();
    for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel);
  });

  const devServer = process.env["VITE_DEV_SERVER_URL"];
  const entry = resolve(here, "..", "..", "..", "build", "renderer", "index.html");
  const allowed = devServer ?? pathToFileURL(entry).href;

  // A link the wiki's author wrote goes to the user's browser — and only if it
  // is a scheme a browser handles. `shell.openExternal` is `ShellExecute` on
  // Windows: it invokes whichever protocol handler is registered, and
  // `ms-msdt:`, `ms-officecmd:` and `search-ms:` against a WebDAV share are
  // documented paths from "a link in a document" to code execution.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isOpenableExternally(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  // **The renderer never navigates.** The click handler in the page is
  // renderer-side JavaScript, which is a convenience and not a boundary —
  // a drag-and-drop, a `window.location`, or any renderer bug navigates
  // without one. A preload re-runs on every navigation in the same
  // `webContents`, so a window that reached a remote origin would hand that
  // origin `window.ow`, and the `<meta>` CSP would stay behind with the old
  // document.
  const refuseNavigation = (event: { preventDefault(): void }, url: string): void => {
    if (url !== allowed) event.preventDefault();
  };
  window.webContents.on("will-navigate", refuseNavigation);
  window.webContents.on("will-frame-navigate", (event) => {
    refuseNavigation(event, event.url);
  });
  // Nothing in this application attaches a webview, and one attached anyway
  // would be a frame with its own preferences.
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());

  if (devServer) void window.loadURL(devServer);
  else void window.loadFile(entry);

  return window;
}

void app.whenReady().then(() => {
  // 10.1 — ffmpeg and `recorder.exe` ship beside the asar, and the resolvers
  // that look for them count directories up from their own source file. The
  // bundle collapses those depths, so the packaged location is stated here.
  if (app.isPackaged) applyPackagedBinaries(process.resourcesPath);

  // 8.4 — `ow` outside a project opens the launcher rather than guessing at
  // one. A window with no project answers `null` to `project()`, and the
  // renderer shows the list of known projects instead of a wiki.
  createWindow(resolveProject({ argv: process.argv, cwd: process.cwd() }));
});

app.on("window-all-closed", () => app.quit());
