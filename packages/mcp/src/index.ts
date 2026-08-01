import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import { ProjectRegistry } from "@open-wiki/access/read";
import {
  indexStructure,
  readPageWhole,
  listSourcesState,
  readSourceText,
} from "./tools.js";

/**
 * `ow mcp --project <name> --read-only` — the read-only MCP server (plan 9.7),
 * over stdio, spawned by the harness. It serves exactly the one project the
 * name resolves to, and imports only the read barrel (`@open-wiki/access/read`),
 * so read-only is what the process can do, not what it agrees to do (9.9).
 *
 * The name is resolved to a path through the registry — a cache, never a guess
 * (`adr:0013-the-project-directory-is-the-unit`): an unknown name is refused,
 * never searched for, never defaulted to the current directory.
 */

/** Parsed launch arguments. */
export interface McpArgs {
  project: string;
  readOnly: boolean;
}

/** Parse `--project <name>` and `--read-only` from the CLI tail. */
export function parseMcpArgs(argv: string[]): McpArgs {
  let project: string | undefined;
  let readOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--project") project = argv[++i];
    else if (a.startsWith("--project=")) project = a.slice("--project=".length);
    else if (a === "--read-only") readOnly = true;
  }
  if (!project) throw new Error("ow mcp: --project <name> is required");
  return { project, readOnly };
}

/** The read tools the server exposes (plan 9.10), wired to the project root. */
function registerTools(server: McpServer, projectRoot: string): void {
  server.tool(
    "ow_index",
    "List every entity page in the wiki as structure: slug, title, type, status, and whether the index links to it (false marks an orphan).",
    {},
    () => run(() => indexStructure(projectRoot)),
  );

  server.tool(
    "ow_read_page",
    "Return a page whole: its full markdown and its parsed frontmatter.",
    { slug: z.string().describe("the page slug (the wiki/ filename without .md)") },
    ({ slug }) => run(() => readPageWhole(projectRoot, slug)),
  );

  server.tool(
    "ow_sources",
    "List every source under raw/: its frozen id, its manifest (title, kind, original), and whether text.md is present.",
    {},
    () => run(() => listSourcesState(projectRoot)),
  );

  server.tool(
    "ow_read_source",
    "Return a source's text.md — the normalised text the citations point into.",
    { id: z.string().describe("the frozen source id (the raw/ directory name)") },
    ({ id }) => run(() => readSourceText(projectRoot, id)),
  );
}

/** Run a tool: a JSON text result on success, an error result on a thrown read. */
function run(fn: () => unknown) {
  try {
    return { content: [{ type: "text" as const, text: JSON.stringify(fn(), null, 2) }] };
  } catch (e) {
    return {
      content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }],
      isError: true,
    };
  }
}

/**
 * Build the server for a resolved project root, with the project name announced
 * in the server info and instructions (plan 9.11). Factored out of `runMcpServer`
 * so a test can drive it over an in-memory transport without resolving a name
 * through the registry or standing up stdio.
 */
export function createMcpServer(projectRoot: string, project: string): McpServer {
  const server = new McpServer(
    { name: `open-wiki (${project})`, version: "0.0.0" },
    {
      instructions: `Read-only consult of the "${project}" wiki. Read the index for structure, a page for its content, the sources for their text. This server serves only this project and cannot write.`,
    },
  );
  registerTools(server, projectRoot);
  return server;
}

/**
 * Serve until the transport closes, then resolve with an exit code.
 *
 * `connect` resolves as soon as the transport is *listening*, not when it is
 * done — so returning it is a server that exits before answering anything. The
 * caller exits the process on the resolved code, so the wait has to be here.
 * The harness closing its end of the pipe is what ends the session.
 *
 * Split out from `runMcpServer` so a test can hold both ends of an in-memory
 * transport and watch the lifetime, without stdio or the registry.
 */
export async function serveUntilClosed(server: McpServer, transport: Transport): Promise<number> {
  const closed = new Promise<void>((resolve) => {
    // The protocol's own callback, not the transport's: `connect` takes
    // ownership of the transport's handlers.
    server.server.onclose = () => resolve();
  });
  await server.connect(transport);
  await closed;
  return 0;
}

/**
 * Run the server. Resolves with an exit code once the stdio transport closes.
 * Throws when the project name cannot be resolved — the CLI turns that into a
 * stderr message and a non-zero exit.
 */
export async function runMcpServer(argv: string[]): Promise<number> {
  const { project } = parseMcpArgs(argv);
  const projectRoot = new ProjectRegistry().resolve(project);
  const server = createMcpServer(projectRoot, project);
  return serveUntilClosed(server, new StdioServerTransport());
}