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
export { listEntityPages, isIndexed, findOrphans, readIndex } from "./store/index.js";
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
  listSources,
  sourceExists,
  MissingSourceError,
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