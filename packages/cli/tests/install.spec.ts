import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LANGUAGES } from "@open-wiki/access";
import { writeClaudeMd, writeHooks } from "../src/install.js";
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

function readHooks(root: string): { hooks: { PreToolUse: HookEntry[]; PostToolUse: HookEntry[] } } {
  return JSON.parse(readFileSync(join(root, ".claude", "hooks", "hooks.json"), "utf8")) as {
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
    expect(written).toBe(join(root, ".claude", "hooks", "hooks.json"));

    const doc = readHooks(root);
    expect(commandsFor(doc.hooks.PreToolUse, "Write|Edit|Bash")).toEqual(["ow gate pre"]);
    expect(commandsFor(doc.hooks.PostToolUse, "Write|Edit")).toEqual(["ow gate post"]);
  });

  it("keeps the project's own hooks — installing the gate is not destructive", () => {
    mkdirSync(join(root, ".claude", "hooks"), { recursive: true });
    writeFileSync(
      join(root, ".claude", "hooks", "hooks.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Write|Edit|Bash", hooks: [{ type: "command", command: "their-linter" }] },
            { matcher: "Read", hooks: [{ type: "command", command: "their-auditor" }] },
          ],
        },
      }),
      "utf8",
    );

    const doc = readHooks(writeHooksAt(root));
    expect(commandsFor(doc.hooks.PreToolUse, "Write|Edit|Bash")).toEqual([
      "their-linter",
      "ow gate pre",
    ]);
    expect(commandsFor(doc.hooks.PreToolUse, "Read")).toEqual(["their-auditor"]);
  });

  it("re-running init refreshes the gate rather than duplicating it", () => {
    writeHooks(root);
    writeHooks(root);
    writeHooks(root);
    const doc = readHooks(root);
    expect(commandsFor(doc.hooks.PreToolUse, "Write|Edit|Bash")).toEqual(["ow gate pre"]);
    expect(commandsFor(doc.hooks.PostToolUse, "Write|Edit")).toEqual(["ow gate post"]);
  });

  it("starts over from a hooks.json that will not parse rather than refusing to install", () => {
    mkdirSync(join(root, ".claude", "hooks"), { recursive: true });
    writeFileSync(join(root, ".claude", "hooks", "hooks.json"), "{ not json", "utf8");
    const doc = readHooks(writeHooksAt(root));
    expect(commandsFor(doc.hooks.PreToolUse, "Write|Edit|Bash")).toEqual(["ow gate pre"]);
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
