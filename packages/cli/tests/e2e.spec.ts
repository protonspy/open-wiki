import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  uploadTextSource,
  validatePage,
  resolveProvenance,
  listEntityPages,
  readIndex,
  findOrphans,
} from "@open-wiki/access";
import { runWrite } from "../src/commands/write.js";
import { runPreToolUse, runPostToolUse } from "../src/hooks.js";
import { runGraph } from "../src/commands/graph.js";
import { runSearch } from "../src/commands/search.js";

/**
 * The end-to-end the MVP exists to answer (plan 9.15): an agent, working inside
 * a project and starting from a single source, builds a valid page that cites it,
 * and the store keeps its promise — the page validates, the index reaches it, and
 * the citation resolves. Both doors to the store are exercised: the Pre/PostToolUse
 * hook path the agent actually goes through, and the `ow write` verb for a harness
 * with no hooks. Both must produce the same answer.
 */

const DATE = "2026-08-01";

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "ow-e2e-"));
  mkdirSync(join(root, "wiki"), { recursive: true });
  mkdirSync(join(root, "raw"), { recursive: true });
  mkdirSync(join(root, ".state"), { recursive: true });
  return root;
}

/** Frontmatter for a concept page citing a source, with `updated` left for the gate to fill. */
function pageFrontmatter(slug: string, title: string, sources: string): string {
  return [
    "id: concept:" + slug,
    "type: concept",
    "title: " + title,
    "status: active",
    "aliases: []",
    'updated: ""',
    "sources: " + sources,
    'superseded-by: ""',
  ].join("\n");
}

function page(slug: string, title: string, sources: string, body: string): string {
  return `---\n${pageFrontmatter(slug, title, sources)}\n---\n${body}`;
}

describe("e2e: agent builds and cites a page (9.15)", () => {
  let root: string;
  let sourceId: string;

  beforeEach(() => {
    root = tempProject();
    // A single uploaded markdown source — the MVP's "one uploaded markdown file".
    const { id } = uploadTextSource(root, "Architecture Notes", "# Architecture\n\nFenix is a rebuild.\n");
    sourceId = id;
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("writes a valid, indexed, cited page through the hook path", () => {
    const citation = `src://${sourceId}#p1`;
    const body = `Fenix is a rebuild — see ${citation}.\n`;
    const content = page("fenix", "Fenix", "[]", body);

    // The agent's Write tool is intercepted by PreToolUse: the gate completes the
    // frontmatter (filling `updated` and mirroring the body's citation into
    // `sources`) and returns the completed content as updatedInput.
    const pre = runPreToolUse(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        cwd: root,
        tool_use_id: "tu_1",
        tool_input: { file_path: join(root, "wiki", "fenix.md"), content },
      },
      root,
      DATE,
    );
    expect(pre?.hookSpecificOutput.permissionDecision).toBe("allow");
    const completed = (pre?.hookSpecificOutput.updatedInput as { content: string }).content;
    expect(completed).toContain("updated: 2026-08-01");
    expect(completed).toContain(citation);

    // The agent's tool performs the write with the completed content; PostToolUse
    // then records the log, the changelog and the index entry.
    writeFileSync(join(root, "wiki", "fenix.md"), completed, "utf8");
    runPostToolUse(
      {
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        cwd: root,
        tool_use_id: "tu_1",
        tool_input: { file_path: join(root, "wiki", "fenix.md"), content: "" },
        tool_response: {},
      },
      root,
      DATE,
    );

    // The page validates, the citation resolves, the index reaches it.
    const onDisk = readFileSync(join(root, "wiki", "fenix.md"), "utf8");
    const v = validatePage(onDisk, "fenix");
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(resolveProvenance(root, v.frontmatter.sources)).toEqual([]);
      expect(v.frontmatter.sources).toContain(citation);
    }
    expect(readIndex(root)).toContain("[[fenix]]");
    expect(listEntityPages(root)).toContain("fenix");
    expect(findOrphans(root)).not.toContain("fenix");
  });

  it("writes a valid, indexed, cited page through the CLI verb — the same answer", () => {
    const citation = `src://${sourceId}#p1`;
    const body = `Lambda carries Fenix forward — see ${citation}.\n`;
    const content = page("lambda", "Lambda", "[]", body);

    const result = runWrite(root, join(root, "wiki", "lambda.md"), content, DATE);
    expect(result.ok).toBe(true);

    const onDisk = readFileSync(join(root, "wiki", "lambda.md"), "utf8");
    const v = validatePage(onDisk, "lambda");
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(resolveProvenance(root, v.frontmatter.sources)).toEqual([]);
      expect(v.frontmatter.sources).toContain(citation);
    }
    expect(readIndex(root)).toContain("[[lambda]]");
    expect(findOrphans(root)).not.toContain("lambda");
  });

  it("both paths land pages the structural and lexical queries agree on", () => {
    // Hook path: fenix.
    const c1 = `src://${sourceId}#p1`;
    writeViaHook(root, "fenix", "Fenix", `Fenix is a rebuild — see ${c1}.\n`);
    // Verb path: lambda.
    const c2 = `src://${sourceId}#p1`;
    runWrite(root, join(root, "wiki", "lambda.md"), page("lambda", "Lambda", "[]", `Lambda — see ${c2}.\n`), DATE);

    // graph: two pages, neither orphaned.
    const graph = JSON.parse(runGraph(root, undefined));
    expect([...graph.pages].sort()).toEqual(["fenix", "lambda"]);
    expect(graph.orphans).toEqual([]);

    // search: a term in the Fenix page lands on it.
    const hits = JSON.parse(runSearch(root, "rebuild"));
    expect(hits.some((h: { slug: string }) => h.slug === "fenix")).toBe(true);
  });

  it("the gate refuses a page whose citation points at no source", () => {
    const body = `See src://no-such-source#p1.\n`;
    const content = page("bogus", "Bogus", "[]", body);
    const pre = runPreToolUse(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        cwd: root,
        tool_use_id: "tu_b",
        tool_input: { file_path: join(root, "wiki", "bogus.md"), content },
      },
      root,
      DATE,
    );
    expect(pre?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(pre?.hookSpecificOutput.permissionDecisionReason ?? "").toContain("no-such-source");
    expect(existsSync(join(root, "wiki", "bogus.md"))).toBe(false);
  });
});

/** Drive a page through the hook path and return the on-disk content. */
function writeViaHook(root: string, slug: string, title: string, body: string): string {
  const content = page(slug, title, "[]", body);
  const pre = runPreToolUse(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      cwd: root,
      tool_use_id: `tu_${slug}`,
      tool_input: { file_path: join(root, "wiki", `${slug}.md`), content },
    },
    root,
    DATE,
  );
  const completed = (pre?.hookSpecificOutput.updatedInput as { content: string }).content ?? content;
  writeFileSync(join(root, "wiki", `${slug}.md`), completed, "utf8");
  runPostToolUse(
    {
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      cwd: root,
      tool_use_id: `tu_${slug}`,
      tool_input: { file_path: join(root, "wiki", `${slug}.md`), content: "" },
      tool_response: {},
    },
    root,
    DATE,
  );
  return completed;
}