import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CHANNELS, createApi, dispatch } from "./ipc.js";
import { resolveProject } from "./project.js";
import { RecorderSession, resolveRecorder, spawnTransport } from "./recorder.js";
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

function createWindow(projectRoot: string): BrowserWindow {
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

  // One recorder per window, started lazily: two would fight over the
  // microphone and the second would silently capture nothing.
  let session: RecorderSession | null = null;
  const recorder = (): RecorderSession => {
    session ??= new RecorderSession(spawnTransport(resolveRecorder()));
    return session;
  };

  const api = createApi({ projectRoot, recorder });
  for (const channel of Object.values(CHANNELS)) {
    if (channel === CHANNELS.changed) continue; // main → renderer only
    ipcMain.handle(channel, (_event, ...args: unknown[]) => dispatch(api, channel, args));
  }

  // 8.10 — whoever wrote it, the screen follows.
  const watcher = watchProject(projectRoot, (change) => {
    if (!window.isDestroyed()) window.webContents.send(CHANNELS.changed, change);
  });

  window.on("closed", () => {
    void watcher.close();
    session?.dispose();
    for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel);
  });

  // A link the wiki's author wrote goes to the user's browser, never here: a
  // renderer that navigates away is a renderer showing somebody else's page
  // with our preload attached.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const devServer = process.env["VITE_DEV_SERVER_URL"];
  if (devServer) void window.loadURL(devServer);
  else void window.loadFile(resolve(here, "..", "..", "..", "build", "renderer", "index.html"));

  return window;
}

void app.whenReady().then(() => {
  const projectRoot = resolveProject({ argv: process.argv, cwd: process.cwd() });
  if (!projectRoot) {
    // 8.4's launcher is what belongs here. Until it exists, saying so beats
    // opening the user's home directory as though it were a wiki.
    process.stderr.write(
      "open-wiki: no project here. Run `ow` inside a project directory, " +
        "or `ow init` to create one.\n",
    );
    app.quit();
    return;
  }
  createWindow(projectRoot);
});

app.on("window-all-closed", () => app.quit());
