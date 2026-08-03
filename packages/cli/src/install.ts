import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Where Claude Code actually reads a project's hooks from.
 *
 * **`.claude/hooks/hooks.json` is not it, and never was.** `ow init` wrote that
 * path from plan task 9.5 until a review of this group asked for the citation
 * and there was none. Claude Code's reference is explicit: project hooks are
 * defined under a `hooks` key inside `.claude/settings.json` (or
 * `settings.local.json`), and a standalone `hooks/hooks.json` is *exclusively*
 * a plugin's mechanism, resolved inside the plugin's own installed directory.
 * `docs/wiki/claude-code-plugins.md` already said the second half of that; the
 * first half was never checked.
 *
 * So the gate this product's whole safety story rests on was being written to a
 * file nothing loads. Every `ow init` since 9.5 reported installing it.
 * Checked 2026-08-03 against <https://code.claude.com/docs/en/hooks>.
 *
 * This is the third time in this plan that reading beat reasoning about a
 * harness, and the first time the harness was the one we ship for.
 */
const HOOKS_FILE = join(".claude", "settings.json");

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

/**
 * The settings file, of which the gate owns exactly one key.
 *
 * The index signature is load-bearing rather than lax typing: this is now the
 * project's *own* `.claude/settings.json`, which carries permissions, env and
 * whatever else the team put there. Parsing into a shape that named only
 * `hooks` and writing that back would delete all of it.
 */
interface SettingsJson {
  hooks?: {
    PreToolUse?: HookEntry[];
    PostToolUse?: HookEntry[];
  };
  [key: string]: unknown;
}

/** Thrown rather than clobbering settings this product does not own. */
export class UnparsableSettingsError extends Error {
  constructor(public readonly file: string) {
    super(
      `refused: ${file} is not valid JSON, so the write gate was not installed. ` +
        `Fix the file and run ow init again — it holds your own Claude Code settings, ` +
        `and overwriting it to install a hook would be a worse trade than not installing one.`,
    );
    this.name = "UnparsableSettingsError";
  }
}

/**
 * Write the gate's hooks, merging with anything already there so a project's
 * own settings survive (plan 9.5). Our entries are keyed by the `ow gate`
 * command, so re-running `ow init` refreshes them without duplicating or
 * dropping unrelated hooks.
 *
 * **A malformed file is refused, not replaced.** While this wrote a file only
 * this product owned, resetting it on a parse error cost nothing. It now writes
 * the project's own `.claude/settings.json`, where the same `catch` would throw
 * away someone's permissions and environment to install a hook they would then
 * have to be told about.
 */
export function writeHooks(projectRoot: string): { written: string } {
  const file = join(projectRoot, HOOKS_FILE);
  let doc: SettingsJson = {};
  if (existsSync(file)) {
    try {
      doc = JSON.parse(readFileSync(file, "utf8")) as SettingsJson;
    } catch {
      throw new UnparsableSettingsError(file);
    }
    // A JSON file whose top level is an array or a scalar is valid JSON and not
    // a settings object; merging into it would produce something Claude Code
    // ignores entirely, which is the failure this whole change is about.
    if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
      throw new UnparsableSettingsError(file);
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
export { writeClaudeMd, writeEntryFiles } from "@open-wiki/access";
