import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CHANNELS, createApi, dispatch } from "./ipc.js";
import { resolveProject } from "./project.js";
import { RecorderSession, resolveRecorder, spawnTransport } from "./recorder.js";
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
      preload: join(here, "..", "preload.js"),
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

  const api = createApi({ projectRoot, recorder });
  for (const channel of Object.values(CHANNELS)) {
    if (channel === CHANNELS.changed) continue; // main → renderer only
    ipcMain.handle(channel, (_event, ...args: unknown[]) => dispatch(api, channel, args));
  }

  // 8.10 — whoever wrote it, the screen follows. A launcher window has no
  // project to watch.
  const watcher = projectRoot
    ? watchProject(projectRoot, (change) => {
        if (!window.isDestroyed()) window.webContents.send(CHANNELS.changed, change);
      })
    : null;

  window.on("closed", () => {
    void watcher?.close();
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
  // 8.4 — `ow` outside a project opens the launcher rather than guessing at
  // one. A window with no project answers `null` to `project()`, and the
  // renderer shows the list of known projects instead of a wiki.
  createWindow(resolveProject({ argv: process.argv, cwd: process.cwd() }));
});

app.on("window-all-closed", () => app.quit());
