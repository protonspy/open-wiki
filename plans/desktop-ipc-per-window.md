---
autonomy: auto
ci: wait
---

# One IPC handler per channel, one API per window

## Why

`ipcMain.handle` is registered on the app, once per channel name — but
`createWindow` registers the whole channel table every time it runs
(`apps/desktop/src/main/index.ts`). The first window works; the second cannot
exist. Opening a project from the launcher throws
`Attempted to register a second handler for 'project:info'` and no window opens,
which is 8.4's entire path from a launcher to a wiki.

Two more defects sit behind that one, and fixing only the throw would leave both
armed. The handler that answers every window is whichever window registered
first, so a project window opened from a launcher would be answered by the
launcher's project-less API — the `NoProjectError` already in the log. And
`window.on("closed")` calls `removeHandler` for every channel, so once two
windows can coexist, closing either disarms the other.

The launcher window also asks for `wiki:index`, `history:list` and
`sources:inbox-waiting` before it knows it has no project, because `App` mounts
the project shell while the answer to `project()` is still in flight. Those are
refusals the main process logs and the renderer paints as failures, on a window
where nothing was wrong.

Done means: a launcher opens a project into a second window, both windows answer
their own project, closing one leaves the other working, and a launcher window
asks no channel that needs a project.

## Tasks

- [x] 1.1 (Unit) Route an invocation to the window that sent it — a registry in
      `ipc.ts` that attaches an API under a window id, detaches it, and refuses an
      unknown sender rather than answering from another window's project
- [x] 1.2 (Unit) Register the channel table once at app ready, attach each
      window's API as it is created, and detach on close instead of removing the
      handlers every other window is still using
- [x] 1.3 (Unit) Hold the shell until the project answer arrives, so a window
      with no project never asks a channel that needs one

## Notes

Order matters: 1.2 consumes what 1.1 exports. 1.3 is independent of both — it is
the renderer half, and it is what makes the launcher's console quiet rather than
what makes the second window open.

`index.ts` is wiring no test in this repository can run (CI has no display), so
1.1 puts the decidable part — which window, what if none — in `ipc.ts` where a
test reaches it, and leaves `index.ts` holding the Electron calls only. 1.3 does
the same with a pure function for what a window shows.
