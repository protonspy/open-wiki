import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGraph } from "../src/commands/graph.js";
import { runSearch } from "../src/commands/search.js";
import { runWrite, relativePath } from "../src/commands/write.js";

/**
 * The structural and lexical queries (plan 9.12), and the `ow write` verb's
 * answers for the pages it does not own. Both read whatever is on disk,
 * including pages the gate never saw, so what is pinned here is that a page
 * with unreadable frontmatter is described by what is knowable rather than
 * crashing the query.
 */

const DATE = "2026-08-01";

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "ow-queries-"));
  mkdirSync(join(root, "wiki"), { recursive: true });
  mkdirSync(join(root, "raw"), { recursive: true });
  mkdirSync(join(root, ".state"), { recursive: true });
  return root;
}

function writePageFile(root: string, slug: string, frontmatter: string[], body: string): void {
  writeFileSync(
    join(root, "wiki", `${slug}.md`),
    `---\n${frontmatter.join("\n")}\n---\n${body}`,
    "utf8",
  );
}

function active(slug: string, title: string): string[] {
  return [
    `id: concept:${slug}`,
    "type: concept",
    `title: ${title}`,
    "status: active",
    "aliases: []",
    `updated: ${DATE}`,
    "sources: []",
    'superseded-by: ""',
  ];
}

