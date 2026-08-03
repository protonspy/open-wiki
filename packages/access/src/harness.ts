/**
 * What each harness loads, as data (plan `harness-portability.md` 2.1).
 *
 * `adr:0024-the-convention-ships-to-every-harness` decided one template set
 * rendered through a per-harness profile, and that the renderer branches on
 * nothing else. This file is that profile. Adding a harness is an entry here
 * and a review of the rendered output, never a branch through the scaffolder.
 *
 * **Every field was read from the harness's own source**, not from reasoning
 * about it — [[what-a-harness-loads]] carries the citations, and `adr:0013`
 * exists because that rule was broken once and produced a wrong answer. It has
 * now been broken twice more and corrected twice more: 1.1 found that all three
 * harnesses can refuse a write, and 2.1 found that all three read project-local
 * skills. Both times the plan had assumed the opposite.
 */

/** The harnesses a project can be scaffolded for. */
export const HARNESSES = ["claude", "codex", "opencode"] as const;
export type Harness = (typeof HARNESSES)[number];

export function isHarness(value: string): value is Harness {
  return (HARNESSES as readonly string[]).includes(value);
}

/**
 * Where a harness keeps the servers it can reach.
 *
 * `format` is not decoration: Codex keeps them in TOML inside its own config
 * file, and a writer that assumed JSON everywhere would produce a file Codex
 * refuses to parse rather than one it ignores.
 */
export interface McpProfile {
  /** Project-relative path to the file the harness actually reads. */
  readonly file: string;
  readonly format: "json" | "toml";
  /** The key holding the map of server name to server. */
  readonly serversKey: string;
}

/**
 * The strongest interception this harness offers.
 *
 * `null` means a harness that cannot refuse a write before it lands. **No
 * harness supported today is `null`** — the field exists because `adr:0024`
 * kept the case deliberately, as a claim about the future rather than about
 * these three, and because the alternative is discovering it as a crash.
 */
export interface GateProfile {
  /** How the interception is declared: a hook command, or a loaded plugin. */
  readonly mechanism: "hook" | "plugin";
  /** Project-relative path to the file declaring it. */
  readonly configFile: string;
  /**
   * What the convention text calls this regime, in one phrase. It goes into the
   * rendered entry file so a user knows which regime they are under — `adr:0024`
   * requires it stated, because someone who believes they are protected and is
   * not is worse off than someone who knows they are not.
   */
  readonly describes: string;
}

export interface HarnessProfile {
  readonly id: Harness;
  /** What a person calls it, for a picker and for prose. */
  readonly label: string;
  /** The generated entry file, at the project root. */
  readonly entryFile: string;
  /** Where a scaffolded skill goes: `<skillsDir>/<name>/SKILL.md`. */
  readonly skillsDir: string;
  readonly mcp: McpProfile;
  readonly gate: GateProfile | null;
}

const CLAUDE: HarnessProfile = {
  id: "claude",
  label: "Claude Code",
  entryFile: "CLAUDE.md",
  skillsDir: ".claude/skills",
  mcp: { file: ".mcp.json", format: "json", serversKey: "mcpServers" },
  gate: {
    mechanism: "hook",
    // `.claude/settings.json`, under a `hooks` key — **not** `.claude/hooks/hooks.json`,
    // which this product wrote from plan 9.5 until a review asked for the
    // citation and there was none. That path is a plugin's mechanism and is
    // resolved inside the plugin's own directory; a project's hooks are read
    // from its settings file. See `install.ts` for the whole account.
    configFile: ".claude/settings.json",
    describes: "a PreToolUse hook that refuses a bad page before the write lands",
  },
};

/**
 * Codex also reads `.agents/skills`, and this profile does not write there.
 *
 * `.agents/` is the harness-neutral location, which makes it the tempting
 * choice — and it is the wrong one here for a reason that is not about Codex:
 * a project may carry several harnesses, `.agents/skills` is read by some of
 * them and not others, and a convention written to a shared directory is one
 * `ow update` cannot attribute to the harness that wanted it. One directory per
 * harness keeps 5.1's three-way hash answerable per file.
 */
const CODEX: HarnessProfile = {
  id: "codex",
  label: "Codex",
  entryFile: "AGENTS.md",
  skillsDir: ".codex/skills",
  mcp: { file: ".codex/config.toml", format: "toml", serversKey: "mcp_servers" },
  gate: {
    mechanism: "hook",
    configFile: ".codex/hooks.json",
    describes: "a PreToolUse hook that refuses a bad page before the write lands",
  },
};

/**
 * opencode's gate is a plugin, and the hook inside it that can refuse is not
 * the obvious one: `tool.execute.before` returns `Promise<void>` and carries
 * only `args`, so it can rewrite what a tool was asked to do and cannot refuse
 * it. `permission.ask` is the one that answers `"deny"`. A plugin written
 * against the obvious hook would silently permit everything, which is why this
 * is written down rather than left to whoever implements group 3.
 */
const OPENCODE: HarnessProfile = {
  id: "opencode",
  label: "opencode",
  entryFile: "AGENTS.md",
  skillsDir: ".opencode/skills",
  mcp: { file: "opencode.json", format: "json", serversKey: "mcp" },
  gate: {
    mechanism: "plugin",
    configFile: ".opencode/plugin/open-wiki.ts",
    describes: "a plugin that refuses a bad page through permission.ask before the write lands",
  },
};

export const PROFILES: Readonly<Record<Harness, HarnessProfile>> = {
  claude: CLAUDE,
  codex: CODEX,
  opencode: OPENCODE,
};

export function profileFor(harness: Harness): HarnessProfile {
  return PROFILES[harness];
}

/** The profiles for a set of harnesses, in `HARNESSES` order rather than the caller's. */
export function profilesFor(harnesses: readonly Harness[]): HarnessProfile[] {
  const wanted = new Set(harnesses);
  return HARNESSES.filter((h) => wanted.has(h)).map(profileFor);
}

/**
 * The directories and files this product writes for a harness — everything
 * whose presence is *this profile's* doing.
 *
 * It exists so a caller can ask "what belongs to Codex here" without
 * reconstructing it from four fields, and so 3.3's refusal — no agent-mediated
 * write reaches a harness's own configuration — has one list to consult rather
 * than a rule each caller re-derives. A gate whose configuration is editable
 * through the gate edits away its own restraint.
 */
export function managedPaths(profile: HarnessProfile): string[] {
  const paths = [profile.entryFile, profile.skillsDir, profile.mcp.file];
  if (profile.gate) paths.push(profile.gate.configFile);
  return paths;
}

/**
 * The harnesses in this set that read `filename` as their entry file.
 *
 * **Codex and opencode both read `AGENTS.md`**, so a project carrying both has
 * one entry file serving two harnesses rather than two files. That is a
 * collision the renderer has to decide about rather than discover, which is
 * what `adr:0024` asked for — and it is why the entry file is rendered from the
 * set of harnesses rather than once per harness.
 */
export function harnessesSharingEntryFile(
  profiles: readonly HarnessProfile[],
  filename: string,
): HarnessProfile[] {
  return profiles.filter((p) => p.entryFile === filename);
}

/** The distinct entry filenames a set of harnesses needs, in profile order. */
export function entryFilesFor(profiles: readonly HarnessProfile[]): string[] {
  const seen: string[] = [];
  for (const p of profiles) if (!seen.includes(p.entryFile)) seen.push(p.entryFile);
  return seen;
}
