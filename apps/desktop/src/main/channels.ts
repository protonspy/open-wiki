/**
 * The IPC channel names, and nothing else (plan 8.2).
 *
 * Its own module because **the preload imports it**. A sandboxed preload that
 * reached this through `ipc.ts` pulled the whole main-process graph in behind
 * it — the store, the audio package, ffmpeg's resolver — which made the
 * preload bundle 273 KB of code that cannot run in a preload and produced an
 * `import.meta` warning from the bundler that would hide a real one.
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
  recordDevices: "record:devices",

  // Editing (8.7, 8.8, 8.9) and the history behind it (8.11).
  save: "wiki:save",
  create: "wiki:create",
  rename: "wiki:rename",
  remove: "wiki:delete",
  addToIndex: "wiki:add-to-index",
  saveAsCopy: "wiki:save-as-copy",
  waveform: "sources:waveform",
  history: "history:list",
  undo: "history:undo",

  // Sources (6.2 to 6.7), the checks (7.6), and what a citation opens (8.6).
  sourceDetail: "sources:detail",
  sourcesOfPage: "sources:of-page",
  retitle: "sources:retitle",
  /** Declaring a source read by hand, and browsing into one (7.1, 7.5). */
  markSource: "sources:mark",
  browseSource: "sources:browse",
  /** Show a source's file in the system file manager (7.4). */
  revealSource: "sources:reveal",
  findings: "check:findings",
  /** Rewriting an avoided synonym as the project's term (desktop-ui 5.6). */
  replaceWord: "check:replace",
  locate: "sources:locate",
  drop: "sources:drop",
  /** What is sitting in `raw/_inbox/` (3.7), and taking it when asked. */
  inboxWaiting: "sources:inbox-waiting",
  inboxDrain: "sources:inbox-drain",

  // The credential (8.3), the launcher (8.4), the content language (8.12) and
  // the run 6.3 starts.
  credential: "settings:credential",
  saveCredential: "settings:save-credential",
  /** The agent's model list + current selection (specs/embedded-agent, R2.5). */
  agentModels: "settings:agent-models",
  selectModel: "settings:select-model",
  language: "settings:language",
  setLanguage: "settings:set-language",
  settingsView: "settings:view",
  setDeleteWav: "settings:delete-wav",
  knownProjects: "launcher:projects",
  createProject: "launcher:create",
  forgetProject: "launcher:forget",
  openProject: "launcher:open",
  saveCredentialFor: "launcher:credential",
  transcribe: "sources:transcribe",

  /** Taking the project away as one zip (`specs/wiki-export`, R4.3). */
  exportSurvey: "export:survey",
  exportRun: "export:run",

  // The embedded agent (specs/embedded-agent): the renderer drives a run and
  // receives its stream over the push channel — the model and the credential
  // stay in the main process (R2.1, R2.7).
  chatSend: "chat:send",
  chatResume: "chat:resume",
  chatCancel: "chat:cancel",

  /** Main → renderer, for 8.10. */
  changed: "project:changed",
  /** Main → renderer, for the inbox doorway of 3.7. */
  inbox: "sources:inbox",
  /** Main → renderer — the agent's stream (token/tool/interrupt/done/error). */
  chatEvent: "chat:event",
} as const;

export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];

/**
 * The channels the main process pushes on, which therefore take no handler.
 *
 * Named as a set rather than checked one by one in `index.ts`: registering an
 * `ipcMain.handle` for a push channel is harmless until the day something
 * invokes it, and then it is a handler nobody wrote answering `undefined`.
 */
export const PUSH_CHANNELS: ReadonlySet<string> = new Set<string>([
  CHANNELS.changed,
  CHANNELS.inbox,
  CHANNELS.chatEvent,
]);
