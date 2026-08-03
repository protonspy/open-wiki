import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdirSync, existsSync, statSync } from "node:fs";
import {
  indexStructure,
  readPageWhole,
  listSourcesState,
  readSourceText,
  MissingPageError,
} from "../src/tools.js";
import { parseMcpArgs } from "../src/index.js";
import type { SourceTextResult } from "../src/tools.js";

/** The text of an answer that has one — the two 8.3 tests only care about that. */
function textOf(answer: SourceTextResult): string {
  if (!answer.hasText) throw new Error(`expected text, got: ${answer.reason}`);
  return answer.text;
}
import { OutsideProjectError, MissingSourceError } from "@open-wiki/access/read";

/**
 * The MCP entrypoint is read-only by construction (plan 9.9): it imports only
 * the read barrel, and no tool resolves a path outside the launched project.
 * These tests pin both halves — the static import boundary and the path
 * confinement of every read tool.
 */

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "ow-mcp-"));
  mkdirSync(join(root, "wiki"), { recursive: true });
  mkdirSync(join(root, "raw"), { recursive: true });
  return root;
}

function writePage(
  root: string,
  slug: string,
  frontmatter: Record<string, unknown>,
  body: string,
): void {
  const fm =
    "---\n" +
    Object.entries(frontmatter)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n") +
    "\n---\n\n";
  writeFileSync(join(root, "wiki", `${slug}.md`), fm + body, "utf8");
}

function writeSource(root: string, id: string, title: string, text: string): void {
  const dir = join(root, "raw", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ id, title, kind: "file", original: `${id}.txt` }) + "\n",
    "utf8",
  );
  writeFileSync(join(dir, "text.md"), text, "utf8");
}

