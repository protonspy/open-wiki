import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Finding } from "@open-wiki/access";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IndexedPage } from "../src/main/api.js";
import { wikiIndex } from "../src/main/api.js";
import {
  citationLabel,
  FRAGMENT_ATTR,
  renderPageBody,
  SOURCE_ATTR,
} from "../src/renderer/markdown.js";
import { chipsOf, readerState } from "../src/renderer/Reader.js";
import { findingsFor } from "../src/renderer/Side.js";
import { groupPages, keyOfPage } from "../src/renderer/Tree.js";
import { groupOfPage, titleOfPage } from "../src/shared/pages.js";

/** A page as the index hands it to the tree. */
function indexed(path: string, title: string, group: string | null): IndexedPage {
  const slug = path.slice(path.lastIndexOf("/") + 1, -3);
  return { slug, path, codewiki: false, title, group };
}

/** The one stylesheet, read from disk — it is what ships, not a fixture. */
function stylesheet(): string {
  return readFileSync(
    fileURLToPath(new URL("../src/renderer/globals.css", import.meta.url)),
    "utf8",
  );
}

/**
 * The wiki pane (spec `wiki-pane`): what the tree reads, what the reader shows,
 * and what sits beside it.
 *
 * These assert the requirements rather than the rendering. There is no DOM in
 * this suite by design — every decision a component would otherwise bury is a
 * function here, which is the same shape `ui.spec.ts` uses for the primitives.
 */

describe("groupOfPage (R1.1, R1.2)", () => {
  it("groups a page by the folder it sits in under wiki/", () => {
    expect(groupOfPage("wiki/topics/retention.md")).toBe("topics");
    expect(groupOfPage("wiki/people/renata-alves.md")).toBe("people");
  });

  it("gives a page at the top of the wiki no group at all", () => {
    // R1.2 — listed without a header. `null`, not "" and not a bucket with an
    // invented name: there is no such folder to name.
    expect(groupOfPage("wiki/fenix.md")).toBeNull();
  });

  it("takes the first folder, so a nested page joins the band above it", () => {
    expect(groupOfPage("wiki/topics/legal/retention.md")).toBe("topics");
  });

  it("groups codewiki like any other folder", () => {
    // `adr:0016` — codewiki is where a page sits, not what it is addressed by.
    expect(groupOfPage("wiki/codewiki/dispatch.md")).toBe("codewiki");
  });
});

describe("titleOfPage (R1.3)", () => {
  it("takes the title the page declares", () => {
    expect(titleOfPage({ title: "Fenix migration" }, "fenix-migration")).toBe("Fenix migration");
  });

  it("falls back to the slug when there is no frontmatter at all", () => {
    expect(titleOfPage(null, "fenix-migration")).toBe("fenix-migration");
  });

  it("falls back to the slug when the title is missing or not a string", () => {
    expect(titleOfPage({ type: "topic" }, "retention")).toBe("retention");
    expect(titleOfPage({ title: 12 }, "retention")).toBe("retention");
  });

  it("falls back to the slug when the title is blank", () => {
    // An entry with nothing to click on is worse than one named by its slug.
    expect(titleOfPage({ title: "   " }, "retention")).toBe("retention");
  });

  it("trims what it shows", () => {
    expect(titleOfPage({ title: "  Data retention\n" }, "retention")).toBe("Data retention");
  });
});

