import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaceWordInPage } from "../src/write/replace-word.js";
import { checkProject } from "../src/check/checks.js";

/**
 * desktop-ui 5.6 — the write behind the *Replace* button on a
 * `glossary.synonym` finding, and the one property that matters about it:
 * **it rewrites exactly what the check counted.**
 *
 * The vocabulary check strips fenced code, inline code and wikilinks before it
 * looks, because code is literal and a wikilink to an alias is a legitimate way
 * to reach the page. A rewrite that stripped a different set would change a
 * word nobody complained about, or leave the finding standing after the button
 * said it had fixed it. So the two share `store/prose.ts`, and the tests below
 * assert they *agree* rather than asserting each alone.
 */

const DATE = "2026-08-03";

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "ow-replace-"));
  for (const part of ["wiki", ".state"]) mkdirSync(join(root, part), { recursive: true });
  writeFileSync(join(root, "wiki", "index.md"), "# Index\n\n- [[fenix]]\n- [[totals]]\n", "utf8");
  return root;
}

function page(root: string, slug: string, body: string, aliases: string[] = []): void {
  writeFileSync(
    join(root, "wiki", `${slug}.md`),
    `---\nid: topic:${slug}\ntype: topic\ntitle: ${slug}\nstatus: active\n` +
      `aliases: [${aliases.map((a) => `"${a}"`).join(", ")}]\nupdated: ${DATE}\n` +
      `sources: []\nsuperseded-by: ""\n---\n${body}`,
    "utf8",
  );
}

function read(root: string, slug: string): string {
  return readFileSync(join(root, "wiki", `${slug}.md`), "utf8");
}

