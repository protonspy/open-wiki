import { readFileSync } from "node:fs";
import { runInit } from "./commands/init.js";
import { runWrite } from "./commands/write.js";
import { runGateCommand } from "./commands/gate.js";
import { runGraph } from "./commands/graph.js";
import { runSearch } from "./commands/search.js";
import { runConsultAdd } from "./commands/consult.js";
import { parseCheckArgs, runCheck, CHECK_FAILED_TO_RUN } from "./commands/check.js";
import { today } from "./date.js";

/**
 * The `ow` verb dispatch. It lives here rather than in `cli.ts` so it is a
 * function a test can call: `cli.ts` is the process entrypoint and does the two
 * things a test must not — read `process.argv` and call `process.exit`.
 *
 * Every verb returns an exit code; nothing here throws for a user error, so the
 * agent reading stderr gets a sentence rather than a stack.
 */

export function usage(): string {
  return `ow — open-wiki

Usage:
  ow init [--language <en|pt-BR|es>] [--name <name>]   scaffold a project and install the gate
  ow write <path> [--content <text> | --file <path>]   write a page through the gate (no-hook path)
  ow gate pre|post                                     the hook handlers (read JSON on stdin)
  ow check [--json] [--errors-only]                    the integrity checks; exit 2 means errors
  ow graph [superseded|orphans|index]                  structural queries, as JSON
  ow search <query>                                    lexical search over the wiki, as JSON
  ow consult add <name>                                add a read-only consult of another project
  ow mcp --project <name> --read-only                  run the read-only MCP server`;
}

function fail(msg: string): number {
  process.stderr.write(`${msg}\n`);
  return 2;
}

/**
 * Run one `ow` invocation. `argv` is the tail after the program name, and
 * `projectRoot` is the directory the verb acts on — the process's working
 * directory in production, a temp project in a test.
 */
export async function main(argv: string[], projectRoot: string = process.cwd()): Promise<number> {
  const cmd = argv[0];

  switch (cmd) {
    case "init": {
      const opts = parseInitArgs(argv.slice(1));
      try {
        const result = runInit({ projectRoot, ...opts });
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

    case "check": {
      try {
        const { stdout, code } = runCheck(projectRoot, parseCheckArgs(argv.slice(1)));
        process.stdout.write(stdout);
        return code;
      } catch (err) {
        // Exit 1 is "the check could not run", which is a different thing from
        // "the check ran and found something" (exit 2). A CI job acts on the
        // difference.
        process.stderr.write(
          `ow check could not run: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        return CHECK_FAILED_TO_RUN;
      }
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

export function parseInitArgs(args: string[]): {
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
