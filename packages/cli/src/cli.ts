#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { runInit } from "./commands/init.js";
import { runWrite } from "./commands/write.js";
import { runGateCommand } from "./commands/gate.js";
import { runGraph } from "./commands/graph.js";
import { runSearch } from "./commands/search.js";
import { runConsultAdd } from "./commands/consult.js";

function usage(): string {
  return `ow — open-wiki

Usage:
  ow init [--language <en|pt-BR|es>] [--name <name>]   scaffold a project and install the gate
  ow write <path> [--content <text> | --file <path>]   write a page through the gate (no-hook path)
  ow gate pre|post                                     the hook handlers (read JSON on stdin)
  ow graph [superseded|orphans|index]                  structural queries, as JSON
  ow search <query>                                    lexical search over the wiki, as JSON
  ow consult add <name>                                add a read-only consult of another project
  ow mcp --project <name> --read-only                  run the read-only MCP server`;
}

function today(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function fail(msg: string): number {
  process.stderr.write(`${msg}\n`);
  return 2;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const projectRoot = process.cwd();

  switch (cmd) {
    case "init": {
      const opts = parseInitArgs(argv.slice(1));
      try {
        const result = runInit(opts);
        process.stdout.write(
          [
            `scaffolded ${result.projectRoot}`,
            `  skills: written [${result.skills.written.join(", ")}] skipped [${result.skills.skipped.join(", ")}]`,
            `  hooks: ${result.hooks}`,
            `  claude.md: ${result.claudeMd}`,
            result.registeredName ? `  registered as: ${result.registeredName}` : "",
          ]
            .filter(Boolean)
            .join("\n") + "\n",
        );
        return 0;
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    }

    case "write": {
      const args = argv.slice(1);
      const path = args[0];
      if (!path) return fail("ow write needs a path");
      let content: string;
      const ci = args.indexOf("--content");
      const fi = args.indexOf("--file");
      if (ci >= 0) content = args[ci + 1] ?? "";
      else if (fi >= 0) content = readFileSync(args[fi + 1] ?? "", "utf8");
      else return fail("ow write needs --content <text> or --file <path>");
      const result = runWrite(projectRoot, path, content, today());
      if (!result.ok) return fail(result.reason);
      return 0;
    }

    case "gate": {
      const kind = argv[1];
      if (kind !== "pre" && kind !== "post") return fail("ow gate needs pre|post");
      return runGateCommand(kind);
    }

    case "graph": {
      process.stdout.write(runGraph(projectRoot, argv[1]) + "\n");
      return 0;
    }

    case "search": {
      const query = argv.slice(1).join(" ");
      if (!query) return fail("ow search needs a query");
      process.stdout.write(runSearch(projectRoot, query) + "\n");
      return 0;
    }

    case "consult": {
      if (argv[1] !== "add") return fail("ow consult add <name>");
      const name = argv[2];
      if (!name) return fail("ow consult add needs a project name");
      const key = runConsultAdd(projectRoot, name);
      process.stdout.write(`added consult "${key}" to .mcp.json\n`);
      return 0;
    }

    case "mcp": {
      const { runMcpServer } = await import("@open-wiki/mcp");
      return runMcpServer(argv.slice(1));
    }

    default:
      process.stdout.write(usage() + "\n");
      return cmd === undefined || cmd === "help" || cmd === "--help" ? 0 : 2;
  }
}

function parseInitArgs(args: string[]): {
  language?: string;
  name?: string;
} {
  const opts: { language?: string; name?: string } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--language") opts.language = args[++i];
    else if (args[i] === "--name") opts.name = args[++i];
  }
  return opts;
}

main().then((code) => process.exit(code));