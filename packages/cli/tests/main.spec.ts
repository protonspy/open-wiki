import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readManifest, uploadTextSource } from "@open-wiki/access";
import { main, parseInitArgs, usage } from "../src/main.js";
import { today } from "../src/date.js";

/**
 * The verb dispatch (plan 9.5, 9.12): every `ow` verb, including the ways each
 * one is asked for wrongly. A user error is a sentence on stderr and exit 2 —
 * never a stack, because the thing reading stderr is an agent.
 */

let out: string[];
let err: string[];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
});

afterEach(() => vi.restoreAllMocks());

const stdout = () => out.join("");
const stderr = () => err.join("");

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "ow-main-"));
  mkdirSync(join(root, "wiki"), { recursive: true });
  mkdirSync(join(root, "raw"), { recursive: true });
  mkdirSync(join(root, ".state"), { recursive: true });
  return root;
}

/** A page whose `updated` the gate fills, citing `sources`. */
function page(slug: string, title: string, body: string): string {
  return [
    "---",
    `id: concept:${slug}`,
    "type: concept",
    `title: ${title}`,
    "status: active",
    "aliases: []",
    'updated: ""',
    "sources: []",
    'superseded-by: ""',
    "---",
    body,
  ].join("\n");
}

describe("ow — usage and unknown verbs", () => {
  it("prints usage and succeeds when asked for help", async () => {
    for (const argv of [[], ["help"], ["--help"]]) {
      out = [];
      expect(await main(argv, process.cwd())).toBe(0);
      expect(stdout()).toContain("ow — open-wiki");
    }
  });

  it("prints usage and fails on a verb it does not have", async () => {
    expect(await main(["frobnicate"], process.cwd())).toBe(2);
    expect(stdout()).toContain("Usage:");
  });

  it("names every verb it dispatches in the usage text", () => {
    for (const verb of ["init", "write", "gate", "graph", "search", "source", "consult", "mcp"]) {
      expect(usage()).toContain(`ow ${verb}`);
    }
  });
});

describe("ow init", () => {
  let root: string;
  let appData: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    // `runInit` registers through the application data directory, which is
    // resolved from the environment; point it at a temp directory so the suite
    // does not touch the real registry. See tests/init.spec.ts for the detail.
    root = mkdtempSync(join(tmpdir(), "ow-main-init-"));
    appData = mkdtempSync(join(tmpdir(), "ow-main-appdata-"));
    savedEnv = { APPDATA: process.env["APPDATA"], HOME: process.env["HOME"] };
    process.env["APPDATA"] = appData;
    process.env["HOME"] = appData;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(appData, { recursive: true, force: true });
  });

  it("scaffolds the project it was run in and reports what it installed", async () => {
    expect(await main(["init", "--claude"], root)).toBe(0);
    expect(stdout()).toContain(`scaffolded ${root}`);
    expect(stdout()).toContain("gate:");
    expect(stdout()).toContain("entry:");
    expect(stdout()).not.toContain("registered as:");
    expect(existsSync(join(root, "wiki"))).toBe(true);
  });

  it("reports the name it registered when given one", async () => {
    expect(await main(["init", "--claude", "--language", "pt-BR", "--name", "fenix"], root)).toBe(
      0,
    );
    expect(stdout()).toContain("registered as: fenix");
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toContain("Brazilian Portuguese");
  });

  it("turns a refusal into a sentence on stderr, not a stack", async () => {
    expect(await main(["init", "--claude", "--language", "fr"], root)).toBe(2);
    expect(stderr()).toContain("--language must be one of");
    expect(stderr()).not.toContain("    at ");
  });
});

