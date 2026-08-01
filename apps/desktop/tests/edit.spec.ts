import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NoSuchPageError } from "../src/main/api.js";
import {
  createPage,
  deletePage,
  history,
  isStale,
  PageExistsError,
  renamePage,
  retitleSource,
  savePage,
  undoOperation,
} from "../src/main/edit.js";

let root: string;
const today = (): string => "2026-08-01";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ow-edit-"));
  for (const part of ["raw", "wiki", ".state"]) mkdirSync(join(root, part), { recursive: true });
  writeFileSync(join(root, "wiki", "index.md"), "# Index\n\n", "utf8");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A page that satisfies the group 5 schema. */
function page(slug: string, body = "body\n", over: Record<string, unknown> = {}): string {
  const front = {
    id: `topic:${slug}`,
    type: "topic",
    title: slug,
    status: "active",
    aliases: [],
    updated: "2026-07-01",
    sources: [],
    "superseded-by": "",
    ...over,
  };
  const yaml = Object.entries(front)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  return `---\n${yaml}\n---\n\n${body}`;
}

function write(slug: string, content: string): void {
  writeFileSync(join(root, "wiki", `${slug}.md`), content, "utf8");
}

describe("savePage (8.7)", () => {
  it("writes a valid page and returns what landed", () => {
    write("fenix", page("fenix"));
    const base = readFileSync(join(root, "wiki", "fenix.md"), "utf8");
    const result = savePage(
      root,
      { slug: "fenix", markdown: page("fenix", "new\n"), baseMarkdown: base },
      today,
    );
    expect(result.saved).toBe(true);
    expect(readFileSync(join(root, "wiki", "fenix.md"), "utf8")).toContain("new");
  });

  it("goes through the same gate the agent's writes go through", () => {
    // Group 5's claim is one implementation with three callers. An editor that
    // validated its own way would be a fourth, quietly disagreeing with the
    // hook about what a well-formed page is.
    write("fenix", page("fenix"));
    const base = readFileSync(join(root, "wiki", "fenix.md"), "utf8");
    const result = savePage(
      root,
      { slug: "fenix", markdown: "no frontmatter at all\n", baseMarkdown: base },
      today,
    );
    expect(result.saved).toBe(false);
    expect(result.saved === false && result.reason).toBe("invalid");
  });

  it("reports the store's own reasons, unchanged", () => {
    // 9.13: the message has three mouths and they have to say the same thing.
    write("fenix", page("fenix"));
    const base = readFileSync(join(root, "wiki", "fenix.md"), "utf8");
    const result = savePage(
      root,
      { slug: "fenix", markdown: page("fenix", "see [[ghost]]\n"), baseMarkdown: base },
      today,
    );
    expect(result.saved).toBe(false);
    if (result.saved === false && result.reason === "invalid") {
      expect(result.problems.join(" ")).toContain("ghost");
    }
  });

  it("hands back what landed, not what the editor sent", () => {
    // The store completes frontmatter on the way through (5.5), and 5.8 says
    // the editor must not then hold a buffer that no longer matches disk. So
    // what `savePage` returns is what the next save's base has to be.
    write("fenix", page("fenix"));
    const base = readFileSync(join(root, "wiki", "fenix.md"), "utf8");
    const result = savePage(
      root,
      { slug: "fenix", markdown: page("fenix", "body\n"), baseMarkdown: base },
      today,
    );
    expect(result.saved).toBe(true);
    expect(result.saved && result.markdown).toBe(
      readFileSync(join(root, "wiki", "fenix.md"), "utf8"),
    );
  });

  it("fills in a source the writer cited in the body but not in the field", () => {
    // 5.5 mirrors the body's citations into `sources` so it does not depend on
    // the writer remembering.
    mkdirSync(join(root, "raw", "arquitetura-fenix.pdf"), { recursive: true });
    writeFileSync(
      join(root, "raw", "arquitetura-fenix.pdf", "manifest.json"),
      JSON.stringify({ id: "arquitetura-fenix.pdf", title: "A", kind: "file", original: "a.pdf" }),
      "utf8",
    );
    write("fenix", page("fenix"));
    const base = readFileSync(join(root, "wiki", "fenix.md"), "utf8");
    const result = savePage(
      root,
      {
        slug: "fenix",
        markdown: page("fenix", "see src://arquitetura-fenix.pdf#p12\n"),
        baseMarkdown: base,
      },
      today,
    );
    expect(result.saved).toBe(true);
    expect(result.saved && result.markdown).toContain("arquitetura-fenix.pdf#p12");
  });

  it("refuses a slug that names no page", () => {
    expect(() =>
      savePage(root, { slug: "ghost", markdown: page("ghost"), baseMarkdown: "" }, today),
    ).toThrow(NoSuchPageError);
  });

  it("records an operation, so the write can be undone", () => {
    write("fenix", page("fenix"));
    const base = readFileSync(join(root, "wiki", "fenix.md"), "utf8");
    const result = savePage(
      root,
      { slug: "fenix", markdown: page("fenix", "new\n"), baseMarkdown: base },
      today,
    );
    expect(result.saved && result.operationId).toBeTruthy();
    expect(history(root).length).toBeGreaterThan(0);
  });
});

