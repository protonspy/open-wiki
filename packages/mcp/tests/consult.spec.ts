import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { uploadTextSource } from "@open-wiki/access";
import { createMcpServer } from "../src/index.js";

/**
 * The cross-project consult (plan 9.16): a second project with no wiki of its
 * own consults the first through a server named for it, and answers citing the
 * first's pages. Here the "second project" is the MCP client; the first is the
 * project the server was launched for. The server is driven over an in-memory
 * transport, so the test exercises the real protocol without stdio.
 */

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "ow-consult-"));
  mkdirSync(join(root, "wiki"), { recursive: true });
  mkdirSync(join(root, "raw"), { recursive: true });
  return root;
}

function writePage(root: string, slug: string, id: string, citation: string): void {
  const fm = [
    "---",
    `id: ${id}`,
    `type: concept`,
    `title: ${slug.charAt(0).toUpperCase()}${slug.slice(1)}`,
    "status: active",
    "aliases: []",
    "updated: 2026-08-01",
    `sources: [${citation}]`,
    'superseded-by: ""',
    "---",
    "",
    `# ${slug}`,
    "",
    `See ${citation} for the source.`,
    "",
  ].join("\n");
  writeFileSync(join(root, "wiki", `${slug}.md`), fm, "utf8");
}

describe("consult: a second project cites the first over MCP (9.16)", () => {
  let rootA: string;
  let sourceId: string;
  let client: Client;

  beforeEach(async () => {
    rootA = tempProject();
    const { id } = uploadTextSource(rootA, "Architecture Notes", "# Architecture\n\nFenix is a rebuild.\n");
    sourceId = id;
    writePage(rootA, "fenix", "concept:fenix", `src://${sourceId}#p1`);
    writeFileSync(join(rootA, "wiki", "index.md"), `# Index\n\n## Pages\n\n- [[fenix]] — Fenix\n`, "utf8");

    const server = createMcpServer(rootA, "project-a");
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(b);
  });
  afterEach(() => {
    client?.close?.();
    rmSync(rootA, { recursive: true, force: true });
  });

  it("announces the project in the server name (9.11)", () => {
    expect(client.getServerVersion()?.name).toBe("open-wiki (project-a)");
  });

  it("lists the first project's index as structure", async () => {
    const res = await client.callTool({ name: "ow_index", arguments: {} });
    const entries = JSON.parse(text(res));
    expect(entries.some((e: { slug: string }) => e.slug === "fenix")).toBe(true);
    const fenix = entries.find((e: { slug: string }) => e.slug === "fenix");
    expect(fenix.indexed).toBe(true);
    expect(fenix.status).toBe("active");
  });

  it("returns a page whole, carrying the citation a consulting agent would reuse", async () => {
    const res = await client.callTool({ name: "ow_read_page", arguments: { slug: "fenix" } });
    const page = JSON.parse(text(res));
    expect(page.slug).toBe("fenix");
    expect(page.content).toContain(`src://${sourceId}#p1`);
    expect(page.frontmatter.title).toBe("Fenix");
  });

  it("exposes the source and its text — the evidence behind the citation", async () => {
    const list = await client.callTool({ name: "ow_sources", arguments: {} });
    const sources = JSON.parse(text(list));
    expect(sources.some((s: { id: string }) => s.id === sourceId)).toBe(true);
    const src = sources.find((s: { id: string }) => s.id === sourceId);
    expect(src.hasText).toBe(true);

    const read = await client.callTool({ name: "ow_read_source", arguments: { id: sourceId } });
    expect(text(read)).toContain("Fenix is a rebuild.");
  });

  it("refuses a page slug that escapes the project — even over MCP", async () => {
    const res = await client.callTool({ name: "ow_read_page", arguments: { slug: "../../../etc/hosts" } });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("outside the project");
  });
});

/** Pull the text of the first content part from a CallToolResult. */
function text(res: unknown): string {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content;
  const part = content?.find((c) => c.type === "text");
  return part?.text ?? "";
}