describe("wikiIndex, as the tree reads it (R1.1, R1.3, R1.6)", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ow-wiki-pane-"));
    for (const part of ["raw", "wiki", ".state"]) mkdirSync(join(root, part), { recursive: true });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function page(rel: string, front: Record<string, unknown> | null, body = "body\n"): void {
    const file = join(root, "wiki", rel);
    mkdirSync(join(file, ".."), { recursive: true });
    const yaml = front
      ? `---\n${Object.entries(front)
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join("\n")}\n---\n\n`
      : "";
    writeFileSync(file, `${yaml}${body}`, "utf8");
  }

  const find = (slug: string): ReturnType<typeof wikiIndex>["pages"][number] => {
    const found = wikiIndex(root).pages.find((p) => p.slug === slug);
    if (!found) throw new Error(`no page ${slug} in the index`);
    return found;
  };

  it("carries each page's title and the folder it is grouped under", () => {
    page("topics/retention.md", { title: "Data retention" });
    expect(find("retention")).toMatchObject({ title: "Data retention", group: "topics" });
  });

  it("gives a page at the top of the wiki no group", () => {
    page("fenix.md", { title: "Fenix migration" });
    expect(find("fenix")).toMatchObject({ title: "Fenix migration", group: null });
  });

  it("lists a page with no frontmatter under its slug rather than dropping it", () => {
    // Malformed is a group 7 finding, and a wiki that hides its broken pages is
    // a wiki nobody fixes.
    page("topics/orphan.md", null);
    expect(find("orphan")).toMatchObject({ title: "orphan", group: "topics" });
  });

  it("lists a page whose frontmatter will not parse under its slug", () => {
    writeFileSync(join(root, "wiki", "broken.md"), "---\ntitle: [unclosed\n---\n\nbody\n", "utf8");
    expect(find("broken").title).toBe("broken");
  });

  it("shows both pages that share a slug, rather than resolving the duplicate", () => {
    // R1.6 — the duplicate is `page.duplicate-slug`, a finding. Picking one
    // here would hide the very thing the check exists to report.
    page("topics/retention.md", { title: "Data retention" });
    page("people/retention.md", { title: "Retention, the person" });
    const both = wikiIndex(root).pages.filter((p) => p.slug === "retention");
    expect(both.map((p) => p.group).sort()).toEqual(["people", "topics"]);
  });

  it("still answers the slugs a wikilink is resolved against", () => {
    page("topics/retention.md", { title: "Data retention" });
    page("fenix.md", { title: "Fenix migration" });
    expect(wikiIndex(root).slugs.sort()).toEqual(["fenix", "retention"]);
  });
});

describe("groupPages (R1.1, R1.2, R1.6)", () => {
  it("puts each page in the band of the folder it sits in", () => {
    const bands = groupPages([
      indexed("wiki/topics/retention.md", "Data retention", "topics"),
      indexed("wiki/people/renata.md", "Renata Alves", "people"),
      indexed("wiki/topics/cutover.md", "Cutover window", "topics"),
    ]);
    expect(bands.map((b) => b.group)).toEqual(["people", "topics"]);
    expect(bands[1]?.pages.map((p) => p.slug)).toEqual(["cutover", "retention"]);
  });

  it("reads the pages at the top of the wiki first, under no header", () => {
    // R1.2 — the scaffolded skill writes `wiki/<slug>.md`, so on most projects
    // this band is the whole wiki. Below three named ones it would read as a
    // footnote to them.
    const bands = groupPages([
      indexed("wiki/topics/retention.md", "Data retention", "topics"),
      indexed("wiki/fenix.md", "Fenix migration", null),
    ]);
    expect(bands.map((b) => b.group)).toEqual([null, "topics"]);
  });

  it("orders pages by what they are called, not by what the disk returned", () => {
    const bands = groupPages([
      indexed("wiki/b.md", "zebra", null),
      indexed("wiki/a.md", "Apple", null),
      indexed("wiki/c.md", "banana", null),
    ]);
    expect(bands[0]?.pages.map((p) => p.title)).toEqual(["Apple", "banana", "zebra"]);
  });

  it("keeps both pages that share a slug, in whichever bands they sit in", () => {
    const bands = groupPages([
      indexed("wiki/topics/retention.md", "Data retention", "topics"),
      indexed("wiki/people/retention.md", "Retention, the person", "people"),
    ]);
    expect(bands.flatMap((b) => b.pages)).toHaveLength(2);
  });

  it("is empty for an empty wiki rather than inventing a band", () => {
    expect(groupPages([])).toEqual([]);
  });
});

describe("keyOfPage (R1.6)", () => {
  it("keys by the path, so two pages sharing a slug stay two entries", () => {
    // Keyed by slug, React would treat the second as a re-render of the first
    // and one of them would vanish — which is the disappearance R1.6 exists to
    // prevent, and `page.duplicate-slug` exists to report.
    const a = indexed("wiki/topics/retention.md", "Data retention", "topics");
    const b = indexed("wiki/people/retention.md", "Retention, the person", "people");
    expect(a.slug).toBe(b.slug);
    expect(keyOfPage(a)).not.toBe(keyOfPage(b));
  });
});

