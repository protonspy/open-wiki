import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LANGUAGES } from "@open-wiki/access";
import {
  HOOK_MATCHERS,
  UnparsableSettingsError,
  writeClaudeMd,
  writeHooks,
} from "../src/install.js";
import { generateClaudeMd } from "@open-wiki/access";

/**
 * The half of `ow init` the scaffolder does not do (plan 9.4, 9.5): the hook
 * configuration that puts writes through the gate, and the generated
 * `CLAUDE.md` that points at the skills and carries the content language.
 *
 * The property that matters for the hooks is that installing the gate is not
 * destructive: a project's own hooks survive, and running `ow init` again
 * refreshes ours without duplicating them.
 */

interface HookEntry {
  matcher: string;
  hooks: Array<{ type: string; command: string }>;
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "ow-install-"));
}

/**
 * `.claude/settings.json`, under a `hooks` key.
 *
 * **Not `.claude/hooks/hooks.json`**, which `ow init` wrote from plan 9.5 until
 * a review of the harness work asked for the citation and there was none.
 * Claude Code reads a project's hooks from its settings file; a standalone
 * `hooks/hooks.json` is a plugin's own mechanism, resolved inside the plugin's
 * installed directory. So the gate this product's safety story rests on was
 * written where nothing loads it, and every `ow init` reported installing it.
 * Checked 2026-08-03 against <https://code.claude.com/docs/en/hooks>.
 */
const SETTINGS = [".claude", "settings.json"] as const;

function readHooks(root: string): { hooks: { PreToolUse: HookEntry[]; PostToolUse: HookEntry[] } } {
  return JSON.parse(readFileSync(join(root, ...SETTINGS), "utf8")) as {
    hooks: { PreToolUse: HookEntry[]; PostToolUse: HookEntry[] };
  };
}

function commandsFor(entries: HookEntry[], matcher: string): string[] {
  return (entries.find((e) => e.matcher === matcher)?.hooks ?? []).map((h) => h.command);
}

describe("writeHooks (9.5)", () => {
  let root: string;
  beforeEach(() => (root = tempDir()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("installs the pre and post gate hooks into a project with none", () => {
    const { written } = writeHooks(root);
    expect(written).toBe(join(root, ...SETTINGS));

    const doc = readHooks(root);
    expect(commandsFor(doc.hooks.PreToolUse, HOOK_MATCHERS.pre)).toEqual(["ow gate pre"]);
    expect(commandsFor(doc.hooks.PostToolUse, HOOK_MATCHERS.post)).toEqual(["ow gate post"]);
  });

  it("keeps the project's own hooks — installing the gate is not destructive", () => {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(
      join(root, ...SETTINGS),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: HOOK_MATCHERS.pre, hooks: [{ type: "command", command: "their-linter" }] },
            { matcher: "Read", hooks: [{ type: "command", command: "their-auditor" }] },
          ],
        },
      }),
      "utf8",
    );

    const doc = readHooks(writeHooksAt(root));
    expect(commandsFor(doc.hooks.PreToolUse, HOOK_MATCHERS.pre)).toEqual([
      "their-linter",
      "ow gate pre",
    ]);
    expect(commandsFor(doc.hooks.PreToolUse, "Read")).toEqual(["their-auditor"]);
  });

  it("keeps every other setting in the file, which is now the project's own", () => {
    // The whole reason the malformed case below changed too: this file carries
    // permissions and environment, not just our hook. Parsing into a shape that
    // named only `hooks` and writing that back would delete all of it.
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(
      join(root, ...SETTINGS),
      JSON.stringify({ permissions: { deny: ["Bash(rm:*)"] }, env: { TZ: "UTC" } }),
      "utf8",
    );

    writeHooks(root);
    const doc = JSON.parse(readFileSync(join(root, ...SETTINGS), "utf8")) as Record<
      string,
      unknown
    >;
    expect(doc["permissions"]).toEqual({ deny: ["Bash(rm:*)"] });
    expect(doc["env"]).toEqual({ TZ: "UTC" });
    expect(doc["hooks"]).toBeDefined();
  });

  it("re-running init refreshes the gate rather than duplicating it", () => {
    writeHooks(root);
    writeHooks(root);
    writeHooks(root);
    const doc = readHooks(root);
    expect(commandsFor(doc.hooks.PreToolUse, HOOK_MATCHERS.pre)).toEqual(["ow gate pre"]);
    expect(commandsFor(doc.hooks.PostToolUse, HOOK_MATCHERS.post)).toEqual(["ow gate post"]);
  });

  it("refuses a settings file that will not parse, rather than starting over from it", () => {
    // **This assertion is the reverse of what it was**, and deliberately.
    // While the gate wrote a file only this product owned, resetting it on a
    // parse error cost nothing. It now writes the project's own
    // `.claude/settings.json`, and the same behaviour would throw away
    // somebody's permissions and environment to install a hook they would then
    // have to be told about. Not installing a gate is the better trade, as long
    // as it is said out loud.
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ...SETTINGS), "{ not json", "utf8");

    expect(() => writeHooks(root)).toThrow(UnparsableSettingsError);
    expect(readFileSync(join(root, ...SETTINGS), "utf8")).toBe("{ not json");
  });

  it("refuses valid JSON that is not a settings object", () => {
    // An array parses fine and is not settings; merging into it would produce
    // something Claude Code ignores entirely, which is the failure this whole
    // change is about.
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ...SETTINGS), "[1, 2, 3]", "utf8");
    expect(() => writeHooks(root)).toThrow(UnparsableSettingsError);
  });
});

/** `writeHooks` for its side effect, returning the root so a read can chain. */
function writeHooksAt(root: string): string {
  writeHooks(root);
  return root;
}

describe("the generated CLAUDE.md (9.4)", () => {
  let root: string;
  beforeEach(() => (root = tempDir()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("points at the skills and repeats none of what they say", () => {
    const md = generateClaudeMd("en");
    expect(md).toContain(".claude/skills/wiki/SKILL.md");
    expect(md).toContain(".claude/skills/codewiki/SKILL.md");
    expect(md).toContain("this file does not repeat them");
  });

  it("names the configured language for every language there is", () => {
    const labels: Record<string, string> = {
      en: "English",
      "pt-BR": "Brazilian Portuguese",
      es: "Spanish",
    };
    for (const language of LANGUAGES) {
      expect(generateClaudeMd(language)).toContain(`**${labels[language]}** (configured)`);
    }
  });

  it("is written to the project root, and regenerated because it is generated", () => {
    writeFileSync(join(root, "CLAUDE.md"), "stale, hand-edited\n", "utf8");
    const file = writeClaudeMd(root, "pt-BR");
    expect(file).toBe(join(root, "CLAUDE.md"));
    const md = readFileSync(file, "utf8");
    expect(md).not.toContain("stale, hand-edited");
    expect(md).toContain("Brazilian Portuguese");
  });
});
