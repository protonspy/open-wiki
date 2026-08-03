import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HOOK_MATCHERS, writeCodexHooks, writeGate, writeOpencodePlugin } from "../src/install.js";
import { runPreToolUse } from "../src/hooks.js";

/**
 * The gate, per harness (3.1) — and what each one can honestly do (3.2).
 *
 * The shapes asserted here come from each harness's own source, recorded in
 * [[what-a-harness-loads]]: Codex's `.codex/hooks.json` from
 * `codex-rs/hooks/src/engine/discovery.rs`, its matcher aliases from
 * `codex-rs/core/src/tools/hook_names.rs`, and opencode's `permission.ask` from
 * `packages/plugin/src/index.ts`.
 */

let root: string;
/** A fresh query string per import, so a rewritten plugin is not served from cache. */
let counter = 0;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ow-gate3-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const codexHooks = () =>
  JSON.parse(readFileSync(join(root, ".codex", "hooks.json"), "utf8")) as {
    hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }> };
  };

describe("writeGate installs only what the project asked for (3.1)", () => {
  it("writes Codex's hooks and nothing of Claude Code's", () => {
    // `runInit` called `writeHooks` unconditionally, so a Codex-only project got
    // a `.claude/settings.json` written into it — a file for a harness nobody
    // asked for, which is this plan's own bug pointing the other way.
    writeGate(root, ["codex"]);
    expect(existsSync(join(root, ".codex", "hooks.json"))).toBe(true);
    expect(existsSync(join(root, ".claude", "settings.json"))).toBe(false);
    expect(existsSync(join(root, ".opencode", "plugin", "open-wiki.ts"))).toBe(false);
  });

  it("writes opencode's plugin and nothing else", () => {
    writeGate(root, ["opencode"]);
    expect(existsSync(join(root, ".opencode", "plugin", "open-wiki.ts"))).toBe(true);
    expect(existsSync(join(root, ".claude", "settings.json"))).toBe(false);
    expect(existsSync(join(root, ".codex", "hooks.json"))).toBe(false);
  });

  it("writes one gate per harness for a project carrying several", () => {
    const { written } = writeGate(root, ["claude", "codex", "opencode"]);
    expect(written).toHaveLength(3);
    for (const file of written) expect(existsSync(file)).toBe(true);
  });

  it("writes nothing at all for no harnesses", () => {
    expect(writeGate(root, []).written).toEqual([]);
  });
});

describe("Codex's hooks file", () => {
  it("uses the matcher that selects the same handlers under both harnesses", () => {
    // Codex names its file-editing tool `apply_patch` but accepts `Write` and
    // `Edit` as matcher aliases "for compatibility with hook configurations that
    // describe edits using Claude Code-style names", and its shell tool is
    // `Bash` outright. So one matcher string serves both.
    writeCodexHooks(root);
    const entry = codexHooks().hooks.PreToolUse.find((e) => e.matcher === HOOK_MATCHERS.pre);
    expect(entry).toBeDefined();
    expect(entry!.hooks.map((h) => h.command)).toEqual(["ow gate pre"]);
  });

  it("keeps hooks the project already had", () => {
    mkdirSync(join(root, ".codex"), { recursive: true });
    writeFileSync(
      join(root, ".codex", "hooks.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "Read", hooks: [{ type: "command", command: "theirs" }] }],
        },
      }),
      "utf8",
    );
    writeCodexHooks(root);
    const matchers = codexHooks().hooks.PreToolUse.map((e) => e.matcher);
    expect(matchers).toContain("Read");
    expect(matchers).toContain(HOOK_MATCHERS.pre);
  });

  it("does not duplicate itself on a re-run", () => {
    writeCodexHooks(root);
    writeCodexHooks(root);
    const entry = codexHooks().hooks.PreToolUse.find((e) => e.matcher === HOOK_MATCHERS.pre);
    expect(entry!.hooks).toHaveLength(1);
  });
});

