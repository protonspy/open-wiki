import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listEntityPages, isIndexed, findOrphans } from "../src/store/index.js";
import { registerInIndex } from "../src/store/index-write.js";

function tempProject() {
  const root = mkdtempSync(join(tmpdir(), "ow-idx-"));
  mkdirSync(join(root, "wiki"), { recursive: true });
  return root;
}

function writePage(root: string, slug: string) {
  writeFileSync(
    join(root, "wiki", `${slug}.md`),
    [
      "---",
      `id: project:${slug}`,
      "type: project",
      `title: ${slug}`,
      "status: active",
      "aliases: []",
      "updated: 2026-08-01",
      "sources: []",
      'superseded-by: ""',
      "---",
      "",
      `# ${slug}`,
      "",
    ].join("\n"),
  );
}

describe("isIndexed (5.7)", () => {
  it("recognises a plain link, a display alias and a heading fragment", () => {
    expect(isIndexed("[[fenix]] and [[ana|Ana]] and [[topic#x]]", "fenix")).toBe(true);
    expect(isIndexed("[[ana|Ana]]", "fenix")).toBe(false);
    expect(isIndexed("[[fenix-2]]", "fenix")).toBe(false); // not a prefix match
  });
});

describe("listEntityPages (5.7)", () => {
  it("lists entity page slugs and skips the non-entity pages", () => {
    const root = tempProject();
    writePage(root, "fenix");
    writePage(root, "ana");
    writeFileSync(join(root, "wiki", "index.md"), "# Index\n");
    writeFileSync(join(root, "wiki", "changelog.md"), "# Changelog\n");
    expect(listEntityPages(root).sort()).toEqual(["ana", "fenix"]);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("registerInIndex (5.7)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("creates the index with a Pages section and the link when absent", () => {
    expect(registerInIndex(root, "fenix", "Fenix")).toBe(true);
    const text = readFileSync(join(root, "wiki", "index.md"), "utf8");
    expect(text).toContain("## Pages");
    expect(text).toContain("- [[fenix]] — Fenix");
  });

  it("is idempotent — adding an already-indexed page changes nothing and returns false", () => {
    registerInIndex(root, "fenix");
    const before = readFileSync(join(root, "wiki", "index.md"), "utf8");
    expect(registerInIndex(root, "fenix")).toBe(false);
    expect(readFileSync(join(root, "wiki", "index.md"), "utf8")).toBe(before);
  });

  it("prepends a new link to an existing Pages section", () => {
    registerInIndex(root, "fenix");
    registerInIndex(root, "ana");
    const text = readFileSync(join(root, "wiki", "index.md"), "utf8");
    expect(text.indexOf("[[ana]]")).toBeLessThan(text.indexOf("[[fenix]]"));
  });

  it("does not disturb a hand-curated index with its own sections", () => {
    writeFileSync(join(root, "wiki", "index.md"), "# Index\n\nintro\n\n## Topic\n\n- [[topic]]\n");
    registerInIndex(root, "fenix");
    const text = readFileSync(join(root, "wiki", "index.md"), "utf8");
    expect(text).toContain("## Topic");
    expect(text).toContain("- [[topic]]");
    expect(text).toContain("## Pages");
  });
});

describe("findOrphans (5.7)", () => {
  let root: string;
  beforeEach(() => {
    root = tempProject();
    writePage(root, "fenix");
    writePage(root, "ana");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("flags pages nothing in the index links to", () => {
    expect(findOrphans(root).sort()).toEqual(["ana", "fenix"]);
  });

  it("a page is no longer an orphan once it is registered", () => {
    registerInIndex(root, "fenix");
    expect(findOrphans(root)).toEqual(["ana"]);
  });

  it("a page unlinked from the index surfaces as an orphan again", () => {
    registerInIndex(root, "fenix");
    registerInIndex(root, "ana");
    expect(findOrphans(root)).toEqual([]);
    // The agent removes fenix's only link.
    writeFileSync(join(root, "wiki", "index.md"), "# Index\n\n## Pages\n\n- [[ana]]\n");
    expect(findOrphans(root)).toEqual(["fenix"]);
  });
});
