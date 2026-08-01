import type { PageView, ProjectInfo, WikiIndex } from "../main/api.js";
import type { RecorderStatus } from "../main/recorder.js";
import type { ProjectChange } from "../main/watcher.js";

/**
 * What the preload put on `window`, typed (plan 8.2).
 *
 * The types come from the main process's own modules, so the two sides of the
 * bridge cannot drift: renaming a field in `api.ts` fails the renderer's
 * typecheck rather than producing `undefined` on a screen.
 */
export interface OwBridge {
  project(): Promise<ProjectInfo>;
  index(): Promise<WikiIndex>;
  page(slug: string): Promise<PageView>;
  sources(): Promise<unknown[]>;
  recordStart(occasion: string): Promise<{ id: string; dir: string }>;
  recordPause(): Promise<void>;
  recordResume(): Promise<void>;
  recordStop(): Promise<void>;
  recordStatus(): Promise<RecorderStatus>;
  onChanged(handler: (change: ProjectChange) => void): () => void;
}

declare global {
  interface Window {
    ow?: OwBridge;
  }
}

export class NoBridgeError extends Error {
  constructor() {
    super("this page is not running inside the application");
    this.name = "NoBridgeError";
  }
}

/**
 * The bridge, or a clear failure.
 *
 * Opening the built page in a plain browser is a thing that happens while
 * iterating, and "cannot read properties of undefined" is a worse answer than
 * saying which half is missing.
 */
export function bridge(): OwBridge {
  const ow = globalThis.window?.ow;
  if (!ow) throw new NoBridgeError();
  return ow;
}

export function hasBridge(): boolean {
  return Boolean(globalThis.window?.ow);
}