describe("savePage refusing a stale write (8.8)", () => {
  it("refuses when the page changed on disk since it was loaded", () => {
    write("fenix", page("fenix", "original\n"));
    const base = readFileSync(join(root, "wiki", "fenix.md"), "utf8");
    write("fenix", page("fenix", "somebody else's change\n"));

    const result = savePage(
      root,
      { slug: "fenix", markdown: page("fenix", "mine\n"), baseMarkdown: base },
      today,
    );
    expect(result.saved).toBe(false);
    expect(result.saved === false && result.reason).toBe("stale");
  });

  it("hands back what is on disk, so the writer can see what changed", () => {
    write("fenix", page("fenix", "original\n"));
    const base = readFileSync(join(root, "wiki", "fenix.md"), "utf8");
    write("fenix", page("fenix", "theirs\n"));
    const result = savePage(
      root,
      { slug: "fenix", markdown: page("fenix", "mine\n"), baseMarkdown: base },
      today,
    );
    if (result.saved === false && result.reason === "stale") {
      expect(result.onDisk).toContain("theirs");
    }
  });

  it("does not lose the change it refused", () => {
    write("fenix", page("fenix", "original\n"));
    const base = readFileSync(join(root, "wiki", "fenix.md"), "utf8");
    write("fenix", page("fenix", "theirs\n"));
    savePage(root, { slug: "fenix", markdown: page("fenix", "mine\n"), baseMarkdown: base }, today);
    expect(readFileSync(join(root, "wiki", "fenix.md"), "utf8")).toContain("theirs");
  });
});

describe("isStale (8.8, against 5.8)", () => {
  it("is false when nothing moved", () => {
    expect(isStale(page("a"), page("a"))).toBe(false);
  });

  it("is true when somebody else edited the body", () => {
    expect(isStale(page("a", "mine\n"), page("a", "theirs\n"))).toBe(true);
  });

  it("is false when the only difference is a field the store manages", () => {
    // 5.8: a correction the store made is not somebody else's edit. The editor
    // fills `updated` on save, and the next save from the same buffer would
    // otherwise look stale against a change the writer did not make.
    expect(isStale(page("a", "body\n"), page("a", "body\n", { updated: "2026-08-01" }))).toBe(
      false,
    );
  });
});

describe("createPage (8.9)", () => {
  it("creates a page and registers it in the index", () => {
    const result = createPage(root, { slug: "novo", markdown: page("novo") }, today);
    expect(result.saved).toBe(true);
    expect(existsSync(join(root, "wiki", "novo.md"))).toBe(true);
    expect(readFileSync(join(root, "wiki", "index.md"), "utf8")).toContain("novo");
  });

  it("refuses a slug that is already taken", () => {
    write("fenix", page("fenix"));
    expect(() => createPage(root, { slug: "fenix", markdown: page("fenix") }, today)).toThrow(
      PageExistsError,
    );
  });

  it("validates the new page like any other write", () => {
    const result = createPage(root, { slug: "novo", markdown: "nothing\n" }, today);
    expect(result.saved).toBe(false);
    expect(existsSync(join(root, "wiki", "novo.md"))).toBe(false);
  });
});

describe("renamePage (8.9)", () => {
  it("moves the page and repoints what pointed at it", () => {
    // A rename that leaves the links behind turns every one of them into a 7.1
    // finding, and the person who renamed the page is the one who knew they
    // all meant it.
    write("fenix", page("fenix"));
    write("weekly", page("weekly", "see [[fenix]] and [[fenix|the project]]\n"));

    const result = renamePage(root, "fenix", "phoenix");
    expect(existsSync(join(root, "wiki", "phoenix.md"))).toBe(true);
    expect(existsSync(join(root, "wiki", "fenix.md"))).toBe(false);
    expect(result.repointed).toEqual(["weekly"]);

    const weekly = readFileSync(join(root, "wiki", "weekly.md"), "utf8");
    expect(weekly).toContain("[[phoenix]]");
    expect(weekly).toContain("[[phoenix|the project]]");
  });

  it("does not repoint a link that merely starts the same way", () => {
    write("fenix", page("fenix"));
    write("weekly", page("weekly", "see [[fenix-two]]\n"));
    write("fenix-two", page("fenix-two"));
    renamePage(root, "fenix", "phoenix");
    expect(readFileSync(join(root, "wiki", "weekly.md"), "utf8")).toContain("[[fenix-two]]");
  });

  it("brings the page's own id with it, or 5.1 refuses it forever", () => {
    write("fenix", page("fenix"));
    renamePage(root, "fenix", "phoenix");
    expect(readFileSync(join(root, "wiki", "phoenix.md"), "utf8")).toContain("topic:phoenix");
  });

  it("keeps the page on the shelf it was on", () => {
    mkdirSync(join(root, "wiki", "projects"), { recursive: true });
    writeFileSync(join(root, "wiki", "projects", "fenix.md"), page("fenix"), "utf8");
    renamePage(root, "fenix", "phoenix");
    expect(existsSync(join(root, "wiki", "projects", "phoenix.md"))).toBe(true);
  });

  it("refuses a name that is already taken", () => {
    write("fenix", page("fenix"));
    write("phoenix", page("phoenix"));
    expect(() => renamePage(root, "fenix", "phoenix")).toThrow(PageExistsError);
  });

  it("is one operation, so undo puts the whole rename back", () => {
    write("fenix", page("fenix"));
    write("weekly", page("weekly", "see [[fenix]]\n"));
    const result = renamePage(root, "fenix", "phoenix");

    undoOperation(root, result.operationId);
    expect(existsSync(join(root, "wiki", "fenix.md"))).toBe(true);
    expect(existsSync(join(root, "wiki", "phoenix.md"))).toBe(false);
    expect(readFileSync(join(root, "wiki", "weekly.md"), "utf8")).toContain("[[fenix]]");
  });
});

