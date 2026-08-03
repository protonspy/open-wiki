import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkProject, readWiki, citedSourcePages } from "../src/check/checks.js";
import { hasErrors, sortFindings, type Finding } from "../src/check/findings.js";

function tempProject(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ow-check-")));
  mkdirSync(join(root, "wiki"), { recursive: true });
  mkdirSync(join(root, "raw"), { recursive: true });
  return root;
}

/** Write a page with valid frontmatter, at any depth under `wiki/`. */
function page(
  root: string,
  relPath: string,
  body = "",
  frontmatter: Record<string, unknown> = {},
): void {
  const slug = relPath.split("/").pop()!.replace(/\.md$/, "");
  const fm = {
    id: `topic:${slug}`,
    type: "topic",
    title: slug,
    status: "active",
    aliases: [],
    updated: "2026-08-01",
    sources: [],
    "superseded-by": "",
    ...frontmatter,
  };
  const yaml = Object.entries(fm)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  const file = join(root, "wiki", relPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `---\n${yaml}\n---\n${body}`, "utf8");
}

function index(root: string, slugs: string[]): void {
  const links = slugs.map((s) => `- [[${s}]]`).join("\n");
  writeFileSync(join(root, "wiki", "index.md"), `# Index\n\n## Pages\n\n${links}\n`, "utf8");
}

function changelog(root: string, slugs: string[]): void {
  const bullets = slugs.map((s) => `- Created [[${s}]].`).join("\n");
  writeFileSync(
    join(root, "wiki", "changelog.md"),
    `# Changelog\n\n## 2026-08-01\n\n${bullets}\n`,
    "utf8",
  );
}

function source(root: string, id: string, text = "# Source\n", processed?: string): void {
  const dir = join(root, "raw", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      id,
      title: id,
      kind: "file",
      original: id,
      ...(processed !== undefined ? { processed } : {}),
    }),
    "utf8",
  );
  writeFileSync(join(dir, "text.md"), text, "utf8");
}

/** The codes present in a report, for asserting on what a check found. */
function codes(findings: Finding[]): string[] {
  return findings.map((f) => f.code);
}

