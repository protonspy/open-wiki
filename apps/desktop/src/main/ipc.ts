import { join } from "node:path";
import {
  recordingId,
  type Language,
  type Operation,
  type ProjectSettings,
} from "@open-wiki/access";
import type { Finding, SourceState } from "@open-wiki/access/read";
import type { PageView, ProjectInfo, WikiIndex } from "./api.js";
import { projectInfo, readPage, sources, wikiIndex } from "./api.js";
import type {
  ChatCancelInput,
  ChatResumeInput,
  ChatRunStarted,
  ChatSendInput,
} from "./agent/chat-events.js";
import type { ChatControl } from "./agent/chat-control.js";
import {
  createPage,
  addToIndex,
  savePageAsCopy,
  deletePage,
  history,
  renamePage,
  retitleSource,
  markSourceProcessed,
  savePage,
  savePageToday,
  undoOperation,
  type CreateInput,
  type CopyResult,
  type IndexResult,
  type RenameResult,
  type SaveInput,
  type SaveResult,
} from "./edit.js";
import { asDropOutcome, ingestDrop, type DropOutcome } from "./ingest.js";
import { drainInbox, listInbox, type InboxOutcome } from "@open-wiki/access";
import {
  createProject,
  credentialState,
  parseCredentialInput,
  currentLanguage,
  forgetProject,
  projectPath,
  saveCredentialForProject,
  knownProjects,
  saveCredential,
  setDeleteWav,
  setLanguage,
  settingsView,
  agentModels,
  selectAgentModel,
  type CredentialCheck,
  type CredentialState,
  type KnownProject,
  type SaveCredentialInput,
  type SettingsView,
} from "./settings.js";
import type { AgentPrefs } from "./agent/agent-prefs.js";
import { runTranscription, type TranscribeOutcome } from "./transcribe-run.js";
import {
  exportSurvey as surveyExport,
  runExport as runProjectExport,
  type ExportOutcome,
  type SaveDialog,
} from "./export.js";
import type { ExportResult } from "@open-wiki/access";
import type { RecorderSession, RecorderStatus } from "./recorder.js";
import {
  findings,
  locateCitation,
  sourceDetail,
  browseSource,
  revealPath,
  sourcesOfPage,
  type PageSource,
  type SourceLocation,
  type SourceRow,
  type SourceBrowse,
} from "./sources.js";
import { waveformOf } from "./waveform.js";

/**
 * The one list of things the renderer can ask for, and the only place the
 * project root is supplied (plan 8.2).
 *
 * Named as data rather than registered inline against Electron's `ipcMain`,
 * because that is what makes the surface reviewable and testable: the handlers
 * below are ordinary functions over a project root, and `index.ts` is the
 * dozen lines that bolt them to a window. Nothing here imports `electron`.
 */

import { CHANNELS } from "./channels.js";

export { CHANNELS };
export type { Channel } from "./channels.js";

/**
 * How a window gets at its recorder.
 *
 * Two methods rather than one, and the difference matters more than it looks.
 * `ensure` starts the sidecar; `peek` does not. `recorder.exe` opens both
 * WASAPI devices the moment it launches, before it reads a single request — so
 * a `status` poll that went through `ensure` would put the microphone into
 * Windows' in-use state as soon as the window opened, held for its lifetime,
 * while the chrome said nothing was being recorded. That is the exact failure
 * the persistent indicator exists to prevent, inverted.
 */
export interface RecorderControl {
  ensure(): RecorderSession;
  peek(): RecorderSession | null;
}

