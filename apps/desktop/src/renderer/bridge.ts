import type {
  ExportResult,
  Finding,
  Language,
  Operation,
  ProjectSettings,
} from "@open-wiki/access";
import type { ExportOutcome } from "../main/export.js";
import type { PageView, ProjectInfo, WikiIndex } from "../main/api.js";
import type {
  CreateInput,
  CopyResult,
  IndexResult,
  RenameResult,
  SaveInput,
  ReplaceResult,
  SaveResult,
} from "../main/edit.js";
import type { DropOutcome } from "../main/ingest.js";
import type { RecorderStatus } from "../main/recorder.js";
import type {
  CredentialCheck,
  CredentialState,
  KnownProject,
  SaveCredentialInput,
  SettingsView,
} from "../main/settings.js";
import type { PageSource, SourceBrowse, SourceLocation, SourceRow } from "../main/sources.js";
import type { TranscribeOutcome } from "../main/transcribe-run.js";
import type {
  ChatCancelInput,
  ChatEvent,
  ChatResumeInput,
  ChatRunStarted,
  ChatSendInput,
} from "../main/agent/chat-events.js";
import type { AgentPrefs } from "../main/agent/agent-prefs.js";
import type { ProjectChange } from "../shared/changes.js";

/**
 * What the preload put on `window`, typed (plan 8.2).
 *
 * The types come from the main process's own modules, so the two sides of the
 * bridge cannot drift: renaming a field in `api.ts` fails the renderer's
 * typecheck rather than producing `undefined` on a screen.
 */
export interface OwBridge {
  project(): Promise<ProjectInfo | null>;
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
  /** 5.3 — the one-click fix for 7.1's `page.orphan`. */
  addToIndex(slug: string): Promise<IndexResult>;
  /** 6.4 — the third answer to 8.8: keep both, and name the copy. */
  saveAsCopy(slug: string, markdown: string): Promise<CopyResult>;
  history(): Promise<Operation[]>;
  undo(id: string): Promise<void>;

  sourceDetail(id: string): Promise<SourceRow>;
  sourcesOfPage(slug: string): Promise<PageSource[]>;
  retitle(id: string, title: string): Promise<void>;
  /** Declare a source read by hand, or withdraw it (plan 7.1). */
  markSource(id: string, processed: boolean): Promise<void>;
  /** Rewrite an avoided synonym as the project's term (desktop-ui 5.6). */
  replaceWord(page: string, avoid: string, use: string): Promise<ReplaceResult>;
  /** The files a source holds, an unpacked archive as a tree (plan 7.5). */
  browseSource(id: string): Promise<SourceBrowse>;
  /** Show a source's file in the system file manager (plan 7.4). */
  revealSource(id: string): Promise<void>;
  findings(): Promise<Finding[]>;
  locate(id: string, fragment: string): Promise<SourceLocation>;
  /** 5.5 — the peaks the provenance transport draws, or null when there is no audio. */
  waveform(id: string): Promise<number[] | null>;
  drop(paths: readonly string[]): Promise<DropOutcome[]>;
  /** 3.7 — what is sitting in the doorway, and taking it when asked. */
  inboxWaiting(): Promise<string[]>;
  inboxDrain(): Promise<DropOutcome[]>;
  credential(): Promise<CredentialState>;
  saveCredential(input: SaveCredentialInput): Promise<CredentialCheck>;
  /** The agent's model list + current selection (specs/embedded-agent, R2.5). */
  agentModels(): Promise<AgentPrefs>;
  /** Record the user's model pick; refuses a model the list never offered. */
  selectModel(model: string): Promise<AgentPrefs>;
  language(): Promise<Language>;
  setLanguage(language: Language): Promise<Language>;
  /** 6.1 — the values, and the two files they live in. Never the key. */
  settingsView(): Promise<SettingsView>;
  setDeleteWav(on: boolean): Promise<ProjectSettings>;
  knownProjects(): Promise<KnownProject[]>;
  createProject(name: string, directory: string, language: Language): Promise<KnownProject>;
  forgetProject(name: string): Promise<void>;
  /** 6.3 — open a window on a known project, by name. */
  openProject(name: string): Promise<void>;
  /** 6.3 — the first run configures the project it just made. */
  saveCredentialFor(name: string, input: SaveCredentialInput): Promise<CredentialCheck>;
  transcribe(id: string, restart?: boolean): Promise<TranscribeOutcome>;

  /** `specs/wiki-export` — what an export would carry, and the export itself. */
  exportSurvey(): Promise<ExportResult>;
  exportRun(): Promise<ExportOutcome>;

  /** The embedded agent — drive a run (specs/embedded-agent, R1.2, R5.2–R5.5). */
  chatSend(input: ChatSendInput): Promise<ChatRunStarted>;
  chatResume(input: ChatResumeInput): Promise<ChatRunStarted>;
  chatCancel(input: ChatCancelInput): Promise<void>;

  /** 3.5 — `File.path` was removed in Electron 32; the preload knows the path. */
  pathForFile(file: File): string;

  onChanged(handler: (change: ProjectChange) => void): () => void;

  /** 3.7 — a file that arrived through `raw/_inbox/`, reported as a drop is. */
  onInbox(handler: (outcome: DropOutcome) => void): () => void;

  /** The agent's stream — one {@link ChatEvent} per push (specs/embedded-agent). */
  onChatEvent(handler: (event: ChatEvent) => void): () => void;
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
