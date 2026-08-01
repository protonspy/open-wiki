import type { PageView, ProjectInfo, WikiIndex } from "./api.js";
import { projectInfo, readPage, sources, wikiIndex } from "./api.js";
import type { RecorderSession, RecorderStatus } from "./recorder.js";
import type { ProjectChange } from "./watcher.js";
import type { SourceState } from "@open-wiki/access/read";

/**
 * The one list of things the renderer can ask for, and the only place the
 * project root is supplied (plan 8.2).
 *
 * Named as data rather than registered inline against Electron's `ipcMain`,
 * because that is what makes the surface reviewable and testable: the handlers
 * below are ordinary functions over a project root, and `index.ts` is the
 * twelve lines that bolt them to a window. Nothing here imports `electron`.
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
  /** Main → renderer, for 8.10. */
  changed: "project:changed",
} as const;

export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];

export interface Deps {
  projectRoot: string;
  /** Absent until a recording starts; 8.2 creates one per window. */
  recorder?: () => RecorderSession;
}

/**
 * The renderer's whole vocabulary. Each returns plain data — an IPC boundary
 * structured-clones what crosses it, so anything with a method on it arrives
 * as an object that has lost it.
 */
export interface DesktopApi {
  project(): ProjectInfo;
  index(): WikiIndex;
  page(slug: string): PageView;
  sources(): SourceState[];
  recordStart(title: string, dir: string): Promise<void>;
  recordPause(): Promise<void>;
  recordResume(): Promise<void>;
  recordStop(): Promise<void>;
  recordStatus(): Promise<RecorderStatus>;
}

export function createApi(deps: Deps): DesktopApi {
  const session = (): RecorderSession => {
    if (!deps.recorder) throw new Error("recording is not available in this window");
    return deps.recorder();
  };
  return {
    project: () => projectInfo(deps.projectRoot),
    index: () => wikiIndex(deps.projectRoot),
    page: (slug) => readPage(deps.projectRoot, slug),
    sources: () => sources(deps.projectRoot),
    recordStart: (title, dir) => session().start(title, dir),
    recordPause: () => session().pause(),
    recordResume: () => session().resume(),
    recordStop: () => session().stop(),
    recordStatus: () => session().status(),
  };
}

/** What the preload bridge exposes, keyed by channel. */
export type Invoker = (channel: Channel, ...args: unknown[]) => Promise<unknown>;

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
      return api.recordStart(String(args[0] ?? ""), String(args[1] ?? ""));
    case CHANNELS.recordPause:
      return api.recordPause();
    case CHANNELS.recordResume:
      return api.recordResume();
    case CHANNELS.recordStop:
      return api.recordStop();
    case CHANNELS.recordStatus:
      return api.recordStatus();
    default:
      throw new Error(`unknown channel "${channel}"`);
  }
}

export type ChangeListener = (change: ProjectChange) => void;