describe("opencode's plugin", () => {
  const plugin = () => readFileSync(join(root, ".opencode", "plugin", "open-wiki.ts"), "utf8");

  it("hooks permission.ask and not tool.execute.before", () => {
    // `tool.execute.before` returns `Promise<void>` and carries only `args`: it
    // can rewrite what a tool was asked to do and cannot refuse it, so a plugin
    // written against it would silently permit everything.
    writeOpencodePlugin(root);
    expect(plugin()).toContain("permission.ask");
    expect(plugin()).not.toContain('"tool.execute.before"');
  });

  it("denies by setting the status the contract defines", () => {
    writeOpencodePlugin(root);
    expect(plugin()).toContain('output.status = "deny"');
  });

  /**
   * The plugin is generated source, so the honest test loads and runs the file
   * this actually writes rather than asserting about its text. Every case here
   * is one a security review confirmed by execution against the first version,
   * which hand-rolled a prefix comparison: a `..` segment, a trailing separator
   * on `directory`, and a missing `directory` each disabled every check for
   * every resource.
   */
  describe("what it actually decides", () => {
    async function gate(directory: string) {
      writeOpencodePlugin(root);
      const file = join(root, ".opencode", "plugin", "open-wiki.ts");
      const mod = (await import(`${pathToFileURL(file).href}?v=${counter++}`)) as {
        OpenWikiGate: (ctx: { directory: string }) => Promise<{
          "permission.ask": (
            input: { resources: string[] },
            output: { status?: string },
          ) => Promise<void>;
        }>;
      };
      const hooks = await mod.OpenWikiGate({ directory });
      return async (...resources: string[]) => {
        const output: { status?: string } = {};
        await hooks["permission.ask"]({ resources }, output);
        return output.status;
      };
    }

    it("denies a wiki page and the gate's own configuration", async () => {
      const ask = await gate(root);
      expect(await ask(join(root, "wiki", "fenix.md"))).toBe("deny");
      expect(await ask(join(root, ".claude", "settings.json"))).toBe("deny");
      expect(await ask(join(root, "AGENTS.md"))).toBe("deny");
    });

    it("denies a page reached through a traversal segment", async () => {
      const ask = await gate(root);
      expect(await ask(join(root, "src", "..", "wiki", "evil.md"))).toBe("deny");
    });

    it("holds when the project directory carries a trailing separator", async () => {
      // A literal prefix test failed for *every* resource here, allowing the lot.
      const ask = await gate(`${root}/`);
      expect(await ask(join(root, "wiki", "fenix.md"))).toBe("deny");
      expect(await ask(join(root, ".codex", "hooks.json"))).toBe("deny");
    });

    it("refuses everything when it cannot tell where the project is", async () => {
      // A check that did not run is not a pass.
      const ask = await gate("");
      expect(await ask(join(root, "src", "main.ts"))).toBe("deny");
    });

    it("accepts a file:// resource, decoded", async () => {
      const ask = await gate(root);
      expect(await ask(pathToFileURL(join(root, "wiki", "my page.md")).href)).toBe("deny");
    });

    it("has no opinion about a file somewhere else on the disk", async () => {
      // This guards *this project*. Denying every edit elsewhere would make it a
      // general-purpose blocker nobody asked for.
      const ask = await gate(root);
      expect(await ask(join(root, "..", "elsewhere", "notes.md"))).toBeUndefined();
    });

    it("has no opinion about an ordinary file in the project", async () => {
      const ask = await gate(root);
      expect(await ask(join(root, "src", "main.ts"))).toBeUndefined();
    });

    it("denies when any one resource of several is guarded", async () => {
      const ask = await gate(root);
      expect(await ask(join(root, "src", "main.ts"), join(root, "wiki", "a.md"))).toBe("deny");
    });
  });

  it("carries the guarded paths as data, since it cannot import them", () => {
    // The plugin is a file in the user's project and runs inside opencode, with
    // no relationship to our node_modules. The list is rendered in from the same
    // `managedPaths` the in-process guard derives from, so the two cannot
    // disagree about which files an agent may edit.
    writeOpencodePlugin(root);
    const body = plugin();
    for (const guarded of [".claude", ".codex", ".opencode", "agents.md", ".mcp.json"]) {
      expect(body.toLowerCase(), `the plugin must guard ${guarded}`).toContain(guarded);
    }
  });
});

