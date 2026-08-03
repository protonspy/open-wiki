import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HARNESSES, managedPaths, profileFor, type Harness } from "@open-wiki/access";

/**
 * The guarded paths, baked into opencode's plugin as data.
 *
 * The plugin is a *file in the user's project*, so it cannot import this
 * package — it runs inside opencode with no relationship to our node_modules.
 * The list is therefore rendered into it, from the same `managedPaths` the
 * in-process guard derives from, so the two cannot say different things about
 * which files an agent may edit. `ow update` (5.1) is what rewrites a plugin
 * this list has moved past.
 */
const GUARDED_FOR_PLUGIN: string[] = [
  ...new Set(
    HARNESSES.flatMap((h) => managedPaths(profileFor(h)))
      .map((p) => p.replace(/\\/g, "/").toLowerCase())
      .flatMap((p) => (p.startsWith(".") && p.includes("/") ? [p, p.split("/")[0]!] : [p])),
  ),
];

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
 * Codex reads its project hooks from `.codex/hooks.json`, in the same JSON
 * shape Claude Code uses inside its settings file — `{ hooks: { PreToolUse:
 * [{ matcher, hooks: [{ type: "command", command }] }] } }`
 * (`codex-rs/config/src/hook_config.rs`, `codex-rs/hooks/src/engine/discovery.rs`).
 *
 * **The matcher ports unchanged, and that is not a coincidence.** Codex names
 * its file-editing tool `apply_patch` but accepts `Write` and `Edit` as matcher
 * aliases "for compatibility with hook configurations that describe edits using
 * Claude Code-style names" (`codex-rs/core/src/tools/hook_names.rs`), and its
 * shell tool is called `Bash` outright. So one matcher string selects the same
 * handlers under both.
 *
 * What does *not* port is the payload: the `tool_name` on stdin stays
 * `apply_patch` and its `tool_input` is `{ command: <patch text> }`. `hooks.ts`
 * is where that is answered.
 */
const CODEX_HOOKS_FILE = join(".codex", "hooks.json");

