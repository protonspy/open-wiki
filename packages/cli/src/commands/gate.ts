import { readFileSync } from "node:fs";
import { runPostToolUse, runPreToolUse, type PreToolUseInput, type PostToolUseInput } from "../hooks.js";

function readStdin(): string {
  return readFileSync(0, "utf8");
}

/**
 * `ow gate pre|post` — the hook handlers Claude Code invokes. They read the
 * hook payload from stdin, run the gate, and print the JSON the contract
 * expects on stdout (PreToolUse) or record silently (PostToolUse). The project
 * root is the hook's `cwd`, which Claude Code sets to the project directory.
 */
export async function runGateCommand(kind: "pre" | "post"): Promise<number> {
  const raw = readStdin();
  let payload: Record<string, unknown> = {};
  if (raw.trim() !== "") {
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // A hook that cannot read its input cannot gate safely; pass through.
      return 0;
    }
  }

  const projectRoot = typeof payload["cwd"] === "string" ? payload["cwd"] : process.cwd();
  const date = today();

  if (kind === "pre") {
    const out = runPreToolUse(payload as unknown as PreToolUseInput, projectRoot, date);
    if (out) process.stdout.write(JSON.stringify(out));
    return 0;
  }
  runPostToolUse(payload as unknown as PostToolUseInput, projectRoot, date);
  return 0;
}

function today(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}