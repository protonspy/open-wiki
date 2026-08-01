import { readFileSync } from "node:fs";
import { runPostToolUse, runPreToolUse, type PreToolUseInput, type PostToolUseInput } from "../hooks.js";
import { today } from "../date.js";

function readStdin(): string {
  return readFileSync(0, "utf8");
}

/**
 * The gate as a function of its payload: what `ow gate pre|post` would print on
 * stdout, or `null` for nothing to print. Kept separate from `runGateCommand`
 * so the hook contract is testable without a real stdin — the payload is the
 * only input the handlers have.
 *
 * The project root is the hook's `cwd`, which Claude Code sets to the project
 * directory; `fallbackCwd` covers a payload that omits it.
 */
export function gateOutput(
  kind: "pre" | "post",
  raw: string,
  fallbackCwd: string,
  date: string,
): string | null {
  let payload: Record<string, unknown> = {};
  if (raw.trim() !== "") {
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // A hook that cannot read its input cannot gate safely; pass through.
      return null;
    }
  }

  const projectRoot = typeof payload["cwd"] === "string" ? payload["cwd"] : fallbackCwd;

  if (kind === "pre") {
    const out = runPreToolUse(payload as unknown as PreToolUseInput, projectRoot, date);
    return out ? JSON.stringify(out) : null;
  }
  runPostToolUse(payload as unknown as PostToolUseInput, projectRoot, date);
  return null;
}

/**
 * `ow gate pre|post` — the hook handlers Claude Code invokes. They read the
 * hook payload from stdin, run the gate, and print the JSON the contract
 * expects on stdout (PreToolUse) or record silently (PostToolUse).
 */
export function runGateCommand(kind: "pre" | "post"): number {
  const out = gateOutput(kind, readStdin(), process.cwd(), today());
  if (out) process.stdout.write(out);
  return 0;
}
