import { join } from "node:path";
import { recordingId, type Language, type Operation } from "@open-wiki/access";
import type { Finding, SourceState } from "@open-wiki/access/read";
import type { PageView, ProjectInfo, WikiIndex } from "./api.js";
import { projectInfo, readPage, sources, wikiIndex } from "./api.js";
import {
  createPage,
  deletePage,
  history,
  renamePage,
  retitleSource,
  savePage,
  savePageToday,
  undoOperation,
  type CreateInput,
  type RenameResult,
  type SaveInput,
  type SaveResult,
} from "./edit.js";
import { ingestDrop, type DropOutcome } from "./ingest.js";
import {
  createProject,
  credentialState,
  currentLanguage,
  forgetProject,
  knownProjects,
  saveCredential,
  setLanguage,
  type CredentialCheck,
  type CredentialState,
  type KnownProject,
  type SaveCredentialInput,
} from "./settings.js";
import { runTranscription, type TranscribeOutcome } from "./transcribe-run.js";
import type { RecorderSession, RecorderStatus } from "./recorder.js";
import {
  findings,
  locateCitation,
  sourceDetail,
  sourcesOfPage,
  type SourceLocation,
  type SourceRow,
} from "./sources.js";

/**
 * The one list of things the renderer can ask for, and the only place the
 * project root is supplied (plan 8.2).
 *
 * Named as data rather than registered inline against Electron's `ipcMain`,
 * because that is what makes the surface reviewable and testable: the handlers
 * below are ordinary functions over a project root, and `index.ts` is the
 * dozen lines that bolt them to a window. Nothing here imports `electron`.
 */

export const CHANNELS = {
  project: "project:info",
  index: "wiki:index",
  page: "wiki:page",
  sources: "sources:list",
  recordStart: "record:start",
  recordPause: "record:pause",
  recordResume: "record:resume",
  recordStop: "record:stop",
  recordStatus: "record:status",

  // Editing (8.7, 8.8, 8.9) and the history behind it (8.11).
  save: "wiki:save",
  create: "wiki:create",
  rename: "wiki:rename",
  remove: "wiki:delete",
  history: "history:list",
  undo: "history:undo",

  // Sources (6.2 to 6.7), the checks (7.6), and what a citation opens (8.6).
  sourceDetail: "sources:detail",
  sourcesOfPage: "sources:of-page",
  retitle: "sources:retitle",
  findings: "check:findings",
  locate: "sources:locate",
  drop: "sources:drop",

  // The credential (8.3), the launcher (8.4), the content language (8.12) and
  // the run 6.3 starts.
  credential: "settings:credential",
  saveCredential: "settings:save-credential",
  language: "settings:language",
  setLanguage: "settings:set-language",
  knownProjects: "launcher:projects",
  createProject: "launcher:create",
  forgetProject: "launcher:forget",
  transcribe: "sources:transcribe",

  /** Main → renderer, for 8.10. */
  changed: "project:changed",
} as const;

export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];

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
  projectRoot: string;
  recorder?: RecorderControl;
  /** Injected so a test does not depend on today's date. */
  now?: () => Date;
  /** 6.3 — per-chunk progress, forwarded to the window. */
  onProgress?: (done: number, total: number) => void;
}

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
  project(): ProjectInfo;
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
  history(): Operation[];
  undo(id: string): void;

  sourceDetail(id: string): SourceRow;
  sourcesOfPage(slug: string): string[];
  retitle(id: string, title: string): void;
  findings(): Finding[];
  locate(id: string, fragment: string): SourceLocation;
  drop(paths: readonly string[]): Promise<DropOutcome[]>;

  credential(): CredentialState;
  saveCredential(input: SaveCredentialInput): Promise<CredentialCheck>;
  language(): Language;
  setLanguage(language: Language): Language;
  knownProjects(): KnownProject[];
  createProject(name: string, directory: string, language: Language): KnownProject;
  forgetProject(name: string): void;
  transcribe(id: string): Promise<TranscribeOutcome>;
}

export function createApi(deps: Deps): DesktopApi {
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
    project: () => projectInfo(deps.projectRoot),
    index: () => wikiIndex(deps.projectRoot),
    page: (slug) => readPage(deps.projectRoot, slug),
    sources: () => sources(deps.projectRoot),

    async recordStart(occasion) {
      if (!deps.recorder) throw new Error("recording is not available in this window");
      const id = recordingId(deps.projectRoot, { occasion, at: now() });
      const dir = join(deps.projectRoot, "raw", id);
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

    save: (input) => savePage(deps.projectRoot, input, savePageToday),
    create: (input) => createPage(deps.projectRoot, input, savePageToday),
    rename: (from, to) => renamePage(deps.projectRoot, from, to),
    remove: (slug) => deletePage(deps.projectRoot, slug),
    history: () => history(deps.projectRoot),
    undo: (id) => undoOperation(deps.projectRoot, id),

    sourceDetail: (id) => sourceDetail(deps.projectRoot, id),
    sourcesOfPage: (slug) => sourcesOfPage(deps.projectRoot, slug),
    retitle: (id, title) => retitleSource(deps.projectRoot, id, title),
    findings: () => findings(deps.projectRoot),
    locate: (id, fragment) => locateCitation(deps.projectRoot, id, fragment),
    drop: (paths) => ingestDrop(deps.projectRoot, paths),

    credential: () => credentialState(deps.projectRoot),
    saveCredential: (input) => saveCredential(deps.projectRoot, input),
    language: () => currentLanguage(deps.projectRoot),
    setLanguage: (language) => setLanguage(deps.projectRoot, language),
    knownProjects: () => knownProjects(),
    createProject: (name, directory, language) => createProject(name, directory, language),
    forgetProject: (name) => forgetProject(name),
    transcribe: (id) => runTranscription(deps.projectRoot, id, deps.onProgress),
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
    case CHANNELS.findings:
      return api.findings();
    case CHANNELS.locate:
      return api.locate(String(args[0] ?? ""), String(args[1] ?? ""));
    case CHANNELS.credential:
      return api.credential();
    case CHANNELS.saveCredential:
      return api.saveCredential(args[0] as SaveCredentialInput);
    case CHANNELS.language:
      return api.language();
    case CHANNELS.setLanguage:
      return api.setLanguage(String(args[0] ?? "") as Language);
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
    case CHANNELS.transcribe:
      return api.transcribe(String(args[0] ?? ""));

    case CHANNELS.drop:
      // The renderer hands over paths Chromium gave it for a drop. Anything
      // that is not a string is not a path.
      return api.drop((Array.isArray(args[0]) ? args[0] : []).filter((p) => typeof p === "string"));

    default:
      throw new Error(`unknown channel "${channel}"`);
  }
}
