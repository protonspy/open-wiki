import { relative, resolve } from "node:path";

/**
 * The write gate's own configuration is inside the project, so a write path
 * that reaches it edits away its own restraint through a change that reads as
 * documentation in review (plan 9.6). The hook refuses an agent-mediated write
 * that lands in `.claude/`, `.mcp.json` or `CLAUDE.md` before it lands.
 *
 * Path confinement (plan 2.6) is the write path's job, done with real-path
 * resolution so a junction cannot escape the project. This guard is a pre-check
 * that classifies a project-relative path, so plain `resolve`/`relative` is
 * enough here — the actual write still goes through `assertWithin`.
 */
export function isConfigWrite(filePath: string, projectRoot: string): boolean {
  const root = resolve(projectRoot);
  const target = resolve(projectRoot, filePath);
  const rel = relative(root, target);
  if (rel === "" || rel.startsWith("..")) return false; // outside or the root itself
  const posix = rel.replace(/\\/g, "/");
  if (posix === "CLAUDE.md" || posix === ".mcp.json") return true;
  if (posix === ".claude" || posix.startsWith(".claude/")) return true;
  return false;
}

/** The reason the hook gives the agent when it refuses a config write (9.6/9.13). */
export function configWriteReason(filePath: string): string {
  return `open-wiki refuses writes to its own configuration (${filePath}). The gate, .mcp.json and CLAUDE.md are not editable through the agent.`;
}