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
  parseCredentialInput,
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
  /** Injected so a test does not depend on today's date. */
  now?: () => Date;
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
  transcribe(id: string, restart?: boolean): Promise<TranscribeOutcome>;
}

export class NoProjectError extends Error {
  constructor() {
    super("this window has no project open");
    this.name = "NoProjectError";
  }
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
    history: () => history(root()),
    undo: (id) => undoOperation(root(), id),

    sourceDetail: (id) => sourceDetail(root(), id),
    sourcesOfPage: (slug) => sourcesOfPage(root(), slug),
    retitle: (id, title) => retitleSource(root(), id, title),
    findings: () => findings(root()),
    locate: (id, fragment) => locateCitation(root(), id, fragment),
    drop: (paths) => ingestDrop(root(), paths),

    credential: () => credentialState(root()),
    saveCredential: (input) => saveCredential(root(), input),
    language: () => currentLanguage(root()),
    setLanguage: (language) => setLanguage(root(), language),
    knownProjects: () => knownProjects(),
    createProject: (name, directory, language) => createProject(name, directory, language),
    forgetProject: (name) => forgetProject(name),
    transcribe: (id, restart) => runTranscription(root(), id, { restart }),
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
    case CHANNELS.saveCredential: {
      // Parsed, not cast. Every other channel coerces its arguments; this one
      // carries the shape that decides what is written into the secrets file.
      const input = parseCredentialInput(args[0]);
      if (!input) throw new Error("that is not a transcription provider");
      return api.saveCredential(input);
    }
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
      return api.transcribe(String(args[0] ?? ""), args[1] === true);

    case CHANNELS.drop:
      // The renderer hands over paths Chromium gave it for a drop. Anything
      // that is not a string is not a path.
      return api.drop((Array.isArray(args[0]) ? args[0] : []).filter((p) => typeof p === "string"));

    default:
      throw new Error(`unknown channel "${channel}"`);
  }
}
