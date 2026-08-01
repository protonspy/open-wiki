import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
 * Run the server. Resolves with an exit code once the stdio transport closes.
 * Throws when the project name cannot be resolved — the CLI turns that into a
 * stderr message and a non-zero exit.
 */
export async function runMcpServer(argv: string[]): Promise<number> {
  const { project } = parseMcpArgs(argv);
  const projectRoot = new ProjectRegistry().resolve(project);

  const server = new McpServer(
    { name: `open-wiki (${project})`, version: "0.0.0" },
    {
      instructions: `Read-only consult of the "${project}" wiki. Read the index for structure, a page for its content, the sources for their text. This server serves only this project and cannot write.`,
    },
  );
  registerTools(server, projectRoot);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  return 0;
}