import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HOOKS_FILE = join(".claude", "hooks", "hooks.json");

/** The hooks the gate installs: pre validates/completes (and blocks shell writes), post records. */
const OW_HOOKS = {
  pre: "ow gate pre",
  post: "ow gate post",
};

/**
 * Which tools each hook matches.
 *
 * Exported because `plugins/open-wiki/hooks/hooks.json` has to say the same
 * thing, and there is no mechanism that makes two JSON files agree. A user who
 * installs the plugin instead of running `ow init` gets whatever that file
 * says, and the two drifted the first time they were written: the plugin
 * dropped `Bash` — the matcher whose whole purpose is shell writes — and added
 * `MultiEdit`, which this one did not have. `packages/cli/tests/release.spec.ts`
 * asserts they match.
 */
export const HOOK_MATCHERS = {
  // `Bash` is here because a page written through a shell command arrives as a
  // command string with no page content to inspect, and denying `Edit(wiki/**)`
  // does not constrain `Bash` — permission rules are per tool.
  pre: "Write|Edit|MultiEdit|Bash",
  // Post records a write that has actually happened, and a `Bash` write is one
  // this gate never saw the content of.
  post: "Write|Edit|MultiEdit",
} as const;

interface HookEntry {
  matcher: string;
  hooks: Array<{ type: string; command: string }>;
}

interface HooksJson {
  hooks?: {
    PreToolUse?: HookEntry[];
    PostToolUse?: HookEntry[];
  };
}

/**
 * Write the gate's hooks, merging with anything already there so a project's
 * own hooks survive (plan 9.5). Our entries are keyed by the \`ow gate\` command,
 * so re-running \`ow init\` refreshes them without duplicating or dropping
 * unrelated hooks.
 */
export function writeHooks(projectRoot: string): { written: string } {
  const file = join(projectRoot, HOOKS_FILE);
  let doc: HooksJson = {};
  if (existsSync(file)) {
    try {
      doc = JSON.parse(readFileSync(file, "utf8")) as HooksJson;
    } catch {
      doc = {};
    }
  }
  doc.hooks ??= {};

  doc.hooks.PreToolUse = upsertEntry(doc.hooks.PreToolUse, HOOK_MATCHERS.pre, OW_HOOKS.pre);
  doc.hooks.PostToolUse = upsertEntry(doc.hooks.PostToolUse, HOOK_MATCHERS.post, OW_HOOKS.post);

  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(doc, null, 2) + "\n", "utf8");
  return { written: file };
}

function upsertEntry(
  entries: HookEntry[] | undefined,
  matcher: string,
  command: string,
): HookEntry[] {
  const list = entries ? [...entries] : [];
  let entry = list.find((e) => e.matcher === matcher);
  if (!entry) {
    entry = { matcher, hooks: [] };
    list.push(entry);
  }
  entry.hooks = entry.hooks.filter((h) => h.command !== command);
  entry.hooks.push({ type: "command", command });
  return list;
}

/**
 * Re-exported, not reimplemented. The generator moved to `@open-wiki/access`
 * beside `scaffoldSkills` — 9.3 and 9.4 are one act, and 8.12 has to
 * regenerate it from the desktop application when the language changes.
 */
export { writeClaudeMd } from "@open-wiki/access";
