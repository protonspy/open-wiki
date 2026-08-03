import { describe, expect, it } from "vitest";
import {
  HARNESSES,
  PROFILES,
  entryFilesFor,
  harnessesSharingEntryFile,
  isHarness,
  managedPaths,
  profileFor,
  profilesFor,
  type Harness,
} from "../src/harness.js";

/**
 * The profile of 2.1, asserted against what [[what-a-harness-loads]] recorded
 * from each harness's own source — never against the shape of the file below
 * it. A test that reads the implementation to decide what to assert would
 * encode a wrong path as faithfully as a right one, and a wrong path here is
 * the failure the whole plan exists to end: files on disk the harness never
 * reads.
 */

describe("the harnesses (2.1)", () => {
  it("names exactly the three this plan is about", () => {
    expect(HARNESSES).toEqual(["claude", "codex", "opencode"]);
  });

  it("recognises a harness by name, and refuses anything else", () => {
    expect(isHarness("codex")).toBe(true);
    expect(isHarness("cursor")).toBe(false);
    expect(isHarness("")).toBe(false);
    expect(isHarness("Claude")).toBe(false);
  });

  it("has a profile for every harness, keyed by its own id", () => {
    for (const h of HARNESSES) {
      expect(PROFILES[h]).toBeDefined();
      expect(PROFILES[h].id).toBe(h);
      expect(PROFILES[h].label).not.toBe("");
    }
  });
});

describe("what each harness loads", () => {
  it("reads the entry file its source says it reads", () => {
    expect(profileFor("claude").entryFile).toBe("CLAUDE.md");
    // Codex and opencode both read AGENTS.md — the collision 2.2 has to decide.
    expect(profileFor("codex").entryFile).toBe("AGENTS.md");
    expect(profileFor("opencode").entryFile).toBe("AGENTS.md");
  });

  it("keeps project-local skills where that harness looks for them", () => {
    // All three read SKILL.md from a project-local directory. The plan assumed
    // only Claude Code did; reading the sources said otherwise.
    expect(profileFor("claude").skillsDir).toBe(".claude/skills");
    expect(profileFor("codex").skillsDir).toBe(".codex/skills");
    expect(profileFor("opencode").skillsDir).toBe(".opencode/skills");
  });

  it("names the MCP file and the schema that file is in", () => {
    expect(profileFor("claude").mcp).toEqual({
      file: ".mcp.json",
      format: "json",
      serversKey: "mcpServers",
    });
    // Codex keeps servers in TOML inside its own config file, not a file of its
    // own — the difference a writer assuming JSON everywhere would get wrong.
    expect(profileFor("codex").mcp).toEqual({
      file: ".codex/config.toml",
      format: "toml",
      serversKey: "mcp_servers",
    });
    expect(profileFor("opencode").mcp).toEqual({
      file: "opencode.json",
      format: "json",
      serversKey: "mcp",
    });
  });

  it("carries an interception for all three, because all three have one", () => {
    for (const h of HARNESSES) {
      const gate = profileFor(h).gate;
      expect(gate, `${h} can refuse a write; the profile must say so`).not.toBeNull();
      expect(gate?.configFile).not.toBe("");
      expect(gate?.describes).not.toBe("");
    }
  });

  it("declares Codex's and Claude Code's gates as hooks, and opencode's as a plugin", () => {
    expect(profileFor("claude").gate?.mechanism).toBe("hook");
    expect(profileFor("codex").gate?.mechanism).toBe("hook");
    expect(profileFor("opencode").gate?.mechanism).toBe("plugin");
  });
});

describe("no profile names another harness's directory", () => {
  /** The directory that belongs to each harness and to no other. */
  const OWN: Record<Harness, string> = {
    claude: ".claude/",
    codex: ".codex/",
    opencode: ".opencode/",
  };

  it("keeps every path in a profile out of the other harnesses' directories", () => {
    for (const h of HARNESSES) {
      const foreign = HARNESSES.filter((o) => o !== h).map((o) => OWN[o]);
      for (const path of managedPaths(profileFor(h))) {
        for (const dir of foreign) {
          expect(path, `${h}'s profile must not name ${dir}`).not.toContain(dir);
        }
      }
    }
  });
});

describe("managedPaths", () => {
  it("lists everything this product writes for a harness", () => {
    expect(managedPaths(profileFor("claude"))).toEqual([
      "CLAUDE.md",
      ".claude/skills",
      ".mcp.json",
      // `.claude/settings.json`, under a `hooks` key — a standalone
      // `.claude/hooks/hooks.json` at a project root is never read, and is a
      // plugin's mechanism only.
      ".claude/settings.json",
    ]);
  });

  it("omits the gate's file for a harness that has no interception", () => {
    const gateless = { ...profileFor("codex"), gate: null };
    expect(managedPaths(gateless)).toEqual(["AGENTS.md", ".codex/skills", ".codex/config.toml"]);
  });
});

describe("profilesFor", () => {
  it("answers in HARNESSES order rather than the caller's", () => {
    expect(profilesFor(["opencode", "claude"]).map((p) => p.id)).toEqual(["claude", "opencode"]);
  });

  it("ignores a harness named twice, and answers empty for none", () => {
    expect(profilesFor(["codex", "codex"]).map((p) => p.id)).toEqual(["codex"]);
    expect(profilesFor([])).toEqual([]);
  });
});

describe("the AGENTS.md collision", () => {
  it("reports both harnesses that read one entry file", () => {
    const both = profilesFor(["codex", "opencode"]);
    expect(harnessesSharingEntryFile(both, "AGENTS.md").map((p) => p.id)).toEqual([
      "codex",
      "opencode",
    ]);
  });

  it("needs one entry file for Codex and opencode together, not two", () => {
    expect(entryFilesFor(profilesFor(["codex", "opencode"]))).toEqual(["AGENTS.md"]);
  });

  it("needs two when Claude Code is in the set", () => {
    expect(entryFilesFor(profilesFor(HARNESSES))).toEqual(["CLAUDE.md", "AGENTS.md"]);
  });

  it("names no file for no harnesses", () => {
    expect(entryFilesFor([])).toEqual([]);
  });
});