describe("the integrity checks (group 7)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  describe("a wiki with nothing wrong", () => {
    it("reports nothing", () => {
      source(root, "notes.md");
      page(root, "fenix.md", "Rests on src://notes.md#p1.", {
        sources: ["src://notes.md#p1"],
      });
      index(root, ["fenix"]);
      changelog(root, ["fenix"]);

      const report = checkProject(root);
      expect(report.findings).toEqual([]);
      expect(report.pages).toBe(1);
      expect(report.sources).toBe(1);
    });
  });

  describe("7.1 — links and reachability", () => {
    it("reports a wikilink that resolves to no page", () => {
      page(root, "fenix.md", "See [[nowhere]].");
      index(root, ["fenix"]);
      changelog(root, ["fenix"]);

      const findings = checkProject(root).findings.filter((f) => f.code === "wikilink.broken");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("nowhere");
      expect(findings[0]!.page).toBe("wiki/fenix.md");
      expect(findings[0]!.fix.length).toBeGreaterThan(0);
    });

    it("resolves a link to a page filed under a type subdirectory", () => {
      // The plan's layout puts pages in wiki/topics/ and wiki/people/; a link
      // names the slug, not the path.
      page(root, "topics/checkout.md");
      page(root, "fenix.md", "See [[checkout]].");
      index(root, ["fenix", "checkout"]);
      changelog(root, ["fenix", "checkout"]);

      expect(codes(checkProject(root).findings)).not.toContain("wikilink.broken");
    });

    it("reports a page nothing in the index reaches", () => {
      page(root, "fenix.md");
      page(root, "orphaned.md");
      index(root, ["fenix"]);
      changelog(root, ["fenix", "orphaned"]);

      const findings = checkProject(root).findings.filter((f) => f.code === "page.orphan");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.page).toBe("wiki/orphaned.md");
    });

    it("sees a page in a subdirectory, which used to be invisible entirely", () => {
      // Reading only the top level of wiki/ meant a page written the way the
      // plan's layout describes was never indexed, never checked, and never
      // returned by ow graph.
      page(root, "topics/checkout.md");
      index(root, []);
      changelog(root, []);

      const report = checkProject(root);
      expect(report.pages).toBe(1);
      expect(codes(report.findings)).toContain("page.orphan");
    });

    it("reports two pages sharing one slug, because a link cannot mean both", () => {
      page(root, "checkout.md");
      page(root, "topics/checkout.md");
      index(root, ["checkout"]);
      changelog(root, ["checkout"]);

      const findings = checkProject(root).findings.filter((f) => f.code === "page.duplicate-slug");
      expect(findings).toHaveLength(2); // one against each file
      expect(findings[0]!.message).toContain("ambiguous");
    });

    it("does not treat wiki/index.md, changelog.md or log.md as pages", () => {
      writeFileSync(join(root, "wiki", "log.md"), "# Log\n", "utf8");
      index(root, []);
      changelog(root, []);
      expect(checkProject(root).pages).toBe(0);
    });

    it("sees a page whose extension is upper case, as the gate does", () => {
      // The gate folds case before testing for `.md`, so it validates and
      // accepts `wiki/fenix.MD`. Matching case-sensitively here meant that page
      // was accepted and then invisible to everything downstream.
      writeFileSync(
        join(root, "wiki", "shouty.MD"),
        "---\nid: topic:shouty\ntype: topic\ntitle: shouty\nstatus: active\naliases: []\n" +
          'updated: 2026-08-01\nsources: []\nsuperseded-by: ""\n---\n',
        "utf8",
      );
      index(root, ["shouty"]);
      changelog(root, ["shouty"]);

      expect(checkProject(root).pages).toBe(1);
      expect(codes(checkProject(root).findings)).not.toContain("page.orphan");
    });

    it("treats a nested file called index.md as an ordinary page", () => {
      page(root, "topics/index.md");
      index(root, ["index"]);
      changelog(root, ["index"]);
      expect(checkProject(root).pages).toBe(1);
    });
  });

  describe("7.2 — the records, and sources nothing uses", () => {
    it("reports a changelog entry naming a page that does not exist", () => {
      page(root, "fenix.md");
      index(root, ["fenix"]);
      changelog(root, ["fenix", "deleted-page"]);

      const findings = checkProject(root).findings.filter(
        (f) => f.code === "changelog.missing-page",
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("deleted-page");
    });

    it("reports a page the changelog never recorded", () => {
      page(root, "fenix.md");
      index(root, ["fenix"]);
      changelog(root, []);

      const findings = checkProject(root).findings.filter(
        (f) => f.code === "changelog.unrecorded-page",
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]!.severity).toBe("warning");
    });

    it("reports a source no page cites", () => {
      source(root, "unused.md");
      index(root, []);
      changelog(root, []);

      const findings = checkProject(root).findings.filter((f) => f.code === "source.uncited");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.source).toBe("unused.md");
      expect(findings[0]!.severity).toBe("warning");
    });

    it("counts a source cited only in prose as cited", () => {
      // The agent writes citations where the claims are; sources: is filled in
      // for it. Either one means the source is used.
      source(root, "notes.md");
      page(root, "fenix.md", "As src://notes.md#p1 says.");
      index(root, ["fenix"]);
      changelog(root, ["fenix"]);

      expect(codes(checkProject(root).findings)).not.toContain("source.uncited");
    });

    it("stops reporting a source somebody read and discarded (R4.2)", () => {
      // The case the whole declaration exists for: the agent read it and found
      // nothing worth writing, which leaves no trace on the filesystem — so
      // before this it was a finding that could never be cleared, on every run,
      // forever.
      source(root, "read-and-discarded.md", "# Source\n", "2026-08-02");
      index(root, []);
      changelog(root, []);

      expect(codes(checkProject(root).findings)).not.toContain("source.uncited");
    });

    it("still reports one that is neither cited nor declared, and names the verb (R4.1)", () => {
      source(root, "unread.md");
      index(root, []);
      changelog(root, []);

      const findings = checkProject(root).findings.filter((f) => f.code === "source.uncited");
      expect(findings).toHaveLength(1);
      // Both ways out, because the reader who discarded it deliberately needs
      // to be told they may record that, not told again to distil it (9.13) —
      // and the verb that records it is named, now that plan task 4.2 built it.
      expect(findings[0]!.fix).toMatch(/distil/i);
      expect(findings[0]!.fix).toContain("ow source mark unread.md");
    });

    it("offers no command to run for an id that is not a plain slug", () => {
      // `listSources` reads directory names verbatim, and a directory under
      // `raw/` is not necessarily one this application created — it arrives
      // with a clone, an agent's own tools can make one, and group 6 will
      // unpack archives into it. This text is written to be *acted on* by an
      // agent that has a shell, so an id holding shell syntax must never be
      // handed over as part of a command line. `safe` does not help: it strips
      // control characters, and `;` and a backtick are neither.
      // Windows forbids `|` in a filename and permits every one of these, so
      // the hole is reachable on the platform the MVP ships for as well as on
      // the POSIX ones `npx @protonspy/open-wiki` reaches.
      for (const hostile of ["a;rm -rf .", "b`curl evil`", "c$(id)", "d e", "x&calc", "É.pdf"]) {
        mkdirSync(join(root, "raw", hostile), { recursive: true });
        writeFileSync(
          join(root, "raw", hostile, "manifest.json"),
          JSON.stringify({ id: hostile, title: hostile, kind: "file", original: hostile }),
          "utf8",
        );
      }
      index(root, []);
      changelog(root, []);

      const findings = checkProject(root).findings.filter((f) => f.code === "source.uncited");
      expect(findings.length).toBeGreaterThanOrEqual(5);
      for (const f of findings) {
        expect(f.fix, f.source).not.toContain("ow source mark");
        expect(f.fix, f.source).toMatch(/not a plain id/);
      }
    });

    it("reports a source whose manifest will not parse, rather than hiding it", () => {
      // `false` is the safe answer to "was this declared": reporting a source
      // somebody may already have read costs a glance, where believing a
      // declaration that is not there hides one nobody has opened.
      source(root, "broken.md");
      writeFileSync(join(root, "raw", "broken.md", "manifest.json"), "{ not json", "utf8");
      index(root, []);
      changelog(root, []);

      const findings = checkProject(root).findings.filter((f) => f.code === "source.uncited");
      expect(findings.map((f) => f.source)).toEqual(["broken.md"]);
    });

    it("finds a source filed into a folder, rather than not seeing it at all (8.3)", () => {
      // Before 8.3 this read one level of `raw/`, so a filed source was
      // invisible to every check — which is quieter than being wrong.
      mkdirSync(join(root, "raw", "2026", "filed.md"), { recursive: true });
      writeFileSync(
        join(root, "raw", "2026", "filed.md", "manifest.json"),
        JSON.stringify({ id: "filed.md", title: "filed", kind: "file", original: "filed.md" }),
        "utf8",
      );
      index(root, []);
      changelog(root, []);

      const findings = checkProject(root).findings.filter((f) => f.code === "source.uncited");
      expect(findings.map((f) => f.source)).toContain("filed.md");
    });

    it("reports two directories claiming one id as an error (8.3)", () => {
      // `src://weekly#p1` cannot mean two sources, and settling that by
      // silently choosing is the answer `adr:0016` refused for pages.
      for (const rel of [
        ["2026", "weekly"],
        ["archive", "weekly"],
      ]) {
        mkdirSync(join(root, "raw", ...rel), { recursive: true });
        writeFileSync(
          join(root, "raw", ...rel, "manifest.json"),
          JSON.stringify({ id: "weekly", title: "weekly", kind: "file", original: "weekly" }),
          "utf8",
        );
      }
      index(root, []);
      changelog(root, []);

      const findings = checkProject(root).findings.filter((f) => f.code === "source.duplicate-id");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.severity).toBe("error");
      expect(findings[0]!.message).toContain("2 sources");
      expect(findings[0]!.fix).toMatch(/organisation/i);
    });

    it("never reports the inbox as an uncited source", () => {
      mkdirSync(join(root, "raw", "_inbox"), { recursive: true });
      writeFileSync(join(root, "raw", "_inbox", "dropped.md"), "x", "utf8");
      index(root, []);
      changelog(root, []);

      const findings = checkProject(root).findings.filter((f) => f.code === "source.uncited");
      expect(findings).toEqual([]);
    });
  });

  describe("7.3 — provenance", () => {
    it("reports a citation pointing at no source", () => {
      page(root, "fenix.md", "From src://missing.pdf#p3.", { sources: ["src://missing.pdf#p3"] });
      index(root, ["fenix"]);
      changelog(root, ["fenix"]);

      const findings = checkProject(root).findings.filter(
        (f) => f.code === "provenance.unresolved",
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("missing.pdf");
    });

    it("reports a recording citation whose fragment is not an instant", () => {
      const dir = join(root, "raw", "weekly-2026-08-01");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "manifest.json"),
        JSON.stringify({
          id: "weekly-2026-08-01",
          title: "Weekly",
          kind: "recording",
          original: "",
        }),
        "utf8",
      );
      page(root, "fenix.md", "", { sources: ["rec://weekly-2026-08-01#halfway"] });
      index(root, ["fenix"]);
      changelog(root, ["fenix"]);

      const findings = checkProject(root).findings.filter(
        (f) => f.code === "provenance.unresolved",
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("HH:MM");
    });
  });

  describe("7.4 — one term per concept", () => {
    it("reports a page using another page's alias instead of its title", () => {
      page(root, "fenix.md", "", { title: "Fenix", aliases: ["fenix platform"] });
      page(root, "checkout.md", "Built on the fenix platform, mostly.");
      index(root, ["fenix", "checkout"]);
      changelog(root, ["fenix", "checkout"]);

      const findings = checkProject(root).findings.filter((f) => f.code === "glossary.synonym");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.page).toBe("wiki/checkout.md");
      expect(findings[0]!.message).toContain("Fenix");
    });

    it("leaves the page that declares the alias alone", () => {
      // "Fenix, also known as the fenix platform" is where the synonym belongs.
      page(root, "fenix.md", "Also known as the fenix platform.", {
        title: "Fenix",
        aliases: ["fenix platform"],
      });
      index(root, ["fenix"]);
      changelog(root, ["fenix"]);

      expect(codes(checkProject(root).findings)).not.toContain("glossary.synonym");
    });

    it("does not flag an alias inside a wikilink or inside code", () => {
      page(root, "fenix.md", "", { title: "Fenix", aliases: ["fenix platform"] });
      page(root, "checkout.md", "See [[fenix platform]] and `fenix platform`.");
      index(root, ["fenix", "checkout"]);
      changelog(root, ["fenix", "checkout"]);

      expect(codes(checkProject(root).findings)).not.toContain("glossary.synonym");
    });

    it("reports two pages claiming one alias as a conflict, not as noise on one of them", () => {
      // Last-writer-wins silently picked one and then flagged the *declaring*
      // page of the loser for writing its own alias.
      page(root, "a-page.md", "", { title: "Alpha", aliases: ["widget"] });
      page(root, "b-page.md", "", { title: "Beta", aliases: ["widget"] });
      index(root, ["a-page", "b-page"]);
      changelog(root, ["a-page", "b-page"]);

      const found = checkProject(root).findings;
      expect(codes(found)).toContain("glossary.conflict");
      expect(codes(found)).not.toContain("glossary.synonym");
    });

    it("reports an alias that is another page's title, rather than flagging that page", () => {
      page(root, "fenix.md", "", { title: "Fenix", aliases: ["checkout"] });
      page(root, "checkout.md", "The checkout is where it happens.", { title: "checkout" });
      index(root, ["fenix", "checkout"]);
      changelog(root, ["fenix", "checkout"]);

      const found = checkProject(root).findings;
      expect(codes(found)).toContain("glossary.conflict");
      // The victim page must not be told to stop writing its own name.
      expect(found.filter((f) => f.code === "glossary.synonym")).toEqual([]);
    });

    it("matches whole words only", () => {
      page(root, "fenix.md", "", { title: "Fenix", aliases: ["ana"] });
      page(root, "checkout.md", "The banana analysis is unrelated.");
      index(root, ["fenix", "checkout"]);
      changelog(root, ["fenix", "checkout"]);

      expect(codes(checkProject(root).findings)).not.toContain("glossary.synonym");
    });
  });

  describe("7.5 — codewiki", () => {
    it("accepts a citation that resolves and sits inside the file", () => {
      writeFileSync(join(root, "code.ts"), "a\nb\nc\nd\ne\n", "utf8");
      page(root, "codewiki/dispatch.md", "## How it routes\n\n[code.ts:2-4]()\n\nOne switch.\n");
      index(root, ["dispatch"]);
      changelog(root, ["dispatch"]);

      const found = codes(checkProject(root).findings);
      expect(found).not.toContain("codewiki.citation-unresolved");
      expect(found).not.toContain("codewiki.citation-past-end");
    });

    it("reports a citation whose file is gone", () => {
      page(root, "codewiki/dispatch.md", "## Routing\n\n[src/gone.ts:1-4]()\n");
      index(root, ["dispatch"]);
      changelog(root, ["dispatch"]);

      const findings = checkProject(root).findings.filter(
        (f) => f.code === "codewiki.citation-unresolved",
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("src/gone.ts");
    });

    it("reports a citation running past the end of its file", () => {
      writeFileSync(join(root, "code.ts"), "a\nb\nc\n", "utf8");
      page(root, "codewiki/dispatch.md", "## Routing\n\n[code.ts:2-99]()\n");
      index(root, ["dispatch"]);
      changelog(root, ["dispatch"]);

      const findings = checkProject(root).findings.filter(
        (f) => f.code === "codewiki.citation-past-end",
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("3 lines");
    });

    it("counts the last line of a file that ends with a newline exactly once", () => {
      // "a\nb\nc\n" is three lines. Splitting on \n yields four elements, and
      // trusting that would accept [code.ts:1-4] on a three-line file.
      writeFileSync(join(root, "code.ts"), "a\nb\nc\n", "utf8");
      page(root, "codewiki/edge.md", "## Edge\n\n[code.ts:1-4]()\n");
      index(root, ["edge"]);
      changelog(root, ["edge"]);

      const findings = checkProject(root).findings.filter(
        (f) => f.code === "codewiki.citation-past-end",
      );
      expect(findings).toHaveLength(1);
    });

    it("accepts a citation ending exactly on the last line", () => {
      writeFileSync(join(root, "code.ts"), "a\nb\nc\n", "utf8");
      page(root, "codewiki/exact.md", "## Exact\n\n[code.ts:1-3]()\n");
      index(root, ["exact"]);
      changelog(root, ["exact"]);

      expect(codes(checkProject(root).findings)).not.toContain("codewiki.citation-past-end");
    });

    it("reports a section that cites nothing", () => {
      writeFileSync(join(root, "code.ts"), "a\nb\n", "utf8");
      page(
        root,
        "codewiki/dispatch.md",
        "## Routing\n\n[code.ts:1-2]()\n\n## Opinions\n\nNo citation here.\n",
      );
      index(root, ["dispatch"]);
      changelog(root, ["dispatch"]);

      const findings = checkProject(root).findings.filter(
        (f) => f.code === "codewiki.section-uncited",
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]!.message).toContain("Opinions");
    });

    it("refuses to read a citation pointing outside the project", () => {
      page(root, "codewiki/dispatch.md", "## Routing\n\n[../../etc/passwd:1-2]()\n");
      index(root, ["dispatch"]);
      changelog(root, ["dispatch"]);

      const findings = checkProject(root).findings.filter(
        (f) => f.code === "codewiki.citation-unresolved",
      );
      expect(findings).toHaveLength(1);
    });

    it("does not apply the codewiki rules to an ordinary wiki page", () => {
      page(root, "fenix.md", "## A section with no citation\n\nProse.\n");
      index(root, ["fenix"]);
      changelog(root, ["fenix"]);

      expect(codes(checkProject(root).findings)).not.toContain("codewiki.section-uncited");
    });

    it("counts a citation written on the heading line itself", () => {
      writeFileSync(join(root, "code.ts"), "a\nb\n", "utf8");
      page(root, "codewiki/dispatch.md", "## Alpha [code.ts:1-2]()\n\nProse.\n");
      index(root, ["dispatch"]);
      changelog(root, ["dispatch"]);

      // It used to report `the section "Alpha [code.ts:1-2]()" cites no lines`,
      // quoting the citation it had just refused to look at.
      expect(codes(checkProject(root).findings)).not.toContain("codewiki.section-uncited");
    });

    it("does not treat the page's own H1 title as an uncited section", () => {
      writeFileSync(join(root, "code.ts"), "a\nb\n", "utf8");
      page(
        root,
        "codewiki/dispatch.md",
        "# The dispatcher\n\nAn intro.\n\n## Routing\n\n[code.ts:1-2]()\n",
      );
      index(root, ["dispatch"]);
      changelog(root, ["dispatch"]);

      expect(codes(checkProject(root).findings)).not.toContain("codewiki.section-uncited");
    });

    it("reports a stray codewiki page at any depth below the root", () => {
      mkdirSync(join(root, "codewiki", "area"), { recursive: true });
      writeFileSync(join(root, "codewiki", "area", "x.md"), "# Stray\n", "utf8");
      index(root, []);
      changelog(root, []);

      expect(codes(checkProject(root).findings)).toContain("codewiki.misplaced");
    });

    it("does not resolve a citation shown inside a fenced code block", () => {
      // A codewiki page documenting the citation form — which the skill's own
      // prose does — would otherwise fail `ow check` for its own example.
      page(
        root,
        "codewiki/dispatch.md",
        "## Form\n\n```\n[path/to/file.ts:12-40]()\n```\n\nAnd prose.\n",
      );
      index(root, ["dispatch"]);
      changelog(root, ["dispatch"]);

      expect(codes(checkProject(root).findings)).not.toContain("codewiki.citation-unresolved");
    });

    it("reports a codewiki/ at the project root as misplaced", () => {
      // Outside wiki/ it is not part of the wiki: nothing indexes it, nothing
      // links it, and no write to it is validated.
      mkdirSync(join(root, "codewiki"), { recursive: true });
      writeFileSync(join(root, "codewiki", "stray.md"), "# Stray\n", "utf8");
      index(root, []);
      changelog(root, []);

      const findings = checkProject(root).findings.filter((f) => f.code === "codewiki.misplaced");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.fix).toContain("wiki/codewiki/");
    });
  });

  describe("hostile page content", () => {
    it("scans a pathological citation-shaped line in linear time", { timeout: 10_000 }, () => {
      // `[/a/a/a/...]` with the `/` also inside the segment class made the
      // pattern ambiguous: every partition of the run is a backtracking path,
      // and ~26 segments took 1.6s, ~34 took minutes. That is a page body — an
      // agent writes those, possibly steered by a poisoned source in raw/ —
      // wedging `ow check`, CI and the UI in a spin no try/catch interrupts.
      const payload = `[${"/a".repeat(60)}]`;
      page(root, "codewiki/evil.md", `## Section\n\n${payload}\n`);
      index(root, ["evil"]);
      changelog(root, ["evil"]);

      const started = Date.now();
      checkProject(root);
      expect(Date.now() - started).toBeLessThan(5000);
    });

    it("strips control characters out of a message, so a page cannot forge the report", () => {
      // `ow check` writes findings to a terminal, and the report is what a
      // human reads to decide whether the wiki is sound. A YAML double-quoted
      // alias carries \n, \r and \u001b intact.
      page(root, "fenix.md", "", {
        title: "Fenix",
        aliases: ["widget\n\now check: no findings (99 pages)\n\u001b[2K"],
      });
      page(root, "checkout.md", "Uses a widget here.");
      index(root, ["fenix", "checkout"]);
      changelog(root, ["fenix", "checkout"]);

      for (const finding of checkProject(root).findings) {
        expect(finding.message).not.toMatch(/\p{Cc}/u);
        expect(finding.fix).not.toMatch(/\p{Cc}/u);
      }
    });

    it("reports a very long alias without flooding the report", () => {
      page(root, "fenix.md", "", { title: "Fenix", aliases: ["x".repeat(10_000)] });
      page(root, "checkout.md", `Mentions ${"x".repeat(10_000)} here.`);
      index(root, ["fenix", "checkout"]);
      changelog(root, ["fenix", "checkout"]);

      const synonym = checkProject(root).findings.find((f) => f.code === "glossary.synonym");
      expect(synonym!.message.length).toBeLessThan(600);
    });
  });

  describe("finding locations", () => {
    it("reports the line in the file, not in the body", () => {
      // Reported lines used to land in the frontmatter, because the slug and
      // the alias appear in `id:` and `title:` before they appear in prose.
      page(root, "target.md");
      page(root, "fenix.md", "\nsome prose\n\nSee [[nowhere]] here.\n");
      index(root, ["fenix", "target"]);
      changelog(root, ["fenix", "target"]);

      const broken = checkProject(root).findings.find((f) => f.code === "wikilink.broken");
      const text = readFileSync(join(root, "wiki", "fenix.md"), "utf8");
      expect(text.split("\n")[broken!.line! - 1]).toContain("[[nowhere]]");
    });

    it("reports a codewiki section's line in the file too", () => {
      page(root, "codewiki/dispatch.md", "\n## Opinions\n\nNo citation here.\n");
      index(root, ["dispatch"]);
      changelog(root, ["dispatch"]);

      const finding = checkProject(root).findings.find(
        (f) => f.code === "codewiki.section-uncited",
      );
      const text = readFileSync(join(root, "wiki", "codewiki", "dispatch.md"), "utf8");
      expect(text.split("\n")[finding!.line! - 1]).toContain("## Opinions");
    });
  });

  describe("the page schema, re-checked after the fact", () => {
    it("reports a page that never went through the gate", () => {
      // A page written through the shell, or edited in another editor, passes
      // no gate at all — group 7 is the only thing between it and permanence.
      writeFileSync(join(root, "wiki", "raw-page.md"), "no frontmatter at all\n", "utf8");
      index(root, ["raw-page"]);
      changelog(root, ["raw-page"]);

      const findings = checkProject(root).findings.filter((f) => f.code === "page.invalid");
      expect(findings.length).toBeGreaterThan(0);
    });
  });

  describe("citedSourcePages", () => {
    it("maps a source to every page that cites it", () => {
      source(root, "notes.md");
      page(root, "a.md", "src://notes.md#p1");
      page(root, "b.md", "", { sources: ["src://notes.md#p2"] });

      const citations = citedSourcePages(readWiki(root));
      expect(citations.get("notes.md")?.sort()).toEqual(["wiki/a.md", "wiki/b.md"]);
    });

    it("lists a page once even when it cites the same source twice", () => {
      source(root, "notes.md");
      page(root, "a.md", "src://notes.md#p1 and again src://notes.md#p2");

      expect(citedSourcePages(readWiki(root)).get("notes.md")).toEqual(["wiki/a.md"]);
    });
  });

  describe("the report itself", () => {
    it("puts errors before warnings", () => {
      page(root, "fenix.md", "See [[nowhere]].");
      source(root, "unused.md");
      index(root, ["fenix"]);
      changelog(root, []);

      const findings = checkProject(root).findings;
      const firstWarning = findings.findIndex((f) => f.severity === "warning");
      const lastError = findings.map((f) => f.severity).lastIndexOf("error");
      expect(lastError).toBeLessThan(firstWarning);
    });

    it("gives every finding a correction path", () => {
      page(root, "fenix.md", "See [[nowhere]].");
      source(root, "unused.md");
      index(root, []);
      changelog(root, []);

      for (const finding of checkProject(root).findings) {
        expect(finding.fix.length).toBeGreaterThan(0);
      }
    });

    it("returns nothing at all for a project with no wiki", () => {
      rmSync(join(root, "wiki"), { recursive: true, force: true });
      const report = checkProject(root);
      expect(report.pages).toBe(0);
      expect(report.findings).toEqual([]);
    });
  });

  describe("sortFindings / hasErrors", () => {
    const error: Finding = { code: "page.orphan", severity: "error", message: "e", fix: "f" };
    const warning: Finding = {
      code: "source.uncited",
      severity: "warning",
      message: "w",
      fix: "f",
    };

    it("sorts errors first", () => {
      expect(sortFindings([warning, error])[0]).toBe(error);
    });

    it("says whether anything is an error", () => {
      expect(hasErrors([warning])).toBe(false);
      expect(hasErrors([warning, error])).toBe(true);
      expect(hasErrors([])).toBe(false);
    });
  });
});

describe("what a finding carries is scrubbed like what it says (adr:0023)", () => {
  it("bounds and strips a wikilink target the way it does the message", () => {
    // `message` and `fix` have gone through `safe()` since group 7; the fields
    // `adr:0023` added had not, and a security review carried a two-megabyte
    // target and a cursor escape straight into `ow check --json`.
    const root = tempProject();
    try {
      index(root, []);
      changelog(root, []);
      page(root, "fenix.md", `See [[${"x".repeat(5000)}]].`);
      const found = checkProject(root).findings.find((f) => f.code === "wikilink.broken");
      expect(found?.target).toBeDefined();
      expect(found!.target!.length).toBeLessThan(5000);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
