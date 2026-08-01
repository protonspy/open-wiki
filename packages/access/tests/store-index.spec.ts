import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  listEntityPages,
  listPages,
  pagePath,
  isIndexed,
  findOrphans,
  readIndex,
} from "../src/store/index.js";
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

describe("listPages / pagePath — a page is its slug wherever it sits (adr:0016)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ow-listpages-"));
    mkdirSync(join(root, "wiki"), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const write = (rel: string): void => {
    const file = join(root, "wiki", rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "# page\n", "utf8");
  };

  it("finds a page at any depth, and says where it is", () => {
    write("flat.md");
    write("topics/checkout.md");
    write("codewiki/dispatch.md");

    expect(listPages(root).map((p) => [p.slug, p.path])).toEqual([
      ["dispatch", "wiki/codewiki/dispatch.md"],
      ["flat", "wiki/flat.md"],
      ["checkout", "wiki/topics/checkout.md"],
    ]);
  });

  it("marks only the pages under codewiki/", () => {
    write("topics/checkout.md");
    write("codewiki/dispatch.md");
    const byCodewiki = Object.fromEntries(listPages(root).map((p) => [p.slug, p.codewiki]));
    expect(byCodewiki).toEqual({ checkout: false, dispatch: true });
  });

  it("excludes the wiki's own three pages, at the top level only", () => {
    write("index.md");
    write("changelog.md");
    write("log.md");
    write("topics/index.md");
    expect(listPages(root).map((p) => p.path)).toEqual(["wiki/topics/index.md"]);
  });

  it("does not follow a symlinked directory out of the project", () => {
    const outside = mkdtempSync(join(tmpdir(), "ow-outside-"));
    try {
      writeFileSync(join(outside, "secret.md"), "# secret\n", "utf8");
      try {
        symlinkSync(outside, join(root, "wiki", "escape"));
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") return;
        throw err;
      }
      expect(listPages(root)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("returns nothing when there is no wiki, and creates nothing", () => {
    rmSync(join(root, "wiki"), { recursive: true, force: true });
    expect(listPages(root)).toEqual([]);
    expect(existsSync(join(root, "wiki"))).toBe(false);
  });

  it("pagePath resolves a slug to where the file actually is", () => {
    write("topics/checkout.md");
    expect(pagePath(root, "checkout")).toBe("wiki/topics/checkout.md");
    expect(pagePath(root, "nothing")).toBeUndefined();
  });

  it("readIndex creates no directory — a read must not write", () => {
    // checkProject is exported into the read-only surface the MCP process
    // imports; a read that mkdirs makes every caller a writer, and `ow check`
    // in the wrong directory would leave a wiki/ behind.
    rmSync(join(root, "wiki"), { recursive: true, force: true });
    readIndex(root);
    expect(existsSync(join(root, "wiki"))).toBe(false);
  });

  it("isIndexed treats a slug carrying regex metacharacters literally", () => {
    expect(isIndexed("- [[a.b]]", "a.b")).toBe(true);
    // `(.*)` as a slug would otherwise match any wikilink and mark itself indexed.
    expect(isIndexed("- [[something]]", "(.*)")).toBe(false);
  });
});
