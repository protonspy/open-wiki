import type { Finding, Language, Operation } from "@open-wiki/access";
import type { PageView, ProjectInfo, WikiIndex } from "../main/api.js";
import type { CreateInput, RenameResult, SaveInput, SaveResult } from "../main/edit.js";
import type { DropOutcome } from "../main/ingest.js";
import type { RecorderStatus } from "../main/recorder.js";
import type {
  CredentialCheck,
  CredentialState,
  KnownProject,
  SaveCredentialInput,
} from "../main/settings.js";
import type { SourceLocation, SourceRow } from "../main/sources.js";
import type { TranscribeOutcome } from "../main/transcribe-run.js";
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
  sources(): Promise<SourceRow[]>;
  recordStart(occasion: string): Promise<{ id: string; dir: string }>;
  recordPause(): Promise<void>;
  recordResume(): Promise<void>;
  recordStop(): Promise<void>;
  recordStatus(): Promise<RecorderStatus>;

  save(input: SaveInput): Promise<SaveResult>;
  create(input: CreateInput): Promise<SaveResult>;
  rename(from: string, to: string): Promise<RenameResult>;
  remove(slug: string): Promise<{ operationId: string }>;
  history(): Promise<Operation[]>;
  undo(id: string): Promise<void>;

  sourceDetail(id: string): Promise<SourceRow>;
  sourcesOfPage(slug: string): Promise<string[]>;
  retitle(id: string, title: string): Promise<void>;
  findings(): Promise<Finding[]>;
  locate(id: string, fragment: string): Promise<SourceLocation>;
  drop(paths: readonly string[]): Promise<DropOutcome[]>;
  credential(): Promise<CredentialState>;
  saveCredential(input: SaveCredentialInput): Promise<CredentialCheck>;
  language(): Promise<Language>;
  setLanguage(language: Language): Promise<Language>;
  knownProjects(): Promise<KnownProject[]>;
  createProject(name: string, directory: string, language: Language): Promise<KnownProject>;
  forgetProject(name: string): Promise<void>;
  transcribe(id: string): Promise<TranscribeOutcome>;

  /** 3.5 — `File.path` was removed in Electron 32; the preload knows the path. */
  pathForFile(file: File): string;

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