describe("the tree, as it ships (R1.4, R1.5)", () => {
  it("opens a page by its slug and never by its path", () => {
    // `adr:0016-a-page-is-its-slug-wherever-it-sits`: the band is presentation,
    // and the day something downstream takes a path from here, the folder has
    // quietly become a second addressing scheme.
    const source = readFileSync(
      fileURLToPath(new URL("../src/renderer/Tree.tsx", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("onOpen(page.slug)");
    expect(source).not.toContain("onOpen(page.path)");
  });

  it("marks the open page with more than a colour", () => {
    // R1.5 — the same guarantee `ui.spec` makes for focus: the state has to
    // survive a reader who cannot tell the two colours apart, so it carries a
    // background as well.
    expect(stylesheet()).toMatch(/\.tree-item\[aria-current="true"\]\s*\{[^}]*background:/);
  });
});

describe("chipsOf (R2.2)", () => {
  it("shows each frontmatter entry as its own chip", () => {
    expect(chipsOf({ id: "topic:retention", type: "topic", status: "active" })).toEqual([
      { key: "id", value: "topic:retention" },
      { key: "type", value: "topic" },
      { key: "status", value: "active" },
    ]);
  });

  it("shows an array as how many, the way the draft's sources chip does", () => {
    const chips = chipsOf({ sources: ["src://a.pdf#p1", "rec://w#14:32"] });
    expect(chips).toEqual([{ key: "sources", value: "2" }]);
  });

  it("drops an entry with nothing to show", () => {
    // Every page carries `superseded-by: ""` because the schema asks for the
    // field. A chip with a blank after it says the page was replaced by
    // nothing, which is not what an empty field means.
    expect(chipsOf({ "superseded-by": "", aliases: [], title: "Data retention" })).toEqual([
      { key: "title", value: "Data retention" },
    ]);
  });

  it("has nothing to show for a page with no frontmatter", () => {
    expect(chipsOf(null)).toEqual([]);
  });

  it("shows a number and a date as themselves", () => {
    expect(chipsOf({ updated: "2026-07-31", revision: 3 })).toEqual([
      { key: "updated", value: "2026-07-31" },
      { key: "revision", value: "3" },
    ]);
  });
});

describe("citationLabel (R2.7)", () => {
  it("reads a recording citation as its instant", () => {
    expect(citationLabel("rec", "14:32")).toBe("14:32");
  });

  it("reads a document citation as its page, written the way a page is", () => {
    expect(citationLabel("src", "p12")).toBe("p.12");
  });

  it("leaves a fragment it does not recognise alone", () => {
    // The fragment is what `resolveProvenance` validates and what 8.6 seeks
    // by. Inventing a rendering for a shape nobody defined would be this
    // window deciding what a citation means.
    expect(citationLabel("src", "14:32")).toBe("14:32");
  });
});

describe("the citation chip, as it ships (R2.4, R2.7)", () => {
  const html = renderPageBody("decided here rec://weekly#14:32 and here src://a.pdf#p12\n", {
    slugs: [],
  });

  it("reads as its fragment rather than as forty characters of URL", () => {
    expect(html).toContain(">14:32<");
    expect(html).toContain(">p.12<");
    expect(html).not.toContain("rec://weekly#14:32<");
  });

  it("still carries the id and the fragment the seek uses", () => {
    expect(html).toContain(`${SOURCE_ATTR}="weekly"`);
    expect(html).toContain(`${FRAGMENT_ATTR}="14:32"`);
  });

  it("says which kind of source each one opens", () => {
    expect(html).toContain("provenance--rec");
    expect(html).toContain("provenance--src");
    // The icon hangs off that class, because markdown-it emits HTML and cannot
    // render a React component.
    const css = stylesheet();
    expect(css).toMatch(/\.provenance--rec::before\s*\{[^}]*mask-image:/);
    expect(css).toMatch(/\.provenance--src::before\s*\{[^}]*mask-image:/);
  });
});

describe("what can be done to the open page (R2.6)", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/renderer/WikiPane.tsx", import.meta.url)),
    "utf8",
  );

  it("offers edit, rename and delete, each with a name a screen reader can read", () => {
    // The plate that made this a requirement: the four controls that did
    // nothing (plan 1.1). An icon-only button with no accessible name is the
    // next version of the same failure.
    expect(source).toContain('label="Edit this page"');
    expect(source).toContain('label="Rename this page"');
    expect(source).toContain('label="Delete this page"');
  });

  it("offers them only while a page is open", () => {
    expect(source).toContain("{page ? (");
  });
});

describe("findingsFor (R3.4)", () => {
  const finding = (code: string, page?: string): Finding => ({
    code: code as Finding["code"],
    severity: "error",
    message: `${code} happened`,
    fix: "do the thing",
    ...(page === undefined ? {} : { page }),
  });

  it("takes the findings about this page and leaves the rest", () => {
    const all = [
      finding("wikilink.broken", "wiki/topics/retention.md"),
      finding("page.orphan", "wiki/fenix.md"),
      finding("source.uncited"),
    ];
    expect(findingsFor(all, "wiki/topics/retention.md").map((f) => f.code)).toEqual([
      "wikilink.broken",
    ]);
  });

  it("matches on the path a finding actually carries, never on the slug", () => {
    // A finding's `page` is where the file is. Comparing it against `retention`
    // would match nothing at all, on every page, and silently: the section
    // would simply never appear.
    const all = [finding("wikilink.broken", "wiki/topics/retention.md")];
    expect(findingsFor(all, "retention")).toEqual([]);
  });

  it("is empty when the checks found nothing about this page", () => {
    expect(findingsFor([], "wiki/fenix.md")).toEqual([]);
  });
});

describe("the side column, as it ships (R3.1, R3.3, R3.5)", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/renderer/Side.tsx", import.meta.url)),
    "utf8",
  );

  it("opens a source at the fragment the backend gave it, not at one it made up", () => {
    // The same call a citation in the prose makes, so the panel that opens is
    // the same panel — and `p1` / `0:00` are the anchors the writers actually
    // write, which is why the fragment is never invented here.
    expect(source).toContain("onOpen(source.id, source.fragment)");
  });

  it("shows a citation whose source is missing rather than dropping it", () => {
    // R3.3 — hiding it would leave the reader believing the page is sourced,
    // which is the one wrong answer available here.
    expect(source).toContain("src-card--broken");
  });

  it("omits a section with nothing in it rather than heading an empty list", () => {
    expect(source).toContain("if (!sources || sources.length === 0) return null;");
    expect(source).toContain("if (mine.length === 0) return null;");
  });

  it("draws a broken card as not clickable, because there is nothing to open", () => {
    expect(stylesheet()).toMatch(/\.src-card--broken\s*\{[^}]*cursor:\s*default/);
  });
});