describe("deletePage (8.9)", () => {
  it("removes the page", () => {
    write("fenix", page("fenix"));
    deletePage(root, "fenix");
    expect(existsSync(join(root, "wiki", "fenix.md"))).toBe(false);
  });

  it("leaves the links that pointed at it alone", () => {
    // A wikilink to a deleted page is a 7.1 finding and should be: the links
    // are the record that something was expected to be there. A rename knows
    // where the reader should go instead; a delete does not.
    write("fenix", page("fenix"));
    write("weekly", page("weekly", "see [[fenix]]\n"));
    deletePage(root, "fenix");
    expect(readFileSync(join(root, "wiki", "weekly.md"), "utf8")).toContain("[[fenix]]");
  });

  it("can be undone", () => {
    write("fenix", page("fenix", "the only copy\n"));
    const { operationId } = deletePage(root, "fenix");
    undoOperation(root, operationId);
    expect(readFileSync(join(root, "wiki", "fenix.md"), "utf8")).toContain("the only copy");
  });

  it("refuses a slug that names no page", () => {
    expect(() => deletePage(root, "ghost")).toThrow(NoSuchPageError);
  });
});

describe("history (8.11)", () => {
  it("is newest first", () => {
    write("a", page("a"));
    write("b", page("b"));
    const first = savePage(
      root,
      { slug: "a", markdown: page("a", "1\n"), baseMarkdown: page("a") },
      today,
    );
    const second = savePage(
      root,
      { slug: "b", markdown: page("b", "2\n"), baseMarkdown: page("b") },
      today,
    );
    expect(first.saved && second.saved).toBe(true);
    expect(history(root)[0]?.id).toBe(second.saved ? second.operationId : "");
  });

  it("is bounded", () => {
    write("a", page("a"));
    for (let i = 0; i < 5; i++) {
      const base = readFileSync(join(root, "wiki", "a.md"), "utf8");
      savePage(root, { slug: "a", markdown: page("a", `${i}\n`), baseMarkdown: base }, today);
    }
    expect(history(root, 2)).toHaveLength(2);
  });
});

describe("retitleSource (6.7)", () => {
  function source(id: string, title: string): void {
    mkdirSync(join(root, "raw", id), { recursive: true });
    writeFileSync(
      join(root, "raw", id, "manifest.json"),
      JSON.stringify({ id, title, kind: "file", original: "source.pdf" }),
      "utf8",
    );
  }

  it("corrects the readable title", () => {
    // `adr:0011` freezes the id and says the freeze is only bearable if the
    // readable name stays editable.
    source("arquitetura-fenix.pdf", "Arquitetura Fenix");
    retitleSource(root, "arquitetura-fenix.pdf", "Arquitetura do Fenix — v2");
    const manifest = JSON.parse(
      readFileSync(join(root, "raw", "arquitetura-fenix.pdf", "manifest.json"), "utf8"),
    ) as { id: string; title: string };
    expect(manifest.title).toBe("Arquitetura do Fenix — v2");
  });

  it("does not move the directory or change the id a citation points at", () => {
    source("arquitetura-fenix.pdf", "Arquitetura Fenix");
    retitleSource(root, "arquitetura-fenix.pdf", "Something else entirely");
    expect(existsSync(join(root, "raw", "arquitetura-fenix.pdf"))).toBe(true);
    const manifest = JSON.parse(
      readFileSync(join(root, "raw", "arquitetura-fenix.pdf", "manifest.json"), "utf8"),
    ) as { id: string };
    expect(manifest.id).toBe("arquitetura-fenix.pdf");
  });

  it("refuses an id that is not a source", () => {
    expect(() => retitleSource(root, "../../elsewhere", "x")).toThrow();
  });
});
