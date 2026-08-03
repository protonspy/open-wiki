/**
 * The read-only surface (plan 9.9). The MCP entrypoint imports only from here,
 * so read-only is what the process **can** do, not what it agrees to do. The
 * wiki write path — the gate, the atomic write, the operation log's append, the
 * wiki log/changelog/index writes, supersession, completion, source
 * registration, scaffolding, the ignore entries — is deliberately absent from
 * this barrel's graph.
 *
 * The registry and the project settings are not the wiki write path: resolving a
 * project *name* to a path reads the application cache, and reading the
 * settings reads `ow.json`. Neither writes a page, so both belong here.
 */
export { resolveReal, isWithin, assertWithin, OutsideProjectError } from "./paths.js";
// Pure string arithmetic with no filesystem in it, so it belongs in this barrel
// on the same terms the settings do — and it is needed here because the MCP
// process serves the same manifest text `ow source list` does, to the same kind
// of reader.
export { boundedText, MAX_LISTED } from "./format.js";
// Resolving an id to where the source actually sits (task 8.3). Reads only, and
// the MCP process needs it: joining `raw/<id>` there while `readManifest` walked
// meant the two answered about two different directories for one id.
export { listSourceRefs, duplicateSourceIds, type SourceRef } from "./sources/locate.js";
export { sourceDir, requireSourceDir, resolvedSourceDir } from "./sources/manifest.js";
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
// The checks read only; the MCP process may run them.
export {
  checkProject,
  readWiki,
  citedSourcePages,
  type CheckReport,
  type LoadedPage,
} from "./check/checks.js";
export {
  sourceState,
  listSourceStates,
  type SourceState,
  type SourceStage,
} from "./sources/state.js";
export {
  FINDING_CODES,
  sortFindings,
  hasErrors,
  safe,
  type Finding,
  type FindingCode,
  type Severity,
} from "./check/findings.js";
export {
  readFrontmatter,
  validatePage,
  validateFrontmatter,
  NON_ENTITY_PAGES,
  isEntityPage,
  type PageFrontmatter,
  type PageIssue,
  type PageValidation,
} from "./store/page.js";
export { resolveWikilinks } from "./store/wikilinks.js";
export { resolveProvenance, extractProvenanceLinks } from "./store/provenance.js";
export { isStoreOnlyChange, pagesEqual, STORE_MANAGED_FIELDS } from "./store/staleness.js";
export {
  readManifest,
  readManifestAt,
  parseManifest,
  boundedManifest,
  listSources,
  sourceExists,
  MissingSourceError,
  InvalidManifestError,
  type SourceManifest,
  type SourceKind,
} from "./sources/manifest.js";
export {
  readSettings,
  settingsPath,
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