describe("readerState (R4)", () => {
  it("tells a wiki nobody has read yet from one that is empty", () => {
    // The window opens with an empty index and fills it a moment later. Treated
    // as one state, every launch of a real project would greet the user with
    // "this wiki is empty, and this window is not what fills it".
    expect(readerState({ pageCount: null, loaded: false, failed: false })).toBe("loading-wiki");
    expect(readerState({ pageCount: 0, loaded: false, failed: false })).toBe("empty-wiki");
  });

  it("says the wiki is empty before anything else", () => {
    // R4.3 — with no pages there is nothing a selection could mean, and whose
    // job it is to write them is the thing worth saying.
    expect(readerState({ pageCount: 0, selection: "fenix", loaded: false, failed: false })).toBe(
      "empty-wiki",
    );
  });

  it("says nothing is picked when nothing is picked", () => {
    expect(readerState({ pageCount: 3, loaded: false, failed: false })).toBe("no-selection");
  });

  it("says it is opening while the page is on its way", () => {
    // R4.2 — this rendered nothing before, which reads as "this page is empty".
    expect(readerState({ pageCount: 3, selection: "fenix", loaded: false, failed: false })).toBe(
      "loading",
    );
  });

  it("tells a page that failed to load apart from one still loading", () => {
    expect(readerState({ pageCount: 3, selection: "fenix", loaded: false, failed: true })).toBe(
      "failed",
    );
  });

  it("shows the page once it is in hand", () => {
    expect(readerState({ pageCount: 3, selection: "fenix", loaded: true, failed: false })).toBe(
      "page",
    );
  });
});