export interface Deps {
  /**
   * Null in a launcher window (plan 8.4). `ow` outside a project opens one,
   * and every channel that needs a project refuses by saying there is none —
   * which is a better answer than a window wired to a directory nobody chose.
   */
  projectRoot: string | null;
  recorder?: RecorderControl;
  /** The window's inbox watcher (3.7), when its initial scan has finished. */
  inbox?: InboxControl;
  /** The window's embedded agent (specs/embedded-agent), built where the push lives. */
  chat?: ChatControl;
  /**
   * Opening a window on another project (6.3), when the platform can.
   *
   * Injected because `BrowserWindow` lives in `index.ts` and this module is
   * what the tests reach — and absent in a test, which is also the honest
   * answer for a build where nothing can open a window.
   */
  openWindow?: (projectRoot: string) => void;
  /**
   * Showing a source file in the system file manager (plan 7.4).
   *
   * Injected for the same reason `openWindow` is: `shell` lives in `index.ts`
   * and this module is what the tests reach. Absent in a test, and absent in a
   * build where nothing can reveal a file.
   */
  reveal?: (file: string) => void;
  /**
   * The system save dialog, for the export of `specs/wiki-export` (R4.3).
   *
   * Injected for the same reason `openWindow` is: `dialog` lives with the
   * `BrowserWindow` in `index.ts`, and CI has no display. Absent in a test, and
   * absent is also the honest answer for a process with no window to ask from.
   */
  saveDialog?: SaveDialog;
  /** Injected so a test does not depend on today's date. */
  now?: () => Date;
}

/** What a window offers of its inbox watcher — draining, and nothing else. */
export interface InboxControl {
  drain(): Promise<InboxOutcome[]>;
}

/**
 * How long a file's size must hold steady before an explicit drain reads it.
 * The same wait `watchInbox` applies, because a file half-copied is half a
 * source whichever path reached it.
 */
export const INBOX_STABILITY_MS = 400;

/** What a window reports when nothing is being recorded. */
export const IDLE_STATUS: RecorderStatus = {
  state: "idle",
  recorded_ms: 0,
  mic_frames: 0,
  system_frames: 0,
  pauses: 0,
};

export interface StartedRecording {
  /** The frozen source id, from 4.16. */
  id: string;
  dir: string;
}

export interface DesktopApi {
  /** Null in a launcher window — the renderer shows the launcher instead. */
  project(): ProjectInfo | null;
  index(): WikiIndex;
  page(slug: string): PageView;
  sources(): SourceState[];
  /**
   * Start recording what the user said they are recording.
   *
   * It takes the *occasion* and not a directory. Every other handler binds the
   * project root rather than accepting a path, and this one used to be the
   * exception — the renderer named the directory the sidecar wrote into, which
   * is a compromised renderer choosing anywhere the user can write. The id
   * comes from 4.16 and the directory from it, so the recording lands under
   * `raw/` because there is nowhere else it can go.
   */
  recordStart(occasion: string): Promise<StartedRecording>;
  recordPause(): Promise<void>;
  recordResume(): Promise<void>;
  recordStop(): Promise<void>;
  recordStatus(): Promise<RecorderStatus>;

  save(input: SaveInput): SaveResult;
  create(input: CreateInput): SaveResult;
  rename(from: string, to: string): RenameResult;
  remove(slug: string): { operationId: string };
  addToIndex(slug: string): IndexResult;
  saveAsCopy(slug: string, markdown: string): CopyResult;
  history(): Operation[];
  undo(id: string): void;

  sourceDetail(id: string): SourceRow;
  markSource(id: string, processed: boolean): void;
  browseSource(id: string): SourceBrowse;
  revealSource(id: string): void;
  sourcesOfPage(slug: string): PageSource[];
  retitle(id: string, title: string): void;
  findings(): Finding[];
  locate(id: string, fragment: string): SourceLocation;
  waveform(id: string): Promise<number[] | null>;
  drop(paths: readonly string[]): Promise<DropOutcome[]>;
  /**
   * What is waiting in the doorway (plan 3.7), and taking it.
   *
   * **Asked for rather than pushed**, which is what makes the report reliable:
   * a window reports live arrivals over `CHANNELS.inbox`, but what was already
   * there when the window opened would be announced before the renderer had
   * subscribed and vanish. The renderer asks instead, whenever it likes.
   */
  inboxWaiting(): string[];
  inboxDrain(): Promise<DropOutcome[]>;