describe("ow write", () => {
  let root: string;
  let sourceId: string;

  beforeEach(() => {
    root = tempProject();
    sourceId = uploadTextSource(root, "Notes", "# Notes\n\nFenix is a rebuild.\n").id;
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("writes the page named by --content", async () => {
    const content = page("fenix", "Fenix", `Fenix — see src://${sourceId}#p1.\n`);
    expect(await main(["write", join(root, "wiki", "fenix.md"), "--content", content], root)).toBe(
      0,
    );
    expect(readFileSync(join(root, "wiki", "fenix.md"), "utf8")).toContain(`updated: ${today()}`);
  });

  it("writes the page named by --file", async () => {
    const content = page("lambda", "Lambda", `Lambda — see src://${sourceId}#p1.\n`);
    const src = join(root, "lambda.in.md");
    writeFileSync(src, content, "utf8");
    expect(await main(["write", join(root, "wiki", "lambda.md"), "--file", src], root)).toBe(0);
    expect(existsSync(join(root, "wiki", "lambda.md"))).toBe(true);
  });

  it("needs a path", async () => {
    expect(await main(["write"], root)).toBe(2);
    expect(stderr()).toContain("needs a path");
  });

  it("needs content from somewhere", async () => {
    expect(await main(["write", join(root, "wiki", "x.md")], root)).toBe(2);
    expect(stderr()).toContain("--content");
  });

  it("reports the gate's reason when the page is refused", async () => {
    const content = page("bogus", "Bogus", "See src://no-such-source#p1.\n");
    expect(await main(["write", join(root, "wiki", "bogus.md"), "--content", content], root)).toBe(
      2,
    );
    expect(stderr()).toContain("no-such-source");
    expect(existsSync(join(root, "wiki", "bogus.md"))).toBe(false);
  });
});

describe("ow read (9.14)", () => {
  // The socket module is tested where it lives. What is tested here is the
  // wiring that makes 9.14 user-visible at all — the verb a hook actually
  // runs. It is also the level at which "both paths produce the same answer"
  // is a thing a user would notice: with no application listening, `ow read`
  // has to print the page rather than fail because nothing answered.
  let root: string;
  beforeEach(() => {
    root = tempProject();
    writeFileSync(
      join(root, "wiki", "fenix.md"),
      page("fenix", "Fenix", "Fenix is a rebuild.\n"),
      "utf8",
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("prints the page when no application is listening", async () => {
    expect(await main(["read", "fenix"], root)).toBe(0);
    expect(stdout()).toContain("Fenix is a rebuild.");
  });

  it("needs a slug", async () => {
    expect(await main(["read"], root)).toBe(2);
    expect(stderr()).toContain("slug");
  });

  it("reports a page that is not there as a sentence, not a stack", async () => {
    expect(await main(["read", "ghost"], root)).toBe(2);
    expect(stderr()).toContain("ghost");
    expect(stderr()).not.toContain("    at ");
  });
});

describe("ow graph and ow search", () => {
  let root: string;
  beforeEach(() => {
    root = tempProject();
    writeFileSync(
      join(root, "wiki", "fenix.md"),
      page("fenix", "Fenix", "Fenix is a rebuild.\n"),
      "utf8",
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("prints the whole structure as JSON", async () => {
    expect(await main(["graph"], root)).toBe(0);
    expect(JSON.parse(stdout()).pages).toEqual(["fenix"]);
  });

  it("prints a named structural query as JSON", async () => {
    expect(await main(["graph", "orphans"], root)).toBe(0);
    expect(JSON.parse(stdout())).toEqual(["fenix"]);
  });

  it("prints search hits as JSON, joining a multi-word query", async () => {
    expect(await main(["search", "is", "a", "rebuild"], root)).toBe(0);
    expect(JSON.parse(stdout())).toEqual([{ slug: "fenix", title: "Fenix", matches: 1 }]);
  });

  it("needs a query to search for", async () => {
    expect(await main(["search"], root)).toBe(2);
    expect(stderr()).toContain("needs a query");
  });
});

describe("ow source (4.2, 4.3, 4.4)", () => {
  let root: string;
  beforeEach(() => {
    root = tempProject();
    uploadTextSource(root, "notes.md", "# Notes\n");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("lists the sources as JSON on stdout", async () => {
    expect(await main(["source", "list"], root)).toBe(0);
    expect((JSON.parse(stdout()) as Array<{ id: string }>).map((s) => s.id)).toEqual(["notes.md"]);
  });

  it("marks a source and then leaves it out of the queue", async () => {
    expect(await main(["source", "mark", "notes.md"], root)).toBe(0);
    expect(stdout()).toContain("marked");
    out = [];
    expect(await main(["source", "list", "--unprocessed"], root)).toBe(0);
    expect(JSON.parse(stdout())).toEqual([]);
  });

  it("says `already` rather than `marked` when nothing changed", async () => {
    await main(["source", "mark", "notes.md"], root);
    out = [];
    expect(await main(["source", "mark", "notes.md"], root)).toBe(0);
    // Reporting a write it did not make would train a loop to trust one.
    expect(stdout()).toContain("already");
    expect(stdout()).not.toContain("marked");
  });

  it("unmarks, putting the source back in the queue", async () => {
    await main(["source", "mark", "notes.md"], root);
    expect(await main(["source", "unmark", "notes.md"], root)).toBe(0);
    out = [];
    await main(["source", "list", "--unprocessed"], root);
    expect((JSON.parse(stdout()) as Array<{ id: string }>).map((s) => s.id)).toEqual(["notes.md"]);
  });

  it("dates the declaration the day it was made", async () => {
    await main(["source", "mark", "notes.md"], root);
    expect(stdout()).toContain(today());
  });

  it("is a sentence and exit 2 for an id that names no source", async () => {
    expect(await main(["source", "mark", "ghost"], root)).toBe(2);
    expect(stderr()).toContain("ghost");
    expect(stderr()).toContain("ow source list");
    expect(stderr()).not.toContain("Error:");
  });

  it("names what it takes when the subcommand is missing or wrong", async () => {
    expect(await main(["source"], root)).toBe(2);
    expect(await main(["source", "sideways"], root)).toBe(2);
    expect(stderr()).toContain("ow source list");
  });

  it("needs an id to mark or unmark", async () => {
    expect(await main(["source", "mark"], root)).toBe(2);
    expect(await main(["source", "unmark"], root)).toBe(2);
  });

  it("describes a source, taking the rest of the line as the text", async () => {
    // A description is prose and a shell has already split it on spaces.
    // Requiring quotes would make the common call the one that silently records
    // only its first word.
    const argv = ["source", "describe", "notes.md", "The", "Q3", "incident", "timeline."];
    expect(await main(argv, root)).toBe(0);
    expect(stdout()).toContain("described");
    expect(readManifest(root, "notes.md").description).toBe("The Q3 incident timeline.");
  });

  it("needs both an id and some text to describe", async () => {
    expect(await main(["source", "describe"], root)).toBe(2);
    expect(await main(["source", "describe", "notes.md"], root)).toBe(2);
    expect(await main(["source", "describe", "notes.md", "   "], root)).toBe(2);
  });

  it("names describe among the subcommands it takes", async () => {
    expect(await main(["source", "sideways"], root)).toBe(2);
    expect(stderr()).toContain("ow source describe");
  });
});

describe("parseInitArgs — --refresh-skills (5.3)", () => {
  it("is off unless asked for", () => {
    expect(parseInitArgs([]).refreshSkills).toBeUndefined();
    expect(parseInitArgs(["--language", "en"]).refreshSkills).toBeUndefined();
  });

  it("is read alongside the other flags", () => {
    expect(parseInitArgs(["--refresh-skills", "--name", "fenix"])).toEqual({
      harnesses: [],
      refreshSkills: true,
      name: "fenix",
    });
  });
});

describe("ow consult", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("adds the consult and says which key it wrote", async () => {
    expect(await main(["consult", "add", "fenix"], root)).toBe(0);
    expect(stdout()).toContain("open-wiki-fenix");
    expect(JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")).mcpServers).toHaveProperty(
      "open-wiki-fenix",
    );
  });

  it("has no subcommand but add", async () => {
    expect(await main(["consult", "remove", "fenix"], root)).toBe(2);
    expect(stderr()).toContain("ow consult add");
  });

  it("needs the name of the project to consult", async () => {
    expect(await main(["consult", "add"], root)).toBe(2);
    expect(stderr()).toContain("needs a project name");
  });
});

describe("ow gate", () => {
  it("takes pre or post and nothing else", async () => {
    expect(await main(["gate", "sideways"], process.cwd())).toBe(2);
    expect(stderr()).toContain("pre|post");
    expect(await main(["gate"], process.cwd())).toBe(2);
  });
});

describe("ow mcp", () => {
  it("refuses to start a server for no project — before touching stdio", async () => {
    await expect(main(["mcp", "--read-only"], process.cwd())).rejects.toThrow(/--project/);
  });
});

describe("parseInitArgs", () => {
  it("reads --language and --name, and defaults both to absent", () => {
    expect(parseInitArgs([])).toEqual({ harnesses: [] });
    expect(parseInitArgs(["--language", "pt-BR", "--name", "fenix"])).toEqual({
      harnesses: [],
      language: "pt-BR",
      name: "fenix",
    });
  });

  it("ignores an argument it does not know", () => {
    expect(parseInitArgs(["--colour", "blue", "--name", "fenix"])).toEqual({
      harnesses: [],
      name: "fenix",
    });
  });
});

describe("today", () => {
  it("formats the date the page schema accepts, zero-padded", () => {
    expect(today(new Date(2026, 7, 1))).toBe("2026-08-01");
    expect(today(new Date(2026, 11, 25))).toBe("2026-12-25");
  });
});
