import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import {
  appendOperation,
  formatDenial,
  gateWrite,
  pagesEqual,
  readFrontmatter,
  recordWrite,
  registerInIndex,
  snapshot,
} from "@open-wiki/access";

/**
 * The write gate as Claude Code hooks (plan 9.5). A `PreToolUse` hook receives
 * the tool's complete `tool_input` and answers `permissionDecision: deny` with
 * a reason the agent reads, or `updatedInput` to replace the arguments before
 * the tool runs — so a wiki write is refused before it lands, and completed
 * (frontmatter filled) before it lands too. `PostToolUse` is where the log,
 * the changelog and the index go, because those describe a write that has
 * actually happened.
 *
 * The hook contract was read from the reference (`claude-code-plugins.md` and
 * the hooks doc), not inferred: `updatedInput` replaces the arguments, and
 * `PostToolUse` has no `permissionDecision`. A shell write (Bash) carries no
 * page content to inspect, so it gets its own answer: detect a redirection or
 * `cp`/`mv`/`tee`/`sed -i` into `wiki/` or `codewiki/` and deny it, pointing at
 * the wiki skill — the heuristic the gate can make; group 7 is the net for
 * what slips through.
 */

export interface PreToolUseInput {
  hook_event_name: string;
  tool_name: string;
  cwd: string;
  tool_use_id: string;
  tool_input: Record<string, unknown>;
}

export interface PostToolUseInput extends PreToolUseInput {
  tool_response?: Record<string, unknown>;
}

export interface HookOutput {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: "allow" | "deny";
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
  };
}

const PENDING_DIR = join(".state", "pending");

interface Sidecar {
  slug: string;
  rel: string;
  existed: boolean;
  snapshotId: string;
  title?: string;
}

function relOf(projectRoot: string, filePath: string): string {
  return relative(resolve(projectRoot), resolve(projectRoot, filePath)).replace(/\\/g, "/");
}

function sidecarPath(projectRoot: string, toolUseId: string): string {
  return join(projectRoot, PENDING_DIR, `${toolUseId}.json`);
}

function writeSidecar(projectRoot: string, toolUseId: string, s: Sidecar): void {
  const file = sidecarPath(projectRoot, toolUseId);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(s), "utf8");
}

function readSidecar(projectRoot: string, toolUseId: string): Sidecar | null {
  const file = sidecarPath(projectRoot, toolUseId);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as Sidecar;
}

function deleteSidecar(projectRoot: string, toolUseId: string): void {
  const file = sidecarPath(projectRoot, toolUseId);
  if (existsSync(file)) rmSync(file, { force: true });
}

function titleOf(markdown: string): string | undefined {
  const block = readFrontmatter(markdown);
  if (
    block &&
    block.parsed &&
    block.frontmatter &&
    typeof block.frontmatter === "object" &&
    !Array.isArray(block.frontmatter)
  ) {
    const fm = block.frontmatter as Record<string, unknown>;
    return typeof fm["title"] === "string" ? fm["title"] : undefined;
  }
  return undefined;
}

/** A shell command that writes a wiki/codewiki page, and the path it targets. */
const SHELL_WRITE_TARGETS: ReadonlyArray<RegExp> = [
  />>?\s*((?:wiki|codewiki)\/[^\s;|&<>]*\.md)/,
  /\btee\s+(?:-\S+\s+)*((?:wiki|codewiki)\/[^\s;|&<>]*\.md)/,
  /\b(?:cp|mv|install)\s+(?:-\S+\s+)*\S+\s+((?:wiki|codewiki)\/[^\s;|&<>]*\.md)/,
  /\bsed\s+-i\b[^|&]*?\s((?:wiki|codewiki)\/[^\s;|&<>]*\.md)/,
];

export function detectShellWrite(command: string, _projectRoot: string): string | null {
  for (const re of SHELL_WRITE_TARGETS) {
    const m = re.exec(command);
    if (m && m[1]) return m[1];
  }
  return null;
}

export function runPreToolUse(
  input: PreToolUseInput,
  projectRoot: string,
  date: string,
): HookOutput | null {
  const { tool_name, tool_input, tool_use_id } = input;

  if (tool_name === "Bash") {
    const command = typeof tool_input["command"] === "string" ? tool_input["command"] : "";
    const target = detectShellWrite(command, projectRoot);
    if (target) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `open-wiki: write ${target} through the wiki skill, not the shell. The store validates and completes pages; a shell write bypasses it.`,
        },
      };
    }
    return null;
  }

  if (tool_name !== "Write" && tool_name !== "Edit") return null;

  const file_path = typeof tool_input["file_path"] === "string" ? tool_input["file_path"] : "";
  if (!file_path) return null;
  const rel = relOf(projectRoot, file_path);

  let wouldBeContent: string;
  let currentContent: string | null = null;
  if (tool_name === "Write") {
    wouldBeContent = typeof tool_input["content"] === "string" ? tool_input["content"] : "";
  } else {
    const abs = resolve(projectRoot, file_path);
    if (!existsSync(abs)) return null; // let the Edit fail on its own
    currentContent = readFileSync(abs, "utf8");
    const oldStr = typeof tool_input["old_string"] === "string" ? tool_input["old_string"] : "";
    const newStr = typeof tool_input["new_string"] === "string" ? tool_input["new_string"] : "";
    const idx = currentContent.indexOf(oldStr);
    if (idx < 0) return null; // old_string not found: let the Edit fail
    wouldBeContent =
      currentContent.slice(0, idx) + newStr + currentContent.slice(idx + oldStr.length);
  }

  const decision = gateWrite({ projectRoot, filePath: file_path, content: wouldBeContent, date });

  if (decision.action === "allow") return null;

  if (decision.action === "deny") {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: formatDenial(rel, decision.reasons),
      },
    };
  }

  // accept: snapshot for undo, and leave a note for PostToolUse to record.
  const snap = snapshot(projectRoot, [rel]);
  const existed = snap.pages[0]?.existed ?? false;
  const slug = basename(rel, ".md");
  writeSidecar(projectRoot, tool_use_id, {
    slug,
    rel,
    existed,
    snapshotId: snap.id,
    title: titleOf(decision.content),
  });

  // Completion changed nothing semantic: let the writer's content land as-is.
  if (pagesEqual(wouldBeContent, decision.content)) {
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } };
  }

  let updatedInput: Record<string, unknown>;
  if (tool_name === "Write") {
    updatedInput = { file_path, content: decision.content };
  } else {
    // Edit: replace the whole file with the completed content, so the
    // frontmatter the store filled lands exactly.
    updatedInput = { file_path, old_string: currentContent ?? "", new_string: decision.content };
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput,
    },
  };
}

export function runPostToolUse(
  input: PostToolUseInput,
  projectRoot: string,
  date: string,
): null {
  if (input.tool_name !== "Write" && input.tool_name !== "Edit") return null;

  const s = readSidecar(projectRoot, input.tool_use_id);
  if (!s) return null; // a non-gated write, or one PreToolUse did not accept

  appendOperation(projectRoot, {
    id: s.snapshotId,
    origin: "hook",
    pages: [{ path: s.rel, existed: s.existed }],
    snapshotId: s.snapshotId,
  });
  recordWrite(projectRoot, {
    slug: s.slug,
    action: s.existed ? "modified" : "created",
    origin: "hook",
    date,
  });
  registerInIndex(projectRoot, s.slug, s.title);
  deleteSidecar(projectRoot, input.tool_use_id);
  return null;
}