  credential(): CredentialState;
  saveCredential(input: SaveCredentialInput): Promise<CredentialCheck>;
  /** The agent's model list + current selection (R2.5). */
  agentModels(): AgentPrefs;
  /** Record the user's model pick; refuses a model the list never offered. */
  selectModel(model: string): AgentPrefs;
  language(): Language;
  setLanguage(language: Language): Language;
  settingsView(): SettingsView;
  setDeleteWav(on: boolean): ProjectSettings;
  knownProjects(): KnownProject[];
  createProject(name: string, directory: string, language: Language): KnownProject;
  forgetProject(name: string): void;
  openProject(name: string): void;
  saveCredentialFor(name: string, input: unknown): Promise<CredentialCheck>;
  transcribe(id: string, restart?: boolean): Promise<TranscribeOutcome>;

  /** What an export would carry, for the sentence before one is offered (R2.2). */
  exportSurvey(): ExportResult;
  /** Ask where, then write it (R4.3). */
  exportRun(): Promise<ExportOutcome>;

  /** The embedded agent — drive a run (R1.2, R5.2–R5.5, R7.2). */
  chatSend(input: ChatSendInput): ChatRunStarted;
  chatResume(input: ChatResumeInput): ChatRunStarted;
  chatCancel(input: ChatCancelInput): void;
}

export class NoProjectError extends Error {
  constructor() {
    super("this window has no project open");
    this.name = "NoProjectError";
  }
}

/** The agent runs only in a project window; a launcher has none to open it on. */
function chatControl(deps: Deps): ChatControl {
  if (!deps.chat) throw new Error("the agent is not available in this window");
  return deps.chat;
}

export function createApi(deps: Deps): DesktopApi {
  /** The project, or a refusal. Every channel but the launcher's needs one. */
  const root = (): string => {
    if (!deps.projectRoot) throw new NoProjectError();
    return deps.projectRoot;
  };
  const ensure = (): RecorderSession => {
    if (!deps.recorder) throw new Error("recording is not available in this window");
    return deps.recorder.ensure();
  };
  const running = (): RecorderSession => {
    const session = deps.recorder?.peek();
    if (!session) throw new Error("nothing is being recorded");
    return session;
  };
  const now = deps.now ?? ((): Date => new Date());

  return {
    project: () => (deps.projectRoot ? projectInfo(deps.projectRoot) : null),
    index: () => wikiIndex(root()),
    page: (slug) => readPage(root(), slug),
    sources: () => sources(root()),

    async recordStart(occasion) {
      if (!deps.recorder) throw new Error("recording is not available in this window");
      const id = recordingId(root(), { occasion, at: now() });
      const dir = join(root(), "raw", id);
      await ensure().start(occasion, dir);
      return { id, dir };
    },
    // `async`, so a refusal is a rejected promise rather than a synchronous
    // throw. `ipcMain.handle` turns either into a rejection on the renderer's
    // side, but a caller in the main process would have to handle two shapes.
    async recordPause() {
      return running().pause();
    },
    async recordResume() {
      return running().resume();
    },
    async recordStop() {
      return running().stop();
    },

    // `peek`, never `ensure`: polling where the recorder is must not be what
    // turns the microphone on.
    async recordStatus() {
      const session = deps.recorder?.peek();
      return session ? session.status() : IDLE_STATUS;
    },

    save: (input) => savePage(root(), input, savePageToday),
    create: (input) => createPage(root(), input, savePageToday),
    rename: (from, to) => renamePage(root(), from, to),
    remove: (slug) => deletePage(root(), slug),
    addToIndex: (slug) => addToIndex(root(), slug),
    saveAsCopy: (slug, markdown) => savePageAsCopy(root(), slug, markdown, savePageToday),
    history: () => history(root()),
    undo: (id) => undoOperation(root(), id),

    sourceDetail: (id) => sourceDetail(root(), id),
    sourcesOfPage: (slug) => sourcesOfPage(root(), slug),
    retitle: (id, title) => retitleSource(root(), id, title),
    markSource: (id, processed) => markSourceProcessed(root(), id, processed, savePageToday()),
    browseSource: (id) => browseSource(root(), id),
    revealSource: (id) => deps.reveal?.(revealPath(root(), id)),
    findings: () => findings(root()),
    locate: (id, fragment) => locateCitation(root(), id, fragment),
    waveform: (id) => waveformOf(root(), id),
    drop: (paths) => ingestDrop(root(), paths),
    inboxWaiting: () => listInbox(root()),
    // Through the window's watcher when there is one, so an explicit drain and
    // an event cannot both read the same file and both try to register the same
    // id. Standalone otherwise — a drain must still work in the window between
    // opening and the watcher finishing its initial scan.
    async inboxDrain() {
      const projectRoot = root();
      const outcomes = deps.inbox
        ? await deps.inbox.drain()
        : await drainInbox(projectRoot, { stabilityMs: INBOX_STABILITY_MS });
      return outcomes.map(asDropOutcome);
    },

    credential: () => credentialState(root()),
    saveCredential: (input) => saveCredential(root(), input),
    agentModels: () => agentModels(root()),
    selectModel: (model) => selectAgentModel(root(), model),
    language: () => currentLanguage(root()),
    setLanguage: (language) => setLanguage(root(), language),
    settingsView: () => settingsView(root()),
    setDeleteWav: (on) => setDeleteWav(root(), on),
    knownProjects: () => knownProjects(),
    createProject: (name, directory, language) => createProject(name, directory, language),
    forgetProject: (name) => forgetProject(name),
    openProject: (name) => {
      // The registry resolves the name; a window is opened on what it says.
      // `resolve` refuses an unknown name and a directory that moved, so a
      // stale entry cannot open a window on nothing.
      const path = projectPath(name);
      if (!deps.openWindow) throw new Error("this build cannot open a window");
      deps.openWindow(path);
    },
    saveCredentialFor: async (name, input) => {
      const parsed = parseCredentialInput(input);
      if (!parsed) return { ok: false, reason: "that is not a provider this application knows" };
      return saveCredentialForProject(name, parsed);
    },
    transcribe: (id, restart) => runTranscription(root(), id, { restart }),

    exportSurvey: () => surveyExport(root()),
    // The dialog comes from `deps`, never from `electron` here: CI has no
    // display, and a window is not what decides whether the archive is right.
    async exportRun() {
      if (!deps.saveDialog) throw new Error("exporting needs a window to ask from");
      return runProjectExport(root(), savePageToday(), deps.saveDialog);
    },

    chatSend: (input) => chatControl(deps).send(input),
    chatResume: (input) => chatControl(deps).resume(input),
    chatCancel: (input) => chatControl(deps).cancel(input),
  };
}

