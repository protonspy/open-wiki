import { contextBridge, ipcRenderer, webUtils } from "electron";
// From `channels.js`, never from `ipc.js`. A preload that imported the latter
// dragged the whole main-process graph — the store, the audio package — into a
// sandboxed bundle that cannot run any of it.
import { CHANNELS } from "./channels.js";
import type { OwBridge } from "../renderer/bridge.js";

/**
 * The bridge, and the whole of what the renderer can touch (plan 8.2).
 *
 * `contextIsolation` is on and `nodeIntegration` is off, so the renderer has
 * no `require`, no `fs`, and no way to reach the project except through the
 * named channels below. That is not ceremony: this window renders markdown
 * written by an agent, and a renderer with filesystem access is one prompt
 * injection away from being the agent's hands.
 *
 * **This file is checked against `OwBridge` at the bottom.** A channel handled
 * in `ipc.ts` and declared on the bridge but forgotten here is a feature that
 * typechecks, tests green, and throws "not a function" the first time somebody
 * clicks it — which is exactly what happened once, because `bridge.ts`
 * *asserts* the shape of `window.ow` rather than deriving it. The assignment
 * at the end makes the gap a compile error.
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
  recordDevices: () => ipcRenderer.invoke(CHANNELS.recordDevices),

  save: (input: unknown) => ipcRenderer.invoke(CHANNELS.save, input),
  create: (input: unknown) => ipcRenderer.invoke(CHANNELS.create, input),
  rename: (from: string, to: string) => ipcRenderer.invoke(CHANNELS.rename, from, to),
  remove: (slug: string) => ipcRenderer.invoke(CHANNELS.remove, slug),
  addToIndex: (slug: string) => ipcRenderer.invoke(CHANNELS.addToIndex, slug),
  saveAsCopy: (slug: string, markdown: string) =>
    ipcRenderer.invoke(CHANNELS.saveAsCopy, slug, markdown),
  history: () => ipcRenderer.invoke(CHANNELS.history),
  undo: (id: string) => ipcRenderer.invoke(CHANNELS.undo, id),

  sourceDetail: (id: string) => ipcRenderer.invoke(CHANNELS.sourceDetail, id),
  sourcesOfPage: (slug: string) => ipcRenderer.invoke(CHANNELS.sourcesOfPage, slug),
  retitle: (id: string, title: string) => ipcRenderer.invoke(CHANNELS.retitle, id, title),
  replaceWord: (page: string, avoid: string, use: string) =>
    ipcRenderer.invoke(CHANNELS.replaceWord, page, avoid, use),
  markSource: (id: string, processed: boolean) =>
    ipcRenderer.invoke(CHANNELS.markSource, id, processed),
  browseSource: (id: string) => ipcRenderer.invoke(CHANNELS.browseSource, id),
  revealSource: (id: string) => ipcRenderer.invoke(CHANNELS.revealSource, id),
  findings: () => ipcRenderer.invoke(CHANNELS.findings),
  locate: (id: string, fragment: string) => ipcRenderer.invoke(CHANNELS.locate, id, fragment),
  waveform: (id: string) => ipcRenderer.invoke(CHANNELS.waveform, id),
  drop: (paths: readonly string[]) => ipcRenderer.invoke(CHANNELS.drop, paths),
  inboxWaiting: () => ipcRenderer.invoke(CHANNELS.inboxWaiting),
  inboxDrain: () => ipcRenderer.invoke(CHANNELS.inboxDrain),

  credential: () => ipcRenderer.invoke(CHANNELS.credential),
  saveCredential: (input: unknown) => ipcRenderer.invoke(CHANNELS.saveCredential, input),
  agentModels: () => ipcRenderer.invoke(CHANNELS.agentModels),
  selectModel: (model: string) => ipcRenderer.invoke(CHANNELS.selectModel, model),
  language: () => ipcRenderer.invoke(CHANNELS.language),
  setLanguage: (language: string) => ipcRenderer.invoke(CHANNELS.setLanguage, language),
  settingsView: () => ipcRenderer.invoke(CHANNELS.settingsView),
  setDeleteWav: (on: boolean) => ipcRenderer.invoke(CHANNELS.setDeleteWav, on),
  knownProjects: () => ipcRenderer.invoke(CHANNELS.knownProjects),
  createProject: (name: string, directory: string, language: string, harnesses: string[]) =>
    ipcRenderer.invoke(CHANNELS.createProject, name, directory, language, harnesses),
  forgetProject: (name: string) => ipcRenderer.invoke(CHANNELS.forgetProject, name),
  openProject: (name: string) => ipcRenderer.invoke(CHANNELS.openProject, name),
  chooseDirectory: () => ipcRenderer.invoke(CHANNELS.chooseDirectory),
  openDirectory: (directory: string) => ipcRenderer.invoke(CHANNELS.openDirectory, directory),
  defaultDirectory: () => ipcRenderer.invoke(CHANNELS.defaultDirectory),
  saveCredentialFor: (name: string, input: unknown) =>
    ipcRenderer.invoke(CHANNELS.saveCredentialFor, name, input),
  transcribe: (id: string, restart?: boolean) =>
    ipcRenderer.invoke(CHANNELS.transcribe, id, restart === true),
  exportSurvey: () => ipcRenderer.invoke(CHANNELS.exportSurvey),
  exportRun: () => ipcRenderer.invoke(CHANNELS.exportRun),

  chatSend: (input: unknown) => ipcRenderer.invoke(CHANNELS.chatSend, input),
  chatResume: (input: unknown) => ipcRenderer.invoke(CHANNELS.chatResume, input),
  chatCancel: (input: unknown) => ipcRenderer.invoke(CHANNELS.chatCancel, input),

  /**
   * The path of a dropped file (plan 3.5).
   *
   * `File.path` was removed in Electron 32, so the renderer cannot read it;
   * `webUtils.getPathForFile` is the replacement and it lives here, on the
   * privileged side. Without this the drop handler silently produced an empty
   * list and did nothing at all — the opposite of "see what was recognised and
   * what was not".
   */
  pathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },

  /** 8.10 — the folder changed, whoever wrote it. */
  onChanged: (handler: (change: unknown) => void) => {
    const listener = (_event: unknown, change: unknown): void => handler(change);
    ipcRenderer.on(CHANNELS.changed, listener);
    return () => ipcRenderer.removeListener(CHANNELS.changed, listener);
  },

  /** 3.7 — something arrived through `raw/_inbox/`, or the doorway broke. */
  onInbox: (handler: (outcome: unknown) => void) => {
    const listener = (_event: unknown, outcome: unknown): void => handler(outcome);
    ipcRenderer.on(CHANNELS.inbox, listener);
    return () => ipcRenderer.removeListener(CHANNELS.inbox, listener);
  },

  /** The agent's stream — token/tool/interrupt/done/error (specs/embedded-agent). */
  onChatEvent: (handler: (event: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown): void => handler(payload);
    ipcRenderer.on(CHANNELS.chatEvent, listener);
    return () => ipcRenderer.removeListener(CHANNELS.chatEvent, listener);
  },
};

contextBridge.exposeInMainWorld("ow", api);

export type PreloadApi = typeof api;

/**
 * The parity check. If `OwBridge` gains a method this object does not have,
 * this line stops compiling — which is the whole point of it existing.
 */
const _parity: (keyof OwBridge)[] = Object.keys(api) as (keyof OwBridge)[];
void _parity;
