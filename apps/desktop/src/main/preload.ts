import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS } from "./ipc.js";

/**
 * The bridge, and the whole of what the renderer can touch (plan 8.2).
 *
 * `contextIsolation` is on and `nodeIntegration` is off, so the renderer has
 * no `require`, no `fs`, and no way to reach the project except through the
 * named channels below. That is not ceremony: this window renders markdown
 * written by an agent, and a renderer with filesystem access is one prompt
 * injection away from being the agent's hands.
 */

const api = {
  project: () => ipcRenderer.invoke(CHANNELS.project),
  index: () => ipcRenderer.invoke(CHANNELS.index),
  page: (slug: string) => ipcRenderer.invoke(CHANNELS.page, slug),
  sources: () => ipcRenderer.invoke(CHANNELS.sources),
  recordStart: (occasion: string) => ipcRenderer.invoke(CHANNELS.recordStart, occasion),
  recordPause: () => ipcRenderer.invoke(CHANNELS.recordPause),
  recordResume: () => ipcRenderer.invoke(CHANNELS.recordResume),
  recordStop: () => ipcRenderer.invoke(CHANNELS.recordStop),
  recordStatus: () => ipcRenderer.invoke(CHANNELS.recordStatus),
  /** 8.10 — the folder changed, whoever wrote it. */
  onChanged: (handler: (change: unknown) => void) => {
    const listener = (_event: unknown, change: unknown): void => handler(change);
    ipcRenderer.on(CHANNELS.changed, listener);
    return () => ipcRenderer.removeListener(CHANNELS.changed, listener);
  },
};

contextBridge.exposeInMainWorld("ow", api);

export type PreloadApi = typeof api;