describe("MCP read tools — path confinement (9.9)", () => {
  let root: string;
  beforeEach(() => {
    root = tempProject();
    writePage(
      root,
      "fenix",
      {
        id: "concept:fenix",
        type: "concept",
        title: "Fenix",
        status: "active",
        aliases: "[]",
        updated: "2026-08-01",
        sources: "[]",
        "superseded-by": '""',
      },
      "The Fenix architecture.\n",
    );
    writeSource(root, "notes.txt", "Notes", "raw text\n");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("returns a page whole for a slug that exists", () => {
    const page = readPageWhole(root, "fenix");
    expect(page.slug).toBe("fenix");
    expect(page.content).toContain("The Fenix architecture.");
    expect(page.frontmatter).not.toBeNull();
    expect(page.frontmatter!.title).toBe("Fenix");
  });

  it("refuses a slug that escapes the project — never reads outside it", () => {
    expect(() => readPageWhole(root, "../../../etc/hosts")).toThrow(OutsideProjectError);
    expect(() => readPageWhole(root, "..%2f..%2f")).toThrow();
  });

  it("reports a missing page rather than inventing one", () => {
    // A slug that confines fine but names no file: the agent gets a page it can
    // read about, not an empty string it would take for an empty page.
    const err = (() => {
      try {
        readPageWhole(root, "nope");
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(MissingPageError);
    expect((err as MissingPageError).slug).toBe("nope");
    expect((err as MissingPageError).message).toContain("nope");
  });

  it("refuses a slug that stays in the project but leaves wiki/ — no root-file leak", () => {
    // A slug like `../README` resolves to `<root>/README.md`: inside the project,
    // but not a wiki page. The server serves `wiki/` only, so it must refuse
    // before reading a file the agent never put in the wiki.
    writeFileSync(join(root, "README.md"), "project root secret\n", "utf8");
    expect(() => readPageWhole(root, "../README")).toThrow(OutsideProjectError);
  });

  it("lists the index as structure: which pages are indexed, which are orphans, and status", () => {
    // index.md links to fenix.
    writeFileSync(
      join(root, "wiki", "index.md"),
      "# Index\n\n## Pages\n\n- [[fenix]] — Fenix\n",
      "utf8",
    );
    // An orphan the index does not reach.
    writePage(
      root,
      "orphan",
      {
        id: "concept:orphan",
        type: "concept",
        title: "Orphan",
        status: "superseded",
        aliases: "[]",
        updated: "2026-08-01",
        sources: "[]",
        "superseded-by": '"fenix"',
      },
      "Unreachable.\n",
    );
    const entries = indexStructure(root);
    const bySlug = Object.fromEntries(entries.map((e) => [e.slug, e]));
    expect(bySlug.fenix!.indexed).toBe(true);
    expect(bySlug.fenix!.status).toBe("active");
    expect(bySlug.orphan!.indexed).toBe(false);
    expect(bySlug.orphan!.status).toBe("superseded");
  });

  it("falls back to the slug when a page carries no readable frontmatter", () => {
    // A page the agent wrote by hand before the gate saw it, and one whose
    // frontmatter will not parse: both are still listed, described by what is
    // knowable — the slug — rather than dropped from the structure.
    writeFileSync(join(root, "wiki", "bare.md"), "# Bare\n\nNo frontmatter here.\n", "utf8");
    writeFileSync(join(root, "wiki", "broken.md"), "---\n: : :\n---\n\nBroken.\n", "utf8");

    const bySlug = Object.fromEntries(indexStructure(root).map((e) => [e.slug, e]));
    for (const slug of ["bare", "broken"]) {
      expect(bySlug[slug]!.title).toBe(slug);
      expect(bySlug[slug]!.type).toBe("unknown");
      expect(bySlug[slug]!.status).toBe("active");
      expect(bySlug[slug]!.indexed).toBe(false);
    }
    expect(readPageWhole(root, "bare").frontmatter).toBeNull();
  });

  it("lists sources with their manifest and whether text.md is present", () => {
    const sources = listSourcesState(root);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.id).toBe("notes.txt");
    expect(sources[0]!.manifest.title).toBe("Notes");
    expect(sources[0]!.hasText).toBe(true);
  });

  it("carries a source's description, so a consulting agent knows what it is", () => {
    writeFileSync(
      join(root, "raw", "notes.txt", "manifest.json"),
      JSON.stringify({
        id: "notes.txt",
        title: "Notes",
        kind: "file",
        original: "notes.txt",
        description: "The Q3 incident timeline.",
      }),
      "utf8",
    );
    expect(listSourcesState(root)[0]!.manifest.description).toBe("The Q3 incident timeline.");
  });

  it("bounds the manifest's free text before serving it to another project", () => {
    // This tool exists so an agent in a *different* project can consult this
    // one. `manifest.json` arrives with a `git clone`, so a multi-megabyte
    // description would be one source crowding every other out of the context
    // of a reader who never opened this repository. `ow source list` bounds the
    // same two fields; this surface was missed the first time.
    writeFileSync(
      join(root, "raw", "notes.txt", "manifest.json"),
      JSON.stringify({
        id: "notes.txt",
        title: "T".repeat(9000),
        kind: "file",
        original: "o".repeat(9000),
        description: "d".repeat(9000),
      }),
      "utf8",
    );

    const manifest = listSourcesState(root)[0]!.manifest;
    expect(manifest.title.length).toBeLessThan(9000);
    expect(manifest.description!.length).toBeLessThan(9000);
    expect(manifest.description).toMatch(/9000 characters, truncated/);
    // `original` is served by `ow_sources` beside the title and is free text
    // out of the same file. The first `boundedManifest` missed it while its own
    // doc claimed every field was cut.
    expect(manifest.original.length).toBeLessThan(9000);
    expect(manifest.original).toMatch(/9000 characters, truncated/);
  });

  it("bounds a field the schema gained later, not only the two it was written for", () => {
    // `superseded-by` (task 8.5) went out of here unbounded, because this
    // bounded a list of field names rather than the manifest. A security review
    // found it. The bound lives in `boundedManifest` now, so this pins the
    // property — every free-text field is cut — rather than a third name.
    writeFileSync(
      join(root, "raw", "notes.txt", "manifest.json"),
      JSON.stringify({
        id: "notes.txt",
        title: "t",
        kind: "file",
        original: "notes.txt",
        status: "superseded",
        "superseded-by": "s".repeat(9000),
      }),
      "utf8",
    );

    const manifest = listSourcesState(root)[0]!.manifest;
    expect(manifest["superseded-by"]!.length).toBeLessThan(9000);
    expect(manifest["superseded-by"]).toMatch(/9000 characters, truncated/);
  });

  it("serves a filed source's own text, not a stray file at raw/<id>/ (8.3)", () => {
    // The spoof this closes. `readManifest` resolved through the walk while
    // `sourceTextPath` joined `raw/<id>` — so a repository could ship a bare
    // `raw/weekly/text.md`, with no manifest at all, and have it served as the
    // text of the real, filed `raw/archive/2026/weekly`. The manifest would
    // name one source and the text come from another, under a citation reading
    // as sound. `duplicateSourceIds` cannot see it either: the walk registers
    // only directories that hold a manifest.
    mkdirSync(join(root, "raw", "archive", "2026", "weekly"), { recursive: true });
    writeFileSync(
      join(root, "raw", "archive", "2026", "weekly", "manifest.json"),
      JSON.stringify({ id: "weekly", title: "Weekly", kind: "recording", original: "" }),
      "utf8",
    );
    writeFileSync(
      join(root, "raw", "archive", "2026", "weekly", "text.md"),
      "the real transcript\n",
      "utf8",
    );
    mkdirSync(join(root, "raw", "weekly"), { recursive: true });
    writeFileSync(join(root, "raw", "weekly", "text.md"), "planted by the clone\n", "utf8");

    expect(textOf(readSourceText(root, "weekly"))).toBe("the real transcript\n");
    expect(listSourcesState(root).find((s) => s.id === "weekly")?.hasText).toBe(true);
  });

  it("finds a filed source's text at all (8.3)", () => {
    mkdirSync(join(root, "raw", "2026", "filed.md"), { recursive: true });
    writeFileSync(
      join(root, "raw", "2026", "filed.md", "manifest.json"),
      JSON.stringify({ id: "filed.md", title: "Filed", kind: "file", original: "filed.md" }),
      "utf8",
    );
    writeFileSync(join(root, "raw", "2026", "filed.md", "text.md"), "# Filed\n", "utf8");

    expect(textOf(readSourceText(root, "filed.md"))).toBe("# Filed\n");
    expect(listSourcesState(root).find((s) => s.id === "filed.md")?.hasText).toBe(true);
  });

  it("marks a source that has been registered but not yet normalised", () => {
    // A manifest with no text.md alongside it — the ingest ran, the extraction
    // did not. `hasText: false` is what tells the agent not to cite into it yet.
    const dir = join(root, "raw", "pending.pdf");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({
        id: "pending.pdf",
        title: "Pending",
        kind: "file",
        original: "pending.pdf",
      }) + "\n",
      "utf8",
    );
    const state = listSourcesState(root).find((s) => s.id === "pending.pdf");
    expect(state!.hasText).toBe(false);
  });

  it("returns a source's text.md", () => {
    expect(readSourceText(root, "notes.txt")).toEqual({
      id: "notes.txt",
      hasText: true,
      text: "raw text\n",
    });
  });

  it("says what a source with no text.md is, rather than returning nothing (7.3)", () => {
    // Since `adr:0021` the application stores a source and does not read it, so
    // most sources have no `text.md` at all. Throwing ENOENT told a consulting
    // agent only that something went wrong — it could not tell *empty* from
    // *unread*, which are different answers with different next steps.
    const dir = join(root, "raw", "report.pdf");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({
        id: "report.pdf",
        title: "The Q3 report",
        kind: "file",
        original: "The Q3 report.pdf",
        description: "What the cutover decided.",
        processed: "2026-08-02",
      }),
      "utf8",
    );

    const answer = readSourceText(root, "report.pdf");
    expect(answer.hasText).toBe(false);
    if (answer.hasText) return;
    expect(answer.title).toBe("The Q3 report");
    expect(answer.kind).toBe("file");
    expect(answer.original).toBe("The Q3 report.pdf");
    expect(answer.processed).toBe("2026-08-02");
    expect(answer.description).toBe("What the cutover decided.");
    // And it says the original is out of reach: that project is not on this
    // agent's disk, and MCP serves a different one over HTTP.
    expect(answer.reason).toMatch(/cannot be served from here/i);
  });

  it("carries a supersession into the same answer (7.3, 8.5)", () => {
    const dir = join(root, "raw", "old.pdf");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({
        id: "old.pdf",
        title: "Superseded",
        kind: "file",
        original: "old.pdf",
        status: "superseded",
        "superseded-by": "new.pdf",
        superseded: "2026-08-03",
      }),
      "utf8",
    );
    const answer = readSourceText(root, "old.pdf");
    expect(answer.hasText).toBe(false);
    if (answer.hasText) return;
    expect(answer.superseded).toEqual({ by: "new.pdf", date: "2026-08-03" });
  });

  it("refuses a source id that escapes the project", () => {
    expect(() => readSourceText(root, "../../escape")).toThrow(OutsideProjectError);
  });

  it("reports a missing source rather than inventing one", () => {
    expect(() => readSourceText(root, "nope")).toThrow(MissingSourceError);
  });

  it("never reads outside the project, even via the source list", () => {
    // A loose file under raw/ that is not a source directory is not enumerated.
    writeFileSync(join(root, "raw", "loose.txt"), "junk");
    expect(listSourcesState(root).map((s) => s.id)).toEqual(["notes.txt"]);
  });
});

describe("MCP read-only boundary (9.9)", () => {
  // The static guarantee: the entrypoint's source imports only the read barrel
  // (`@open-wiki/access/read`), node, the SDK and zod — never the main barrel
  // `@open-wiki/access`, which re-exports the write path. A grep of the source
  // is what enforces this; the bundler cannot save a module it never imports.
  // Each entry is a prefix: a spec is allowed when it equals the prefix or sits
  // under it. `node:` is a scheme, so `node:fs` matches the prefix directly; the
  // others are package names, so a subpath like `@modelcontextprotocol/sdk/server`
  // is allowed too.
  const ALLOWED = ["node:", "@modelcontextprotocol/sdk/", "zod", "@open-wiki/access/read"];

  function allowed(spec: string): boolean {
    // Relative imports stay inside this package, so they cannot reach the write
    // path; everything else must be one of the read-only roots below.
    if (spec.startsWith("./") || spec.startsWith("../")) return true;
    return ALLOWED.some(
      (a) => spec === a || (a.endsWith(":") ? spec.startsWith(a) : spec.startsWith(a)),
    );
  }

  function srcFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...srcFiles(full));
      else if (entry.endsWith(".ts") && !entry.endsWith(".spec.ts")) out.push(full);
    }
    return out;
  }

  it("imports no write path — only the read barrel, node, the SDK and zod", () => {
    const files = srcFiles(join(__dirname, "..", "src"));
    expect(files.length).toBeGreaterThan(0);
    const importRe = /^\s*import\s+(?:[^;]+\s+from\s+)?["']([^"']+)["']/gm;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const specs = [...text.matchAll(importRe)].map((m) => m[1]!);
      for (const spec of specs) {
        const ok = allowed(spec);
        expect(ok, `${file}: disallowed import "${spec}"`).toBe(true);
      }
    }
  });

  it("the read barrel itself re-exports none of the write path", () => {
    // If the read barrel leaked a write symbol, importing it would pull the
    // write path after all. Belt and braces: assert the known write symbols are
    // absent from the barrel's text.
    const barrel = join(__dirname, "..", "..", "access", "src", "read.ts");
    expect(existsSync(barrel)).toBe(true);
    const text = readFileSync(barrel, "utf8");
    const writeExports = [
      "scaffold",
      "atomicWrite",
      "writePage",
      "appendOperation",
      "undo",
      "writeIgnore",
      "supersedePage",
      "registerSource",
      "registerInIndex",
      "recordWrite",
      "completeFrontmatter",
      "gateWrite",
      "writeSettings",
      "uploadTextSource",
      "writeSourceText",
      "updateManifest",
    ];
    for (const w of writeExports) {
      expect(
        new RegExp(`\\b${w}\\b`).test(text),
        `read barrel re-exports write symbol "${w}"`,
      ).toBe(false);
    }
  });
});