describe("ow graph (9.12)", () => {
  let root: string;
  beforeEach(() => {
    root = tempProject();
    writePageFile(root, "fenix", active("fenix", "Fenix"), "Fenix is a rebuild.\n");
    writePageFile(
      root,
      "monolith",
      [
        "id: concept:monolith",
        "type: concept",
        "title: Monolith",
        "status: superseded",
        "aliases: []",
        `updated: ${DATE}`,
        "sources: []",
        "superseded-by: fenix",
      ],
      "What Fenix replaced.\n",
    );
    writeFileSync(join(root, "wiki", "index.md"), "# Index\n\n- [[fenix]] — Fenix\n", "utf8");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("walks supersession, carrying what supersedes each page and when", () => {
    expect(JSON.parse(runGraph(root, "superseded"))).toEqual([
      { slug: "monolith", "superseded-by": "fenix", updated: DATE },
    ]);
  });

  it("lists the pages the index actually reaches", () => {
    expect(JSON.parse(runGraph(root, "index"))).toEqual(["fenix"]);
  });

  it("lists the pages the index does not reach", () => {
    expect(JSON.parse(runGraph(root, "orphans"))).toEqual(["monolith"]);
  });

  it("answers the whole structure when asked for no query in particular", () => {
    const graph = JSON.parse(runGraph(root, undefined));
    expect([...graph.pages].sort()).toEqual(["fenix", "monolith"]);
    expect(graph.orphans).toEqual(["monolith"]);
    expect(graph.superseded.map((s: { slug: string }) => s.slug)).toEqual(["monolith"]);
  });

  it("skips a page whose frontmatter will not parse rather than failing the query", () => {
    writeFileSync(join(root, "wiki", "broken.md"), "---\n: : :\n---\n\nBroken.\n", "utf8");
    writeFileSync(join(root, "wiki", "bare.md"), "# Bare\n\nNo frontmatter.\n", "utf8");
    const graph = JSON.parse(runGraph(root, undefined));
    expect(graph.pages).toContain("broken");
    expect(graph.superseded.map((s: { slug: string }) => s.slug)).toEqual(["monolith"]);
  });

  it("records a supersession with no target as one, rather than dropping it", () => {
    writePageFile(
      root,
      "orphaned-supersession",
      [
        "id: concept:orphaned-supersession",
        "type: concept",
        "title: Orphaned",
        "status: superseded",
        "aliases: []",
        `updated: ${DATE}`,
        "sources: []",
      ],
      "Superseded by nothing named.\n",
    );
    const walk = JSON.parse(runGraph(root, "superseded")) as Array<Record<string, string>>;
    expect(walk.find((e) => e.slug === "orphaned-supersession")).toEqual({
      slug: "orphaned-supersession",
      "superseded-by": "",
      updated: DATE,
    });
  });
});

describe("ow search (9.12)", () => {
  let root: string;
  beforeEach(() => {
    root = tempProject();
    writePageFile(
      root,
      "fenix",
      active("fenix", "Fenix"),
      "Fenix is a rebuild. A rebuild twice over.\n",
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("counts every occurrence in a page, case-insensitively", () => {
    expect(JSON.parse(runSearch(root, "REBUILD"))).toEqual([
      { slug: "fenix", title: "Fenix", matches: 2 },
    ]);
  });

  it("answers with nothing when the wiki does not mention the query", () => {
    expect(JSON.parse(runSearch(root, "kubernetes"))).toEqual([]);
  });

  it("falls back to the slug for a page whose frontmatter has no readable title", () => {
    writeFileSync(join(root, "wiki", "bare.md"), "# Bare\n\nAnother rebuild.\n", "utf8");
    const hits = JSON.parse(runSearch(root, "rebuild")) as Array<{ slug: string; title: string }>;
    expect(hits.find((h) => h.slug === "bare")!.title).toBe("bare");
  });
});

describe("ow write — the pages the gate does not own", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("writes a non-entity page through without validating it against the page schema", () => {
    // `index.md` is the agent's to curate, not the schema's to validate.
    const result = runWrite(
      root,
      join(root, "wiki", "index.md"),
      "# Index\n\nCurated by hand.\n",
      DATE,
    );
    expect(result.ok).toBe(true);
    expect(readFileSync(join(root, "wiki", "index.md"), "utf8")).toContain("Curated by hand.");
    // Passed through, so it is not announced in the changelog as an entity page.
    expect(existsSync(join(root, "wiki", "changelog.md"))).toBe(false);
  });

  it("refuses a path that escapes the project", () => {
    const result = runWrite(root, join(root, "..", "escape.md"), "not yours\n", DATE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("escape.md");
    expect(existsSync(join(root, "..", "escape.md"))).toBe(false);
  });

  it("refuses a write to the gate's own configuration", () => {
    const result = runWrite(root, join(root, "CLAUDE.md"), "# edited away\n", DATE);
    expect(result.ok).toBe(false);
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(false);
  });

  it("reports paths relative to the project, in posix form, whatever was passed in", () => {
    expect(relativePath(root, join(root, "wiki", "fenix.md"))).toBe("wiki/fenix.md");
    expect(relativePath(root, "wiki/fenix.md")).toBe("wiki/fenix.md");
  });
});

describe("graph and search over a page filed under a subdirectory (adr:0016)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ow-nested-q-"));
    mkdirSync(join(root, "wiki", "topics"), { recursive: true });
    writeFileSync(
      join(root, "wiki", "topics", "checkout.md"),
      "---\nid: topic:checkout\ntype: topic\ntitle: Checkout\nstatus: superseded\n" +
        'aliases: []\nupdated: 2026-08-01\nsources: []\nsuperseded-by: "topic:pay"\n---\nBody about payments.\n',
      "utf8",
    );
    writeFileSync(join(root, "wiki", "index.md"), "# Index\n\n- [[checkout]]\n", "utf8");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("walks supersession without throwing ENOENT", () => {
    // Both commands resolved a slug as wiki/<slug>.md, so any project filing a
    // page the way the plan's layout describes got a stack, not a sentence.
    const parsed = JSON.parse(runGraph(root, "superseded"));
    expect(parsed).toEqual([
      { slug: "checkout", "superseded-by": "topic:pay", updated: "2026-08-01" },
    ]);
  });

  it("lists the page in the default graph", () => {
    expect(JSON.parse(runGraph(root, undefined)).pages).toEqual(["checkout"]);
  });

  it("searches its text", () => {
    const results = JSON.parse(runSearch(root, "payments"));
    expect(results).toEqual([{ slug: "checkout", title: "Checkout", matches: 1 }]);
  });
});
