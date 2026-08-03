import { readFileSync } from "node:fs";
import { runInit, staleSkillsNotice } from "./commands/init.js";
import { runWrite } from "./commands/write.js";
import { runGateCommand } from "./commands/gate.js";
import { runGraph } from "./commands/graph.js";
import { runSearch } from "./commands/search.js";
import { runConsultAdd } from "./commands/consult.js";
import { parseCheckArgs, runCheck, CHECK_FAILED_TO_RUN } from "./commands/check.js";
import { parseExportArgs, runExport } from "./commands/export.js";
import {
  runSourceDescribe,
  runSourceList,
  runSourceMark,
  runSourceSupersede,
} from "./commands/source.js";
import { askRunningApp, handleRequest } from "@open-wiki/access/socket";
import { existsSync } from "node:fs";
import {
  HARNESSES,
  isHarness,
  readSettings,
  safe,
  settingsPath,
  type Harness,
} from "@open-wiki/access";
import { hasTerminal, pickHarnesses } from "./commands/pick.js";
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
  ow init [--claude] [--codex] [--opencode]            scaffold a project and install the gate
       [--language <en|pt-BR|es>] [--name <name>]      …name one or more harnesses; a picker asks
       [--refresh-skills]                              …rewriting skills this build has moved past
  ow write <path> [--content <text> | --file <path>]   write a page through the gate (no-hook path)
  ow gate pre|post                                     the hook handlers (read JSON on stdin)
  ow read <slug>                                       print a page, through the running app when there is one
  ow check [--json] [--errors-only]                    the integrity checks; exit 2 means errors
  ow graph [superseded|orphans|index]                  structural queries, as JSON
  ow search <query>                                    lexical search over the wiki, as JSON
  ow source list [--unprocessed]                       the sources, as JSON; --unprocessed is the queue
  ow source mark <id>                                  record that this source has been read
  ow source unmark <id>                                withdraw that record
  ow source describe <id> <text>                       record what this source is about
  ow source supersede <id> <replacement-id>            record that a source was replaced
  ow export [--out <path>] [--no-sources] [--survey]   write the project as one zip, outside it
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
        // The three-way contract of the plan's third divergence: a harness
        // named scaffolds it and asks nothing; none named with a terminal
        // attached opens the picker; none named and no terminal refuses. A
        // project that already records its harnesses answers for itself, so an
        // idempotent re-run (`ow init --language pt-BR`) asks nothing either.
        let harnesses = opts.harnesses;
        if (harnesses.length === 0 && needsAnAnswer(projectRoot)) {
          if (!hasTerminal()) return fail(noHarnessNamed());
          harnesses = await pickHarnesses();
          if (harnesses.length === 0) return fail(noHarnessChosen());
        }

        const result = runInit({ projectRoot, ...opts, harnesses });
        process.stdout.write(
          [
            `scaffolded ${result.projectRoot}`,
            `  harnesses: ${result.harnesses.join(", ")}`,
            `  skills: written [${result.skills.written.join(", ")}] skipped [${result.skills.skipped.join(", ")}]`,
            `  gate: ${result.hooks.join(", ")}`,
            `  entry: ${result.entryFiles.join(", ")}`,
            result.registeredName ? `  registered as: ${result.registeredName}` : "",
            staleSkillsNotice(result.skills.outdated),
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

    case "read": {
      // 9.14 — the socket first, standalone when nothing is listening. The
      // application already has this project open more often than not, and a
      // hook fires this on every page write.
      const slug = argv[1];
      if (!slug) return fail("ow read needs a page slug");
      const answered = await askRunningApp(projectRoot, { verb: "read", args: [slug] });
      const result = answered ?? handleRequest(projectRoot, { verb: "read", args: [slug] });
      if (!result.ok) return fail(result.error);
      process.stdout.write(String(result.result));
      return 0;
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

    case "export": {
      const result = await runExport(projectRoot, parseExportArgs(argv.slice(1)), today());
      if (!result.ok) return fail(result.reason);
      process.stdout.write(result.stdout);
      return 0;
    }

    case "source": {
      const sub = argv[1];
      if (sub === "list") {
        process.stdout.write(runSourceList(projectRoot, argv.includes("--unprocessed")) + "\n");
        return 0;
      }
      if (sub === "mark" || sub === "unmark") {
        const id = argv[2];
        if (!id) return fail(`ow source ${sub} needs a source id`);
        const outcome = runSourceMark(projectRoot, id, sub === "mark", today());
        if (!outcome.ok) return fail(outcome.reason);
        // It says which of the two happened. "Already marked" reported as
        // "marked" would train a loop to trust a write it did not make.
        const { changed, processed } = outcome.result;
        const what = processed ? `processed on ${processed}` : "unprocessed";
        process.stdout.write(`${changed ? "marked" : "already"} "${safe(id)}" ${what}\n`);
        return 0;
      }
      if (sub === "describe") {
        const id = argv[2];
        // The rest of the line, joined. A description is prose and a shell has
        // already split it on spaces; requiring quotes would make the common
        // call the one that silently records only its first word.
        const text = argv.slice(3).join(" ").trim();
        if (!id) return fail("ow source describe needs a source id");
        if (!text) return fail("ow source describe needs the description after the id");
        const outcome = runSourceDescribe(projectRoot, id, text);
        if (!outcome.ok) return fail(outcome.reason);
        process.stdout.write(`described "${safe(id)}"\n`);
        return 0;
      }
      if (sub === "supersede") {
        const id = argv[2];
        const replacement = argv[3];
        if (!id) return fail("ow source supersede needs the source that was replaced");
        if (!replacement)
          return fail("ow source supersede needs the id of the source replacing it");
        const outcome = runSourceSupersede(projectRoot, id, replacement, today());
        if (!outcome.ok) return fail(outcome.reason);
        process.stdout.write(`superseded "${safe(id)}" by "${safe(replacement)}"\n`);
        return 0;
      }
      return fail(
        "ow source list [--unprocessed] | ow source mark <id> | ow source unmark <id> | " +
          "ow source describe <id> <text> | ow source supersede <id> <replacement-id>",
      );
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

/**
 * `ow init`'s arguments, including the harnesses (2.3).
 *
 * **A harness is a flag per harness, and more than one is accepted.** Not
 * `--harness <name>` repeated, because the set is closed and small, and a flag
 * that spells the answer is the one a person guesses right the first time.
 * `--claude --codex` scaffolds both, which is the whole point of `adr:0024`'s
 * plural: a team with one person on each is the normal case.
 */
export function parseInitArgs(args: string[]): {
  language?: string;
  name?: string;
  refreshSkills?: boolean;
  harnesses: Harness[];
} {
  const opts: {
    language?: string;
    name?: string;
    refreshSkills?: boolean;
    harnesses: Harness[];
  } = { harnesses: [] };
  const named = new Set<Harness>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--language") opts.language = args[++i];
    else if (arg === "--name") opts.name = args[++i];
    else if (arg === "--refresh-skills") opts.refreshSkills = true;
    else if (arg.startsWith("--") && isHarness(arg.slice(2))) named.add(arg.slice(2) as Harness);
  }
  opts.harnesses = HARNESSES.filter((h) => named.has(h));
  return opts;
}

/**
 * What to say when nobody named a harness and there is no terminal to ask at.
 *
 * **It refuses rather than guessing, and that is a decision with a reason**
 * (the plan's third divergence). In `scc`, guessing wrong is discovered
 * immediately by the person who guessed, because they are the only user of that
 * workspace. Here the convention is *committed* (`adr:0013`), so a project
 * scaffolded for the wrong harness looks perfect to whoever ran `ow init` and
 * gives nothing to the colleague who clones it next week — which is precisely
 * the failure this whole plan exists to end, reproduced one level up.
 *
 * A refusal costs one second and one flag. A wrong scaffold costs somebody a
 * week and looks like the product not working.
 */
/**
 * Whether `ow init` has to ask which harness this project is for.
 *
 * **Only a project that does not exist yet is asked.** An `ow.json` on disk
 * means somebody already scaffolded this directory, and an absent or empty
 * `harnesses` there means they did it before that key existed — which
 * `ProjectSettings` is explicit is *not* the same as "none wanted". Asking such
 * a project would turn an idempotent re-run into a refusal: `ow init --language
 * pt-BR` in CI, against a project created last month, would exit 2 for want of
 * an answer nobody needed to give.
 *
 * The plan's breaking change is that a *new* project must name a harness. It
 * was never that an existing one loses its headless re-run, and reading the two
 * cases off the same `harnesses.length === 0` conflated them.
 */
function needsAnAnswer(projectRoot: string): boolean {
  if (existsSync(settingsPath(projectRoot))) return false;
  return readSettings(projectRoot).harnesses.length === 0;
}

/**
 * What to say when the picker was offered and nothing was ticked.
 *
 * Distinct from the refusal above, because the two are different situations
 * with different fixes: one is a script that has to be edited, the other is a
 * person who has just been asked and answered "none". Telling the second one to
 * pass a flag would be answering a question they did not ask.
 */
export function noHarnessChosen(): string {
  return [
    "No harness chosen, so nothing was scaffolded — the convention would have had nowhere to live.",
    `Run \`ow init\` again and choose at least one, or name them: ${HARNESSES.map((h) => `--${h}`).join(" ")}.`,
  ].join("\n");
}

export function noHarnessNamed(): string {
  const flags = HARNESSES.map((h) => `--${h}`).join(" ");
  return [
    "ow init needs to know which harness this project is for, and there is no terminal to ask at.",
    `Name one or more: ${flags} — for example \`ow init --claude --codex\`.`,
    "It is not guessed: the convention is committed, so a project scaffolded for the wrong",
    "harness looks right to you and gives nothing to whoever clones it.",
  ].join("\n");
}
