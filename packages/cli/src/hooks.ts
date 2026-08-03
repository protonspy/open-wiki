import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import {
  appendOperation,
  configWriteReason,
  formatDenial,
  OutsideProjectError,
  assertWithin,
  gateWrite,
  gatedPageRel,
  resolveReal,
  isConfigWrite,
  looksLikePatch,
  pagesEqual,
  patchPaths,
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
// `wiki/` only, which covers `wiki/codewiki/`. A top-level `codewiki/` used to
// be listed here as well, and once the gate stopped treating it as part of the
// wiki (adr:0016) the two doors disagreed: this one flagged a shell write there
// and handed it to a gate that then said "allow".
const SHELL_WRITE_TARGETS: ReadonlyArray<RegExp> = [
  />>?\s*(wiki\/[^\s;|&<>]*\.md)/,
  /\btee\s+(?:-\S+\s+)*(wiki\/[^\s;|&<>]*\.md)/,
  /\b(?:cp|mv|install)\s+(?:-\S+\s+)*\S+\s+(wiki\/[^\s;|&<>]*\.md)/,
  /\bsed\s+-i\b[^|&]*?\s(wiki\/[^\s;|&<>]*\.md)/,
];

export function detectShellWrite(command: string, _projectRoot: string): string | null {
  // Normalise backslashes to forward slashes first: the targets anchor on
  // `wiki/`, and on Windows a shell write may use `wiki\fenix.md`.
  const posix = command.replace(/\\/g, "/");
  for (const re of SHELL_WRITE_TARGETS) {
    const m = re.exec(posix);
    if (m && m[1]) return m[1];
  }
  return null;
}

/** A denial, in the one envelope both Claude Code and Codex read. */
function deny(reason: string): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

/**
 * Codex's `apply_patch`, which is how Codex edits a file (3.1).
 *
 * **This gate refuses; it does not complete.** Under Claude Code the hook
 * receives the whole `content` and answers `updatedInput` with the frontmatter
 * the store owns filled in, so a page lands valid. A patch carries neither:
 * `tool_input` is `{ command: <patch text> }`, and reconstructing the resulting
 * file would mean applying the patch here — then handing back a *rewritten
 * patch* whose context lines no longer match what the agent computed them
 * against. That is a machine for producing patches that fail to apply, and it
 * would fail *after* the gate said allow.
 *
 * So the honest Codex regime is: **the gate stops a bad page landing, and
 * `ow write` is how a good one lands.** That is not a lesser gate — nothing
 * unvalidated reaches `wiki/` either way — it is a different workflow, and the
 * generated `AGENTS.md` says so rather than leaving a Codex user to discover it
 * from a refusal.
 *
 * A patch this cannot parse is refused too. An unreadable patch is *unknown*,
 * never "touches nothing", and a guard that fails open on malformed input is
 * one that is stepped around with malformed input.
 */
function preApplyPatch(
  tool_input: Record<string, unknown>,
  projectRoot: string,
): HookOutput | null {
  const command = typeof tool_input["command"] === "string" ? tool_input["command"] : "";
  if (!command) return null;

  if (!looksLikePatch(command)) {
    // Not the envelope Codex documents. Refusing on the guess that it might
    // still be a patch would deny every unrelated custom tool call; letting it
    // through is what the shape says it is.
    return null;
  }

  const paths = patchPaths(command);
  if (paths.length === 0) {
    return deny(
      "open-wiki: this patch could not be read, so what it would touch is unknown. " +
        "Write pages with `ow write <path> --file <file>`, which validates them.",
    );
  }

  // **Resolve before classifying, exactly as `gateWrite` does.** A path is not
  // a string: `src/../wiki/evil.md` does not start with `wiki/` and lands in it
  // anyway, and a first version of this arm classified the raw parser output
  // with a `startsWith` of its own. A security review wrote the patch that
  // walked straight through it.
  //
  // So this reuses the audited pair rather than reimplementing them —
  // `assertWithin` for confinement and real-path resolution, `gatedPageRel` for
  // what counts as a page — and its answers are the same ones the `Write`/`Edit`
  // arm gives. Two classifiers for one question is how they come to disagree.
  const realRoot = resolveReal(projectRoot);
  const pages: string[] = [];
  for (const raw of paths) {
    let landsAt: string;
    try {
      landsAt = assertWithin(projectRoot, resolve(projectRoot, raw));
    } catch (e) {
      // `allow` is "no opinion", never "write anywhere" — `gateWrite`'s own
      // rule, and a patch escaping the project is the case it was written for.
      if (e instanceof OutsideProjectError) return deny(e.message);
      throw e;
    }
    // The gate's own configuration first, for every harness (`adr:0013`, 3.3).
    // A patch that edits away the gate reads as documentation in review.
    if (isConfigWrite(landsAt, realRoot)) return deny(configWriteReason(raw));
    if (gatedPageRel(projectRoot, landsAt)) pages.push(raw);
  }

  if (pages.length === 0) return null;

  return deny(
    `open-wiki: ${pages.join(", ")} ${pages.length === 1 ? "is a wiki page" : "are wiki pages"}, ` +
      "and a patch carries no content this gate can validate or complete. " +
      "Write it with `ow write <path> --file <file>` — the store checks the schema and fills " +
      "the fields it owns. This is the documented path under every harness.",
  );
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

  // Codex edits files with `apply_patch`, whose hook input is command-shaped:
  // `{ command: "<the raw patch text>" }`. There is no `file_path` to read and
  // no resulting content to validate, so this arm answers on paths alone.
  if (tool_name === "apply_patch") return preApplyPatch(tool_input, projectRoot);

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

export function runPostToolUse(input: PostToolUseInput, projectRoot: string, date: string): null {
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