describe("replaceWordInPage", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("rewrites the word in the prose, and says how many", () => {
    page(root, "fenix", "The grand total is the grand total.\n");
    const result = replaceWordInPage(
      root,
      "wiki/fenix.md",
      "grand total",
      "order total",
      DATE,
      "editor",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.replaced).toBe(2);
    expect(read(root, "fenix")).toContain("The order total is the order total.");
  });

  it("matches the way the check matches — case-insensitively, on whole words", () => {
    page(root, "fenix", "Grand Total here, grand-total-ish there, grandtotal nowhere.\n");
    const result = replaceWordInPage(
      root,
      "wiki/fenix.md",
      "grand total",
      "order total",
      DATE,
      "editor",
    );
    expect(result.ok && result.replaced).toBe(1);
    const body = read(root, "fenix");
    expect(body).toContain("order total here");
    // A hyphen either side is not a word boundary, and neither is a letter.
    expect(body).toContain("grand-total-ish");
    expect(body).toContain("grandtotal");
  });

  it("leaves code and wikilinks alone, because the check does not read them", () => {
    // The link is piped — `[[totals|grand total]]` — because that is the case
    // the check actually excuses: "a wikilink to an alias is a legitimate way
    // to reach the page". A bare `[[grand total]]` is a broken link, and the
    // gate refuses the write for that instead, which would test the gate.
    page(root, "totals", "The canonical page.\n");
    page(
      root,
      "fenix",
      "The grand total matters.\n\n```\nconst grand total = 1;\n```\n\n" +
        "Inline `grand total` and a link [[totals|grand total]].\n",
    );
    const result = replaceWordInPage(
      root,
      "wiki/fenix.md",
      "grand total",
      "order total",
      DATE,
      "editor",
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.ok && result.replaced).toBe(1);
    const body = read(root, "fenix");
    expect(body).toContain("const grand total = 1;");
    expect(body).toContain("`grand total`");
    expect(body).toContain("[[totals|grand total]]");
    expect(body).toContain("The order total matters.");
  });

  it("never touches the frontmatter", () => {
    // `title`, `id` and `aliases` are the page's identity and the glossary's own
    // definitions. A synonym sweep that rewrote a title would rename the concept
    // it was trying to spell consistently.
    //
    // Asserted on the *block* rather than on its formatting: the gate
    // re-serialises the frontmatter it accepts, so pinning `aliases: ["…"]`
    // would be a test of YAML style. What matters is that the alias survived
    // and the prose did not.
    page(root, "fenix", "The grand total.\n", ["grand total"]);
    replaceWordInPage(root, "wiki/fenix.md", "grand total", "order total", DATE, "editor");
    const written = read(root, "fenix");
    const front = written.slice(0, written.indexOf("\n---", 4));
    expect(front).toContain("grand total");
    expect(written.slice(front.length)).not.toContain("grand total");
  });

  it("clears the finding it was offered from — the property that matters", () => {
    // Asserted through `checkProject` rather than against the rewrite alone: the
    // two share one definition of prose, and what this pins is that they agree.
    page(root, "totals", "The canonical page.\n", ["grand total"]);
    page(root, "fenix", "We compute the grand total each night.\n");
    const before = checkProject(root).findings.filter((f) => f.code === "glossary.synonym");
    expect(before).toHaveLength(1);
    const found = before[0]!;
    expect(found.replace).toEqual({ avoid: "grand total", use: "totals" });

    const result = replaceWordInPage(
      root,
      found.page!,
      found.replace!.avoid,
      found.replace!.use,
      DATE,
      "editor",
    );
    expect(result.ok).toBe(true);
    expect(checkProject(root).findings.filter((f) => f.code === "glossary.synonym")).toEqual([]);
  });

  it("says so rather than writing when the word is only in code", () => {
    // The check would not have reported this page, so there is nothing to fix —
    // and a write that changed a fenced block would be the button doing harm.
    page(root, "fenix", "Nothing here.\n\n```\ngrand total\n```\n");
    const result = replaceWordInPage(
      root,
      "wiki/fenix.md",
      "grand total",
      "order total",
      DATE,
      "editor",
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/outside code and wikilinks/);
    expect(read(root, "fenix")).toContain("grand total");
  });

  it("refuses a page that is not there, and one that escapes the project", () => {
    expect(replaceWordInPage(root, "wiki/ghost.md", "a", "b", DATE, "editor").ok).toBe(false);
    expect(() => replaceWordInPage(root, "../escape.md", "a", "b", DATE, "editor")).toThrow();
  });

  it("refuses an empty word on either side", () => {
    page(root, "fenix", "The grand total.\n");
    expect(replaceWordInPage(root, "wiki/fenix.md", "", "x", DATE, "editor").ok).toBe(false);
    expect(replaceWordInPage(root, "wiki/fenix.md", "x", "  ", DATE, "editor").ok).toBe(false);
  });

  it("goes through the gate, so the write is undoable like any other", () => {
    page(root, "fenix", "The grand total.\n");
    const result = replaceWordInPage(
      root,
      "wiki/fenix.md",
      "grand total",
      "order total",
      DATE,
      "editor",
    );
    expect(result.ok && result.operationId).toBeTruthy();
  });
});

describe("what the rewrite may reach (security review)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("refuses a path outside wiki/, not merely outside the project", () => {
    // `gateWrite` refuses `.claude/`, `.mcp.json` and `CLAUDE.md` and *allows*
    // everything else outside `wiki/`, so confining to the project left this
    // able to rewrite `package.json`, a workflow, an ADR or a spec. A review
    // did exactly that. The legitimate caller only ever passes `finding.page`,
    // but the IPC channel enforces none of that.
    writeFileSync(join(root, "package.json"), '{"name":"victim-project"}\n', "utf8");
    expect(() =>
      replaceWordInPage(root, "package.json", "victim-project", "pwned", DATE, "editor"),
    ).toThrow();
    expect(readFileSync(join(root, "package.json"), "utf8")).toContain("victim-project");
  });

  it("refuses a traversal that climbs out of wiki/", () => {
    writeFileSync(join(root, "CLAUDE.md"), "the project's own instructions\n", "utf8");
    expect(() =>
      replaceWordInPage(root, "wiki/../CLAUDE.md", "instructions", "x", DATE, "editor"),
    ).toThrow();
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toContain("instructions");
  });

  it("still writes an ordinary page under wiki/", () => {
    page(root, "fenix", "The grand total.\n");
    expect(
      replaceWordInPage(root, "wiki/fenix.md", "grand total", "order total", DATE, "editor").ok,
    ).toBe(true);
  });
});
