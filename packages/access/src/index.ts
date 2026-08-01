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
export { undo, UnknownOperationError } from "./write/undo.js";
export { writeIgnore, OPEN_BLOCK, CLOSE_BLOCK } from "./ignore.js";
export { scaffoldSkills, SKILLS_VERSION } from "./skills.js";

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