/**
 * Route one invocation. Unknown channels are refused rather than ignored: a
 * renderer asking for something that does not exist is a bug, and a promise
 * that never settles is the least helpful way to report one.
 */
export async function dispatch(
  api: DesktopApi,
  channel: string,
  args: readonly unknown[],
): Promise<unknown> {
  switch (channel) {
    case CHANNELS.project:
      return api.project();
    case CHANNELS.index:
      return api.index();
    case CHANNELS.page:
      return api.page(String(args[0] ?? ""));
    case CHANNELS.sources:
      return api.sources();
    case CHANNELS.recordStart:
      return api.recordStart(String(args[0] ?? ""));
    case CHANNELS.recordPause:
      return api.recordPause();
    case CHANNELS.recordResume:
      return api.recordResume();
    case CHANNELS.recordStop:
      return api.recordStop();
    case CHANNELS.recordStatus:
      return api.recordStatus();

    case CHANNELS.save:
      return api.save(args[0] as SaveInput);
    case CHANNELS.create:
      return api.create(args[0] as CreateInput);
    case CHANNELS.rename:
      return api.rename(String(args[0] ?? ""), String(args[1] ?? ""));
    case CHANNELS.remove:
      return api.remove(String(args[0] ?? ""));
    case CHANNELS.addToIndex:
      return api.addToIndex(String(args[0] ?? ""));
    case CHANNELS.saveAsCopy:
      return api.saveAsCopy(String(args[0] ?? ""), String(args[1] ?? ""));
    case CHANNELS.history:
      return api.history();
    case CHANNELS.undo:
      return api.undo(String(args[0] ?? ""));

    case CHANNELS.sourceDetail:
      return api.sourceDetail(String(args[0] ?? ""));
    case CHANNELS.sourcesOfPage:
      return api.sourcesOfPage(String(args[0] ?? ""));
    case CHANNELS.retitle:
      return api.retitle(String(args[0] ?? ""), String(args[1] ?? ""));
    case CHANNELS.markSource:
      return api.markSource(String(args[0] ?? ""), Boolean(args[1]));
    case CHANNELS.browseSource:
      return api.browseSource(String(args[0] ?? ""));
    case CHANNELS.revealSource:
      return api.revealSource(String(args[0] ?? ""));
    case CHANNELS.findings:
      return api.findings();
    case CHANNELS.locate:
      return api.locate(String(args[0] ?? ""), String(args[1] ?? ""));
    case CHANNELS.waveform:
      return api.waveform(String(args[0] ?? ""));
    case CHANNELS.credential:
      return api.credential();
    case CHANNELS.saveCredential: {
      // Parsed, not cast. Every other channel coerces its arguments; this one
      // carries the shape that decides what is written into the secrets file.
      const input = parseCredentialInput(args[0]);
      if (!input) throw new Error("that is not a transcription provider");
      return api.saveCredential(input);
    }
    case CHANNELS.agentModels:
      return api.agentModels();
    case CHANNELS.selectModel: {
      const model = String(args[0] ?? "");
      if (!model) throw new Error("select-model needs a model id");
      return api.selectModel(model);
    }
    case CHANNELS.language:
      return api.language();
    case CHANNELS.setLanguage:
      return api.setLanguage(String(args[0] ?? "") as Language);
    case CHANNELS.settingsView:
      return api.settingsView();
    case CHANNELS.setDeleteWav:
      return api.setDeleteWav(args[0] === true);
    case CHANNELS.knownProjects:
      return api.knownProjects();
    case CHANNELS.createProject:
      return api.createProject(
        String(args[0] ?? ""),
        String(args[1] ?? ""),
        String(args[2] ?? "en") as Language,
      );
    case CHANNELS.forgetProject:
      return api.forgetProject(String(args[0] ?? ""));
    case CHANNELS.openProject:
      return api.openProject(String(args[0] ?? ""));
    case CHANNELS.saveCredentialFor:
      return api.saveCredentialFor(String(args[0] ?? ""), args[1]);
    case CHANNELS.transcribe:
      return api.transcribe(String(args[0] ?? ""), args[1] === true);

    // Neither takes an argument. Where the archive goes is the save dialog's
    // answer and never the renderer's: a path crossing the bridge would be a
    // compromised renderer naming anywhere the user can write, which is the
    // same correction `record:start` already took.
    case CHANNELS.exportSurvey:
      return api.exportSurvey();
    case CHANNELS.exportRun:
      return api.exportRun();

    case CHANNELS.drop:
      // The renderer hands over paths Chromium gave it for a drop. Anything
      // that is not a string is not a path.
      return api.drop((Array.isArray(args[0]) ? args[0] : []).filter((p) => typeof p === "string"));
    case CHANNELS.inboxWaiting:
      return api.inboxWaiting();
    case CHANNELS.inboxDrain:
      return api.inboxDrain();

    case CHANNELS.chatSend: {
      const input = args[0] as ChatSendInput | undefined;
      if (!input || typeof input.text !== "string" || typeof input.threadId !== "string") {
        throw new Error("chat:send needs { text, threadId }");
      }
      return api.chatSend(input);
    }
    case CHANNELS.chatResume: {
      const input = args[0] as ChatResumeInput | undefined;
      if (
        !input ||
        typeof input.threadId !== "string" ||
        !Array.isArray(input.decisions) ||
        typeof input.interruptId !== "string" ||
        typeof input.runId !== "string"
      ) {
        throw new Error("chat:resume needs { threadId, decisions, interruptId, runId }");
      }
      return api.chatResume(input);
    }
    case CHANNELS.chatCancel: {
      const input = args[0] as ChatCancelInput | undefined;
      if (!input || typeof input.runId !== "string") {
        throw new Error("chat:cancel needs { runId }");
      }
      api.chatCancel(input);
      return undefined;
    }

    default:
      throw new Error(`unknown channel "${channel}"`);
  }
}
