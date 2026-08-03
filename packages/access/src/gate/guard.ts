import { relative, resolve } from "node:path";
import { HARNESSES, managedPaths, profileFor } from "../harness.js";

/**
 * The write gate's own configuration is inside the project, so a write path
 * that reaches it edits away its own restraint through a change that reads as
 * documentation in review (plan 9.6). The hook refuses an agent-mediated write
 * that lands on any harness's convention or configuration before it lands —
 * `.claude/`, `.mcp.json` and `CLAUDE.md`, and equally `AGENTS.md`, `.codex/`
 * and `.opencode/` (`adr:0024`, and this plan's task 3.3 brought forward
 * because group 2 is what made those paths real).
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
  return GUARDED.some((p) => posix === p || posix.startsWith(`${p}/`));
}

/**
 * Every path this product manages, for every harness — not only the one whose
 * gate happens to be running.
 *
 * **The refusal is cross-harness or it is not a refusal.** A project scaffolded
 * for Claude Code *and* Codex has Claude's `PreToolUse` hook installed and
 * Codex's not (that is 3.1). If this guard knew only `.claude/`, an agent
 * running under the gate could rewrite `AGENTS.md` or `.codex/skills/wiki/SKILL.md`
 * — files a *sibling* harness loads next session as trusted instructions — and
 * the gate would answer "allow". The convention text is instructions to an
 * agent, so editing it is editing what the next agent believes, and the fact
 * that a different harness reads it does not make it someone else's problem.
 *
 * Derived from the profiles rather than listed here, so a harness added to
 * `harness.ts` is guarded by the act of adding it. That is why `managedPaths`
 * exists: a second list would be the one that goes stale, and it would go stale
 * silently in the direction of permitting more.
 *
 * Guarded for **every** harness rather than only the ones this project records,
 * because `ow.json` is itself a committed file: a project that quietly dropped
 * `codex` from its list would otherwise unlock `.codex/` for the write path.
 */
const GUARDED: readonly string[] = [
  ...new Set(
    HARNESSES.flatMap((h) => managedPaths(profileFor(h)))
      .map((p) => p.replace(/\\/g, "/").toLowerCase())
      // **The whole dot-directory, not only the files this product writes in
      // it.** Deriving the list from `managedPaths` alone would have *narrowed*
      // the guard: `.claude/settings.json` and `.claude/skills` are named, but
      // `.claude/settings.local.json`, `.claude/agents/` and anything else the
      // harness reads from there are not — and every one of them changes what
      // the agent may do. The old guard covered `.claude/` entirely and that
      // was right; widening to three harnesses must not quietly trade coverage
      // for tidiness.
      .flatMap((p) => (p.startsWith(".") && p.includes("/") ? [p, p.split("/")[0]!] : [p])),
  ),
];

/** The reason the hook gives the agent when it refuses a config write (9.6/9.13). */
export function configWriteReason(filePath: string): string {
  return `open-wiki refuses writes to its own configuration (${filePath}). The gate, the MCP configuration, the entry file and the scaffolded skills are not editable through the agent — for any harness this project carries, not only the one you are running under.`;
}
