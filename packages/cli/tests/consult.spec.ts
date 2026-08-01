import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConsultAdd } from "../src/commands/consult.js";

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
    expect(runConsultAdd(root, "fenix")).toBe("open-wiki-fenix");
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

  it("starts over from a .mcp.json that will not parse", () => {
    writeFileSync(join(root, ".mcp.json"), "{ not json", "utf8");
    runConsultAdd(root, "fenix");
    expect(Object.keys(readMcp(root).mcpServers)).toEqual(["open-wiki-fenix"]);
  });
});
