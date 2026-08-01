/**
 * The project access module — one implementation imported by the application,
 * the CLI and the MCP process (plan task 9.1). It owns the project directory
 * and safe writing: scaffold, path containment, the validated store, the
 * operation log and undo, sources, and search.
 *
 * Secrets (`config/secrets`) are deliberately not re-exported here: the
 * entrypoints that run under a hook or as `ow mcp` must not read the credential
 * section (`adr:0013-the-project-directory-is-the-unit`).
 */

// Project directory and safe writing (group 2)
export { scaffold, DirectoryOccupiedError, type ScaffoldResult } from "./scaffold.js";
export { resolveReal, isWithin, assertWithin, OutsideProjectError } from "./paths.js";
export {
  settingsPath,
  readSettings,
  writeSettings,
  validateSettings,
  DEFAULT_SETTINGS,
  LANGUAGES,
  type Language,
  type ProjectSettings,
  InvalidSettingsError,
} from "./config/settings.js";
export {
  ProjectRegistry,
  UnknownNameError,
  MovedProjectError,
  InvalidNameError,
} from "./registry.js";
export {
  snapshot,
  atomicWrite,
  writePage,
  type Snapshot,
  type SnapshotPage,
} from "./write/atomic-write.js";
export {
  appendOperation,
  listOperations,
  getOperation,
  type Operation,
  type OperationPage,
  type Origin,
} from "./write/log.js";
export { undo, UnknownOperationError, CorruptOperationError } from "./write/undo.js";
export { writeIgnore, OPEN_BLOCK, CLOSE_BLOCK } from "./ignore.js";
export { scaffoldSkills, SKILLS_VERSION } from "./skills.js";
export { generateClaudeMd, writeClaudeMd } from "./claude-md.js";

// The validated store (group 5)
export {
  isEntityPage,
  readFrontmatter,
  validatePage,
  validateFrontmatter,
  NON_ENTITY_PAGES,
  type PageFrontmatter,
  type PageIssue,
  type PageValidation,
  type FrontmatterBlock,
} from "./store/page.js";
export { supersedePage, type SupersessionResult } from "./store/supersede.js";
export { resolveWikilinks } from "./store/wikilinks.js";
export { isStoreOnlyChange, pagesEqual, STORE_MANAGED_FIELDS } from "./store/staleness.js";

// The write gate (group 9)
export { gateWrite, type GateDecision, type GateInput } from "./gate/gate.js";
export { isConfigWrite, configWriteReason } from "./gate/guard.js";
export { formatDenial } from "./gate/errors.js";

// Sources (group 3)
export {
  readManifest,
  parseManifest,
  listSources,
  sourceExists,
  TakenIdError,
  MissingSourceError,
  InvalidManifestError,
  type SourceManifest,
  type SourceKind,
} from "./sources/manifest.js";
export { registerSource, type RegisterInput } from "./sources/register.js";
export { deriveId, slugify, isIdTaken, EmptyNameError } from "./sources/id.js";
export { recordingId, baseId, type RecordingIdInput } from "./sources/recording-id.js";
export {
  sourceState,
  listSourceStates,
  type SourceState,
  type SourceStage,
} from "./sources/state.js";
export { projectVocabulary, rankNames, DEFAULT_VOCABULARY_LIMIT } from "./sources/vocabulary.js";
export { transcriptionInputs, type TranscriptionInputs } from "./sources/transcription.js";
export { uploadTextSource, writeSourceText, normaliseText } from "./sources/ingest.js";
export {
  uploadPdfSource,
  extractPdfPages,
  renderPdfText,
  pageAnchor,
  type PdfPage,
} from "./sources/pdf.js";
export { uploadDocxSource, extractDocxMarkdown, htmlToMarkdown } from "./sources/docx.js";
export {
  ingestSource,
  recogniseSource,
  recognisedExtensions,
  type SourceFormat,
  type IngestOutcome,
} from "./sources/upload.js";
export {
  drainInbox,
  watchInbox,
  ensureInbox,
  inboxPath,
  listInbox,
  INBOX,
  type InboxOutcome,
  type InboxWatcher,
  type WatchInboxOptions,
} from "./sources/inbox.js";
export { resolveProvenance, extractProvenanceLinks } from "./store/provenance.js";
export { completeFrontmatter } from "./store/complete.js";
export { recordWrite, type WriteEntry, type WriteAction } from "./store/record.js";
export {
  listEntityPages,
  listPages,
  pagePath,
  isIndexed,
  findOrphans,
  readIndex,
  CODEWIKI_DIR,
  type PageRef,
} from "./store/index.js";
export { registerInIndex } from "./store/index-write.js";

// The integrity checks (group 7)
export {
  checkProject,
  checkLinks,
  checkRecords,
  checkProvenance,
  checkVocabulary,
  checkCodewiki,
  checkSchema,
  citedSourceIds,
  citedSourcePages,
  readWiki,
  type CheckReport,
  type LoadedPage,
} from "./check/checks.js";
export {
  FINDING_CODES,
  sortFindings,
  hasErrors,
  safe,
  type Finding,
  type FindingCode,
  type Severity,
} from "./check/findings.js";
