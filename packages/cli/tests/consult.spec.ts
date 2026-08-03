import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { InvalidNameError } from "@open-wiki/access";
import { runConsultAdd, UnparsableMcpConfigError } from "../src/commands/consult.js";

/**
 * `ow consult add <name>` (plan 9.8). The entry names the other project, never
 * its path — that is what makes `.mcp.json` committable and portable, since
 * `ow mcp` resolves the name through the registry on whichever machine runs it.
 */

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "ow-consult-"));
}

function readMcp(root: string): {
  mcpServers: Record<string, { command: string; args: string[] }>;
} {
  return JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")) as {
    mcpServers: Record<string, { command: string; args: string[] }>;
  };
}

describe("ow consult add (9.8)", () => {
  let root: string;
  beforeEach(() => (root = tempDir()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("writes a read-only entry that names the project, not its path", () => {
    expect(runConsultAdd(root, "fenix").key).toBe("open-wiki-fenix");
    const entry = readMcp(root).mcpServers["open-wiki-fenix"]!;
    expect(entry.command).toBe("ow");
    expect(entry.args).toEqual(["mcp", "--project", "fenix", "--read-only"]);
    // No absolute path anywhere: a path is a portability bug and someone's username.
    expect(JSON.stringify(entry)).not.toContain(root);
  });

  it("keeps servers the project already had", () => {
    writeFileSync(
      join(root, ".mcp.json"),
      JSON.stringify({ mcpServers: { theirs: { command: "their-server" } } }),
      "utf8",
    );
    runConsultAdd(root, "fenix");
    const servers = readMcp(root).mcpServers;
    expect(Object.keys(servers).sort()).toEqual(["open-wiki-fenix", "theirs"]);
  });

  it("adding the same consult twice leaves one entry", () => {
    runConsultAdd(root, "fenix");
    runConsultAdd(root, "fenix");
    expect(Object.keys(readMcp(root).mcpServers)).toEqual(["open-wiki-fenix"]);
  });

  it("refuses a .mcp.json that will not parse, rather than starting over from it", () => {
    // **The reverse of what this asserted**, and deliberately — the same
    // correction `writeHooks` took in group 2. Resetting cost nothing while the
    // only target was `.mcp.json`, which holds our entry and little else. The
    // same code now writes `opencode.json`, which is somebody's whole opencode
    // configuration, and silently replacing it to add one server is a worse
    // trade than not adding it.
    writeFileSync(join(root, ".mcp.json"), "{ not json", "utf8");
    expect(() => runConsultAdd(root, "fenix")).toThrow(UnparsableMcpConfigError);
    expect(readFileSync(join(root, ".mcp.json"), "utf8")).toBe("{ not json");
  });
});

describe("the consult reaches every harness the project carries (4.1, 4.2)", () => {
  let root: string;
  beforeEach(() => (root = tempDir()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const codexConfig = () => readFileSync(join(root, ".codex", "config.toml"), "utf8");

  it("writes Codex's entry as TOML, in Codex's own config file", () => {
    // Codex keeps servers in `[mcp_servers]` inside its own TOML config, not a
    // file of its own. A writer assuming JSON everywhere would produce a file
    // Codex refuses to parse rather than one it ignores.
    const result = runConsultAdd(root, "fenix", ["codex"]);
    expect(result.written).toEqual([join(root, ".codex", "config.toml")]);
    const toml = parseToml(codexConfig()) as {
      mcp_servers: Record<string, { command: string; args: string[] }>;
    };
    expect(toml.mcp_servers["open-wiki-fenix"]).toEqual({
      command: "ow",
      args: ["mcp", "--project", "fenix", "--read-only"],
    });
  });

  it("writes opencode's entry under the key opencode reads", () => {
    runConsultAdd(root, "fenix", ["opencode"]);
    const doc = JSON.parse(readFileSync(join(root, "opencode.json"), "utf8")) as {
      mcp: Record<string, unknown>;
    };
    expect(Object.keys(doc.mcp)).toEqual(["open-wiki-fenix"]);
  });

  it("adds it everywhere in one act, so no harness is left half-configured", () => {
    const result = runConsultAdd(root, "fenix", ["claude", "codex", "opencode"]);
    expect(result.written).toHaveLength(3);
    for (const file of result.written) expect(existsSync(file)).toBe(true);
  });

  it("writes nothing for a harness the project does not carry", () => {
    runConsultAdd(root, "fenix", ["codex"]);
    expect(existsSync(join(root, ".mcp.json"))).toBe(false);
    expect(existsSync(join(root, "opencode.json"))).toBe(false);
  });

  it("still means Claude Code for a project that records no harness", () => {
    runConsultAdd(root, "fenix", []);
    expect(existsSync(join(root, ".mcp.json"))).toBe(true);
  });
});

describe("Codex's TOML config is edited, not rewritten", () => {
  let root: string;
  beforeEach(() => (root = tempDir()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const config = () => join(root, ".codex", "config.toml");
  const write = (body: string) => {
    mkdirSync(join(root, ".codex"), { recursive: true });
    writeFileSync(config(), body, "utf8");
  };

  it("keeps the settings and the comments already in the file", () => {
    // Round-tripping through a serialiser would return the file with every
    // `# why we set this` deleted, to add four lines to a config we do not own.
    write('# our model choice, do not change\nmodel = "gpt-5"\n\n[tui]\nnotifications = true\n');
    runConsultAdd(root, "fenix", ["codex"]);

    const body = readFileSync(config(), "utf8");
    expect(body).toContain("# our model choice, do not change");
    expect(body).toContain('model = "gpt-5"');
    expect(body).toContain("[tui]");
    expect(body).toContain("[mcp_servers.open-wiki-fenix]");
  });

  it("keeps another MCP server the project already had", () => {
    write('[mcp_servers.theirs]\ncommand = "their-server"\n');
    runConsultAdd(root, "fenix", ["codex"]);
    const toml = parseToml(readFileSync(config(), "utf8")) as {
      mcp_servers: Record<string, unknown>;
    };
    expect(Object.keys(toml.mcp_servers).sort()).toEqual(["open-wiki-fenix", "theirs"]);
  });

  it("leaves one entry when added twice, because TOML forbids two of a table", () => {
    // Not tidiness: a second `[mcp_servers.open-wiki-fenix]` makes the file stop
    // parsing, so `ow consult add` run twice would break the configuration it
    // was asked to extend.
    runConsultAdd(root, "fenix", ["codex"]);
    runConsultAdd(root, "fenix", ["codex"]);
    const body = readFileSync(config(), "utf8");
    expect(body.match(/\[mcp_servers\.open-wiki-fenix\]/g)).toHaveLength(1);
    expect(() => parseToml(body)).not.toThrow();
  });

  it("keeps a table that merely follows ours", () => {
    runConsultAdd(root, "fenix", ["codex"]);
    writeFileSync(config(), `${readFileSync(config(), "utf8")}\n[tui]\nnotifications = true\n`);
    runConsultAdd(root, "fenix", ["codex"]);
    const toml = parseToml(readFileSync(config(), "utf8")) as { tui?: unknown };
    expect(toml.tui).toEqual({ notifications: true });
  });

  it("refuses a config.toml that will not parse", () => {
    write("this is = = not toml\n");
    expect(() => runConsultAdd(root, "fenix", ["codex"])).toThrow(UnparsableMcpConfigError);
    expect(readFileSync(config(), "utf8")).toBe("this is = = not toml\n");
  });

  it("quotes a key TOML would not accept bare", () => {
    // `.` is bare-*legal* and is TOML's dotted-key separator, so an unquoted
    // `open-wiki-my.project` would silently nest two tables instead of naming
    // one. Project names allow `.`, so this is reachable rather than theoretical.
    const body = tomlFor(root, "my.project");
    expect(body).toContain('[mcp_servers."open-wiki-my.project"]');
    const toml = parseToml(body) as { mcp_servers: Record<string, unknown> };
    expect(Object.keys(toml.mcp_servers)).toEqual(["open-wiki-my.project"]);
  });

  /**
   * What a security review destroyed the first version with.
   *
   * That version stripped a prior copy of our table with a line scanner: any
   * line whose trimmed text equalled the heading was treated as that heading,
   * including one inside a triple-quoted string. It deleted the closing quotes
   * and everything after, and wrote the wreckage back to a file this product
   * does not own — while `UnparsableMcpConfigError` reported nothing, because it
   * had checked the *original* text and the damage happened after.
   */
  describe("a heading that is not a heading", () => {
    const decoy =
      'notes = """\nExample entry, for reference:\n[mcp_servers.open-wiki-fenix]\ncommand = "ow"\n"""\n\n[tui]\nnotifications = true\n';

    it("does not eat a table named inside a multi-line string", () => {
      write(decoy);
      runConsultAdd(root, "fenix", ["codex"]);

      const body = readFileSync(config(), "utf8");
      // The file must still be TOML at all — this is what regressed.
      const toml = parseToml(body) as { notes: string; tui: unknown };
      expect(toml.tui).toEqual({ notifications: true });
      expect(toml.notes).toContain("[mcp_servers.open-wiki-fenix]");
    });

    it("adds the real entry beside it, without disturbing the decoy", () => {
      write(decoy);
      runConsultAdd(root, "fenix", ["codex"]);
      const toml = parseToml(readFileSync(config(), "utf8")) as {
        mcp_servers: Record<string, { command: string }>;
      };
      expect(toml.mcp_servers["open-wiki-fenix"]?.command).toBe("ow");
    });

    it("keeps trailing content when a lookalike is never followed by a real table", () => {
      // The other shape it broke on: everything from the decoy to EOF vanished.
      write('version = "1.2.3"\ndesc = """\n[mcp_servers.open-wiki-fenix]\n"""\nother = 1\n');
      runConsultAdd(root, "fenix", ["codex"]);
      const toml = parseToml(readFileSync(config(), "utf8")) as Record<string, unknown>;
      expect(toml["version"]).toBe("1.2.3");
      expect(toml["other"]).toBe(1);
    });
  });

  it("writes nothing at all when the entry is already exactly ours", () => {
    // The ordinary repeat. Not writing is what makes a re-run cost the user's
    // comments and ordering nothing, and it is what makes the rare rewrite
    // below an acceptable trade.
    write('# keep me\nmodel = "gpt-5"\n');
    runConsultAdd(root, "fenix", ["codex"]);
    const after = readFileSync(config(), "utf8");
    runConsultAdd(root, "fenix", ["codex"]);
    expect(readFileSync(config(), "utf8")).toBe(after);
    expect(after).toContain("# keep me");
  });

  it("repairs an entry somebody changed, even at the cost of formatting", () => {
    write('[mcp_servers.open-wiki-fenix]\ncommand = "not-ow"\n');
    runConsultAdd(root, "fenix", ["codex"]);
    const toml = parseToml(readFileSync(config(), "utf8")) as {
      mcp_servers: Record<string, { command: string; args: string[] }>;
    };
    expect(toml.mcp_servers["open-wiki-fenix"]).toEqual({
      command: "ow",
      args: ["mcp", "--project", "fenix", "--read-only"],
    });
  });

  it("refuses an mcp_servers that is not a table", () => {
    write('mcp_servers = "surprise"\n');
    expect(() => runConsultAdd(root, "fenix", ["codex"])).toThrow(UnparsableMcpConfigError);
  });

  function tomlFor(dir: string, name: string): string {
    runConsultAdd(dir, name, ["codex"]);
    return readFileSync(join(dir, ".codex", "config.toml"), "utf8");
  }
});

describe("a project name is validated before it reaches any config file", () => {
  let root: string;
  beforeEach(() => (root = tempDir()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("refuses a name with a control character in it", () => {
    // A security review wrote this one: `JSON.stringify` leaves a raw DEL
    // unescaped and TOML forbids it, so such a name produced a
    // `.codex/config.toml` Codex refuses to load — losing every entry in it,
    // not only ours. The name had never passed the registry's rule, because
    // this path registers nothing.
    expect(() => runConsultAdd(root, "ab", ["codex"])).toThrow(InvalidNameError);
    expect(existsSync(join(root, ".codex", "config.toml"))).toBe(false);
  });

  it("refuses a name that is a path", () => {
    expect(() => runConsultAdd(root, "../elsewhere")).toThrow(InvalidNameError);
    expect(() => runConsultAdd(root, "a\\b")).toThrow(InvalidNameError);
    expect(existsSync(join(root, ".mcp.json"))).toBe(false);
  });

  it("refuses a name carrying a quote", () => {
    expect(() => runConsultAdd(root, 'a"b', ["codex"])).toThrow(InvalidNameError);
  });

  it("takes exactly the names the registry takes", () => {
    expect(() => runConsultAdd(root, "fenix")).not.toThrow();
    expect(() => runConsultAdd(root, "my.project")).not.toThrow();
    expect(() => runConsultAdd(root, "a-b_c1")).not.toThrow();
  });
});