describe("parseMcpArgs (9.7)", () => {
  it("parses --project <name> and the --read-only flag", () => {
    expect(parseMcpArgs(["--project", "fenix", "--read-only"])).toEqual({
      project: "fenix",
      readOnly: true,
    });
  });

  it("parses the --project=<name> form", () => {
    expect(parseMcpArgs(["--project=fenix", "--read-only"]).project).toBe("fenix");
  });

  it("read-only is optional — the server is read-only by construction", () => {
    expect(parseMcpArgs(["--project", "fenix"]).readOnly).toBe(false);
  });

  it("refuses to start without a project name", () => {
    expect(() => parseMcpArgs(["--read-only"])).toThrow(/--project/);
  });
});

describe("a page filed under a subdirectory (adr:0016)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ow-mcp-nested-"));
    mkdirSync(join(root, "wiki", "topics"), { recursive: true });
    writeFileSync(
      join(root, "wiki", "topics", "checkout.md"),
      "---\nid: topic:checkout\ntype: topic\ntitle: Checkout\nstatus: superseded\n" +
        'aliases: []\nupdated: 2026-08-01\nsources: []\nsuperseded-by: "topic:pay"\n---\nBody.\n',
      "utf8",
    );
    writeFileSync(join(root, "wiki", "index.md"), "# Index\n\n- [[checkout]]\n", "utf8");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("serves the page rather than reporting it missing", () => {
    // It was listed by ow_index and then served as `no page "checkout" under
    // wiki/` — the index and the reader disagreeing about the same project.
    expect(readPageWhole(root, "checkout").content).toContain("Body.");
  });

  it("reads its frontmatter, so the index does not report it as unknown", () => {
    // The frontmatter read degraded to null, so a superseded page came back as
    // `type: unknown, status: active` — confidently wrong rather than absent.
    const entry = indexStructure(root).find((p) => p.slug === "checkout");
    expect(entry).toMatchObject({ title: "Checkout", type: "topic", status: "superseded" });
  });

  it("still refuses a slug that escapes wiki/", () => {
    expect(() => readPageWhole(root, "../README")).toThrow();
  });
});