describe("the gate under Codex — apply_patch (3.1)", () => {
  const patch = (body: string) => ({
    hook_event_name: "PreToolUse",
    tool_name: "apply_patch",
    cwd: root,
    tool_use_id: "t1",
    tool_input: { command: `*** Begin Patch\n${body}\n*** End Patch\n` },
  });

  it("refuses a patch that would edit the gate's own configuration", () => {
    const out = runPreToolUse(patch("*** Update File: .codex/hooks.json\n+{}"), root, "2026-08-03");
    expect(out?.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("refuses a patch that edits another harness's convention", () => {
    // The cross-harness case 3.3 is about, arriving through Codex's own tool.
    const out = runPreToolUse(
      patch("*** Update File: .claude/skills/wiki/SKILL.md\n+x"),
      root,
      "d",
    );
    expect(out?.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("refuses a wiki page, and says how to write one", () => {
    const out = runPreToolUse(patch("*** Add File: wiki/fenix.md\n+# Fenix"), root, "2026-08-03");
    expect(out?.hookSpecificOutput.permissionDecision).toBe("deny");
    // It refuses; it does not complete — so the denial has to carry the path
    // that does work, or it is a dead end.
    expect(out?.hookSpecificOutput.permissionDecisionReason).toContain("ow write");
  });

  it("catches a page moved into wiki/, not only one written there", () => {
    // A move reaches two paths. A gate reading only the first would let a page
    // arrive in `wiki/` unvalidated.
    const body = "*** Update File: notes/draft.md\n*** Move to: wiki/fenix.md\n@@\n+x";
    const out = runPreToolUse(patch(body), root, "2026-08-03");
    expect(out?.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("refuses a patch it cannot read, because unknown is not 'touches nothing'", () => {
    const out = runPreToolUse(patch("garbage with no targets"), root, "2026-08-03");
    expect(out?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out?.hookSpecificOutput.permissionDecisionReason).toMatch(/could not be read/i);
  });

  it("lets an ordinary source file through", () => {
    expect(runPreToolUse(patch("*** Add File: src/main.ts\n+x"), root, "2026-08-03")).toBeNull();
  });

  it("ignores a custom tool call that is not a patch at all", () => {
    const out = runPreToolUse(
      {
        hook_event_name: "PreToolUse",
        tool_name: "apply_patch",
        cwd: root,
        tool_use_id: "t1",
        tool_input: { command: "not a patch" },
      },
      root,
      "2026-08-03",
    );
    expect(out).toBeNull();
  });

  /**
   * **A path is not a string**, and the first version of this arm classified
   * the raw parser output with a `startsWith("wiki/")` of its own. A security
   * review wrote the patch that walked through it, and these are that patch and
   * its relatives. The arm now resolves first and asks `gatedPageRel` — the
   * same classifier the `Write`/`Edit` arm uses — because two classifiers for
   * one question is how they come to disagree.
   */
  describe("a path that reaches wiki/ without spelling it", () => {
    it("catches a traversal segment", () => {
      const out = runPreToolUse(patch("*** Add File: src/../wiki/evil.md\n+x"), root, "d");
      expect(out?.hookSpecificOutput.permissionDecision).toBe("deny");
    });

    it("catches a deeper one", () => {
      const out = runPreToolUse(patch("*** Add File: a/b/../../wiki/evil.md\n+x"), root, "d");
      expect(out?.hookSpecificOutput.permissionDecision).toBe("deny");
    });

    it("catches a traversal reaching the gate's own configuration", () => {
      const out = runPreToolUse(
        patch("*** Update File: wiki/../.codex/hooks.json\n+{}"),
        root,
        "d",
      );
      expect(out?.hookSpecificOutput.permissionDecision).toBe("deny");
    });

    it("catches one that is moved there rather than written there", () => {
      const body = "*** Update File: notes/d.md\n*** Move to: x/../wiki/evil.md\n@@\n+y";
      expect(runPreToolUse(patch(body), root, "d")?.hookSpecificOutput.permissionDecision).toBe(
        "deny",
      );
    });

    it("catches a page named in a different case", () => {
      // Windows is the only platform this ships on, and folding errs toward
      // gating: at worst a page is validated that need not have been.
      const out = runPreToolUse(patch("*** Add File: WIKI/Evil.MD\n+x"), root, "d");
      expect(out?.hookSpecificOutput.permissionDecision).toBe("deny");
    });

    it("refuses a patch that escapes the project entirely", () => {
      // `allow` is "no opinion", never "write anywhere" — `gateWrite`'s own rule.
      const out = runPreToolUse(patch("*** Add File: ../../outside.md\n+x"), root, "d");
      expect(out?.hookSpecificOutput.permissionDecision).toBe("deny");
    });

    it("still lets an ordinary file with a traversal in it through", () => {
      // The fix must not turn every `..` into a refusal — only the ones that
      // land somewhere this product owns.
      expect(runPreToolUse(patch("*** Add File: a/../src/main.ts\n+x"), root, "d")).toBeNull();
    });
  });
});
