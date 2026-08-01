import { relative, resolve } from "node:path";

/**
 * The write gate's own configuration is inside the project, so a write path
 * that reaches it edits away its own restraint through a change that reads as
 * documentation in review (plan 9.6). The hook refuses an agent-mediated write
 * that lands in `.claude/`, `.mcp.json` or `CLAUDE.md` before it lands.
 *
 * Path confinement (plan 2.6) is the write path's job, done with real-path
 * resolution so a junction cannot escape the project. It is the first act of
 * `gateWrite`, which calls `assertWithin` before this guard runs — so anything
 * that resolves outside the project is already refused, and `gateWrite` hands
 * this guard the *resolved* path — so a junction cannot present `.claude/` as a
 * wiki page. Plain `resolve`/`relative` is enough here as a result; the actual
 * write still goes through `assertWithin`.
 *
 * The comparison folds case. Windows is case-insensitive by default and is the
 * only platform the product supports, so `claude.md`, `.MCP.JSON` and
 * `.CLAUDE/hooks.js` name the very files this refuses; matching the literal
 * casing would leave the guard to be stepped around with the shift key.
 */
export function isConfigWrite(filePath: string, projectRoot: string): boolean {
  const root = resolve(projectRoot);
  const target = resolve(projectRoot, filePath);
  const rel = relative(root, target);
  if (rel === "" || rel.startsWith("..")) return false; // outside or the root itself
  const posix = rel.replace(/\\/g, "/").toLowerCase();
  if (posix === "claude.md" || posix === ".mcp.json") return true;
  if (posix === ".claude" || posix.startsWith(".claude/")) return true;
  return false;
}

/** The reason the hook gives the agent when it refuses a config write (9.6/9.13). */
export function configWriteReason(filePath: string): string {
  return `open-wiki refuses writes to its own configuration (${filePath}). The gate, .mcp.json and CLAUDE.md are not editable through the agent.`;
}