/** Write Codex's `PreToolUse` hook, merging with whatever is already there. */
export function writeCodexHooks(projectRoot: string): { written: string } {
  const file = join(projectRoot, CODEX_HOOKS_FILE);
  let doc: SettingsJson = {};
  if (existsSync(file)) {
    try {
      doc = JSON.parse(readFileSync(file, "utf8")) as SettingsJson;
    } catch {
      throw new UnparsableSettingsError(file);
    }
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

/**
 * opencode's gate is a plugin, and **the hook that can refuse is not the
 * obvious one.** `tool.execute.before` returns `Promise<void>` and its output
 * carries only `args`, so it can rewrite what a tool was asked to do and has no
 * channel to refuse it; a plugin written against it would silently permit
 * everything. `permission.ask(input, output)` is the one that answers
 * `output.status = "deny"` (`packages/plugin/src/index.ts`).
 *
 * **It sees paths, not content.** A permission request carries
 * `{ action, resources: string[] }` — opencode's own write tool asserts
 * `action: "edit"` with the target as a resource (`packages/core/src/tool/write.ts`)
 * — and nothing about what would be written. So this gate refuses and does not
 * complete, exactly as Codex's does and for the same honest reason, and
 * `AGENTS.md` says so.
 */
const OPENCODE_PLUGIN_FILE = join(".opencode", "plugin", "open-wiki.ts");

function opencodePlugin(): string {
  return `// Installed by \`ow init\`. The open-wiki write gate for opencode.
//
// **\`permission.ask\` and not \`tool.execute.before\`.** The latter returns
// \`Promise<void>\` and its output carries only \`args\`: it can rewrite what a
// tool was asked to do and cannot refuse it, so a gate written against it would
// silently permit everything. This one answers \`output.status = "deny"\`.
//
// It sees the paths a tool wants and not the content it would write, so it
// refuses rather than completing. \`ow write <path> --file <file>\` is how a page
// lands: the store validates the schema and fills the fields it owns.

/** Paths this product manages for any harness — never editable by the agent. */
const GUARDED = ${JSON.stringify(GUARDED_FOR_PLUGIN, null, 2).replace(/\n/g, "\n")};

import { isAbsolute, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// **A path is not a string.** \`src/../wiki/evil.md\` does not begin with
// "wiki/" and lands in it anyway, so this resolves before it classifies —
// \`node:path\` rather than a hand-rolled prefix test, which is what the first
// version of this file used and what a security review walked straight through.
// A trailing separator on \`directory\`, an absolute resource, a "\\\\" separator
// and a ".." segment all reduce to the same answer here.
// Three answers, and the difference between the last two is the whole point:
//   a string  — a path inside this project, already normalised and folded
//   "outside" — resolved fine, and belongs to nobody here
//   "unknown" — could not be resolved at all
//
// "outside" must not be refused: this plugin guards *this project*, and a gate
// that denied every edit elsewhere on the disk would be a general-purpose
// blocker nobody asked for. "unknown" must not be allowed: it means the check
// did not run, and a check that did not run is not a pass.
function relativeToProject(resource, directory) {
  if (!directory) return "unknown"
  let path = String(resource)
  if (path.startsWith("file://")) {
    // \`fileURLToPath\`, not a prefix strip: a Windows URL is \`file:///C:/x\`,
    // and slicing off "file://" leaves "/C:/x" — which resolves to nonsense and
    // then matches nothing, which is an allow. It also does the percent-decoding.
    try {
      path = fileURLToPath(path)
    } catch {
      return "unknown"
    }
  }
  if (!path) return "unknown"
  const root = resolve(String(directory))
  const abs = isAbsolute(path) ? resolve(path) : resolve(root, path)
  const rel = relative(root, abs).split("\\\\").join("/")
  // An absolute answer means a different drive on Windows, which "../" misses.
  if (rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) return "outside"
  return rel.toLowerCase()
}

export const OpenWikiGate = async ({ directory }) => ({
  "permission.ask": async (input, output) => {
    for (const resource of input.resources ?? []) {
      const rel = relativeToProject(resource, directory)

      // Somewhere else on the disk. Not this project's wiki and not its
      // configuration, so this gate has no opinion — opencode's own rules
      // decide, as they would with no plugin installed.
      if (rel === "outside") continue

      // **Unresolvable is refused, not waved through.** It means the check did
      // not run: no project directory was given, or the resource arrived in a
      // shape this could not read. Passing the raw string on as though it were
      // already relative — which is what this did before a security review —
      // turned every one of those into an allow.
      if (rel === "unknown") {
        output.status = "deny"
        return
      }

      // The gate's own configuration, for every harness. A write path that
      // reaches it edits away its own restraint through a change that reads as
      // documentation in review.
      if (GUARDED.some((p) => rel === p || rel.startsWith(p + "/"))) {
        output.status = "deny"
        return
      }

      // A wiki page. Nothing here can see what would be written, so it cannot
      // validate or complete one.
      if (rel.startsWith("wiki/") && rel.endsWith(".md")) {
        output.status = "deny"
        return
      }
    }
  },
})
`;
}

/**
 * Write opencode's gate plugin, overwriting what is there.
 *
 * **It is generated, so it is regenerated** — the same rule the entry files
 * follow, and for the same reason: a gate carrying last release's guarded-path
 * list is a gate with holes in it, and the holes would be invisible. The doc
 * comment here once said "never over one somebody edited", which the code did
 * not do and should not do; a review caught the two disagreeing.
 *
 * The cost is real and is 5.1's to pay: somebody who hardened this file loses
 * it silently. That is exactly the third bucket `ow update` exists for —
 * unchanged, updatable, and *edited by the user* — and until it lands, this
 * file is ours.
 */
export function writeOpencodePlugin(projectRoot: string): { written: string } {
  const file = join(projectRoot, OPENCODE_PLUGIN_FILE);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, opencodePlugin(), "utf8");
  return { written: file };
}

/**
 * Install the gate for exactly the harnesses this project carries (3.1).
 *
 * **Only for those.** `runInit` called `writeHooks` unconditionally, so a
 * Codex-only project got a `.claude/settings.json` written into it — a file for
 * a harness nobody asked for, which is the mirror image of the bug this plan
 * exists to end.
 *
 * A harness whose profile carries no interception gets nothing, and the
 * convention text says so rather than a file being written that looks like a
 * gate and is not. No harness supported today is in that case.
 */
export function writeGate(
  projectRoot: string,
  harnesses: readonly Harness[],
): { written: string[] } {
  const written: string[] = [];
  for (const harness of harnesses) {
    if (harness === "claude") written.push(writeHooks(projectRoot).written);
    if (harness === "codex") written.push(writeCodexHooks(projectRoot).written);
    if (harness === "opencode") written.push(writeOpencodePlugin(projectRoot).written);
  }
  return { written };
}

/**
 * Re-exported, not reimplemented. The generator moved to `@open-wiki/access`
 * beside `scaffoldSkills` — 9.3 and 9.4 are one act, and 8.12 has to
 * regenerate it from the desktop application when the language changes.
 */
export { writeClaudeMd, writeEntryFiles } from "@open-wiki/access";
