import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractHeadings,
  headingId,
  opensWithHeading,
  renderPageBody,
} from "../src/renderer/markdown.js";
import { contentsOf, CONTENTS_THRESHOLD } from "../src/renderer/Side.js";

/**
 * The reading surface (`plans/desktop-ui-uxpass.md`, group 5).
 *
 * The one warm surface in the window, and the one every finding in this group is
 * about: a title rendered twice, tables with no styling at all, a heading scale
 * that collapsed into the body size, a link that looked like prose, task lists
 * rendered as punctuation, and headings nothing could address.
 */

function source(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/renderer/${name}`, import.meta.url)), "utf8");
}

const css = source("globals.css").replace(/\/\*[\s\S]*?\*\//g, "");

const render = (body: string, slugs: string[] = []): string => renderPageBody(body, { slugs });

describe("the title, rendered once (5.1)", () => {
  it("knows when the body has a heading of its own", () => {
    expect(opensWithHeading("# Data retention\n\nbody\n")).toBe(true);
    expect(opensWithHeading("\n\n# Data retention\n")).toBe(true);
  });

  it("does not mistake a lower heading for the page's own", () => {
    // An `h2` first is a page whose title is in the frontmatter and whose body
    // starts with a section. The reader still supplies the title.
    expect(opensWithHeading("## Context\n\nbody\n")).toBe(false);
  });

  it("does not mistake a fenced `#` for a heading", () => {
    // Parsed rather than matched: a regex over the source would call this one.
    expect(opensWithHeading("```\n# not a heading\n```\n")).toBe(false);
  });

  it("is false for a body that opens with prose, or with nothing", () => {
    expect(opensWithHeading("just a sentence\n")).toBe(false);
    expect(opensWithHeading("")).toBe(false);
  });

  it("draws the reader's own title only when the body has none", () => {
    // Two `<h1>` in one `<article>` on every page in the wiki, before this.
    const reader = source("Reader.tsx");
    expect(reader).toContain(
      "{ownHeading ? null : <h1>{titleOfPage(page.frontmatter, page.slug)}</h1>}",
    );
  });
});

describe("tables (5.2)", () => {
  it("styles them by element, because the rendered HTML carries no classes", () => {
    // `.table` was styled — a class markdown-it never emits — so a rendered
    // cell computed to 1px of padding and no borders at all.
    expect(css).toMatch(/\.page tbody td\s*\{[^}]*padding:\s*var\(--space-2\) var\(--space-3\)/);
    expect(css).toMatch(/\.page thead th\s*\{[^}]*padding:\s*var\(--space-2\) var\(--space-3\)/);
  });

  it("draws a rule under every row, and a heavier one under the header", () => {
    expect(css).toMatch(
      /\.page tbody td\s*\{[^}]*border-bottom:\s*1px solid var\(--paper-border\)/,
    );
    expect(css).toMatch(
      /\.page thead th\s*\{[^}]*border-bottom:\s*1px solid var\(--paper-foreground\)/,
    );
  });

  it("scrolls a wide one inside the column instead of widening it", () => {
    expect(css).toMatch(/\.page table\s*\{[^}]*overflow-x:\s*auto/);
  });
});

describe("the heading scale (5.3)", () => {
  const sizeOf = (selector: string): string | undefined => {
    const rule = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(css);
    return /font-size:\s*var\((--[\w-]+)\)/.exec(rule?.[1] ?? "")?.[1];
  };

  it("puts a real interval between every level", () => {
    // 24 → 15 → 13 over a 13px body: the first jump is a cliff, the second is
    // not a step, and an h3 differed from a paragraph by weight alone.
    expect(sizeOf("\\.page h1")).toBe("--text-xl");
    expect(sizeOf("\\.page h2")).toBe("--text-lg");
    expect(sizeOf("\\.page h3")).toBe("--text-md");
  });

  it("leaves the smallest heading above the body it heads", () => {
    const scale = { "--text-base": 13, "--text-md": 15, "--text-lg": 18, "--text-xl": 24 };
    const h3 = sizeOf("\\.page h3") as keyof typeof scale;
    expect(scale[h3]).toBeGreaterThan(scale["--text-base"]);
  });
});

describe("a link on paper (5.4)", () => {
  it("has a colour of its own, and it is neither prose nor provenance", () => {
    // It computed to the ink of the sentence around it, so nothing said a word
    // was a link until somebody hovered it — and amber is spent on citations.
    expect(css).toMatch(/\.reader \.wikilink\s*\{[^}]*color:\s*var\(--paper-link\)/);
    const token = /--paper-link:\s*(#[0-9a-f]{6})/.exec(css)?.[1];
    const ink = /--paper-foreground:\s*(#[0-9a-f]{6})/.exec(css)?.[1];
    const accent = /--primary:\s*(#[0-9a-f]{6})/.exec(css)?.[1];
    expect(token).toBeDefined();
    expect(token).not.toBe(ink);
    expect(token).not.toBe(accent);
  });

  it("keeps the broken one a different colour again, and a different line", () => {
    expect(css).toMatch(
      /\.reader \.wikilink--broken\s*\{[^}]*color:\s*var\(--destructive-foreground\)/,
    );
    expect(css).toMatch(/\.reader \.wikilink--broken\s*\{[^}]*text-decoration:\s*underline dotted/);
  });

  it("draws an underline somebody can actually see", () => {
    // It was `rgb(236 231 222 / 28%)`, which is a hint rather than a line.
    const rule = /\.reader \.wikilink\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const alpha = /border-bottom:[^;]*\/\s*(\d+)%/.exec(rule)?.[1];
    expect(Number(alpha)).toBeGreaterThanOrEqual(40);
  });
});

describe("GFM task lists (5.5)", () => {
  it("renders a box rather than the brackets", () => {
    const html = render("- [ ] write the page\n- [x] read the source\n");
    expect(html).toContain('<input type="checkbox" disabled="">write the page');
    expect(html).toContain('<input type="checkbox" disabled="" checked="">read the source');
    expect(html).not.toContain("[ ]");
  });

  it("marks the item and the list, so the marker can come off", () => {
    const html = render("- [ ] one\n- [x] two\n");
    expect(html).toContain('<ul class="contains-task-list">');
    expect(html).toContain('class="task-list-item"');
    expect(css).toMatch(/\.page \.contains-task-list\s*\{[^}]*list-style:\s*none/);
  });

  it("marks the list once, however many of its items are tasks", () => {
    // `attrJoin` appends, so four checkboxes wrote the class four times.
    const html = render("- [ ] a\n- [ ] b\n- [ ] c\n- [x] d\n");
    expect([...html.matchAll(/contains-task-list/g)]).toHaveLength(1);
  });

  it("marks a nested list on its own, not its parent twice", () => {
    const html = render("- plain\n  - [ ] nested\n");
    expect([...html.matchAll(/contains-task-list/g)]).toHaveLength(1);
    expect(html).toMatch(/<ul>\s*<li>plain/);
  });

  it("leaves an ordinary list alone", () => {
    const html = render("- one\n- two\n");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("task-list-item");
  });

  it("does not read a bracket in the middle of a sentence as a box", () => {
    expect(render("- an array [ ] in prose\n")).not.toContain("<input");
    expect(render("a paragraph [x] with a bracket\n")).not.toContain("<input");
  });

  it("does not read one inside a fence", () => {
    expect(render("```\n- [ ] not a task\n```\n")).not.toContain("<input");
  });

  it("keeps the item's own text, including its links", () => {
    const html = render("- [ ] see [[fenix]]\n", ["fenix"]);
    expect(html).toContain("<input");
    expect(html).toContain('data-ow-page="fenix"');
  });

  it("gives the box no way to change anything, because this is a reader", () => {
    // A live checkbox would write nothing to disk — the dead-button class the
    // shell spent a whole group removing.
    expect(render("- [ ] one\n")).toContain("disabled");
  });
});

describe("heading ids (5.6)", () => {
  it("gives every heading an anchor", () => {
    const html = render("# Fenix\n\n## The cutover window\n");
    expect(html).toContain('<h1 id="fenix">');
    expect(html).toContain('<h2 id="the-cutover-window">');
  });

  it("folds diacritics rather than dropping the letters under them", () => {
    // `pt-BR` is a content language this application ships, and *Migração*
    // would otherwise anchor as `migra-o`.
    expect(headingId("Migração de dados")).toBe("migracao-de-dados");
    expect(headingId("Índice")).toBe("indice");
  });

  it("makes an id out of punctuation-heavy prose without leaving stray dashes", () => {
    expect(headingId("What `ow check` runs — and why")).toBe("what-ow-check-runs-and-why");
    expect(headingId("!!!")).toBe("");
  });

  it("does not give two headings the same anchor", () => {
    // *Consequences* under each of three decisions is the ordinary case, and
    // two elements sharing an id is one nothing can reach.
    const html = render("## Consequences\n\n## Consequences\n\n## Consequences\n");
    expect(html).toContain('id="consequences"');
    expect(html).toContain('id="consequences-1"');
    expect(html).toContain('id="consequences-2"');
  });

  it("reads back the ids the page will actually carry", () => {
    const body = "# Fenix\n\n## Context\n\n### Detail\n";
    expect(extractHeadings(body)).toEqual([
      { level: 1, id: "fenix", text: "Fenix" },
      { level: 2, id: "context", text: "Context" },
      { level: 3, id: "detail", text: "Detail" },
    ]);
    for (const heading of extractHeadings(body)) {
      expect(render(body)).toContain(`id="${heading.id}"`);
    }
  });

  it("does not read a `#` inside a fence as a heading", () => {
    expect(extractHeadings("```\n# not a heading\n```\n")).toEqual([]);
  });
});

describe("contentsOf — the table of contents (5.6)", () => {
  const page = (n: number): string =>
    Array.from({ length: n }, (_, i) => `## Section ${String(i)}\n\nbody\n`).join("\n");

  it("appears once the page is long enough to get lost in", () => {
    expect(contentsOf(page(CONTENTS_THRESHOLD))).toHaveLength(CONTENTS_THRESHOLD);
  });

  it("stays away on a page shorter than that", () => {
    // A list of two entries is longer than the scrolling it saves, and it would
    // sit above the provenance, which is what the column is actually about.
    expect(contentsOf(page(CONTENTS_THRESHOLD - 1))).toEqual([]);
    expect(contentsOf("just prose\n")).toEqual([]);
  });

  it("leaves out the page's own title, which is at the top already", () => {
    const body = `# Fenix\n\n${page(CONTENTS_THRESHOLD)}`;
    expect(contentsOf(body).every((heading) => heading.level >= 2)).toBe(true);
  });

  it("goes two levels deep and no further", () => {
    const body = `${page(CONTENTS_THRESHOLD)}\n### Deep\n\n#### Deeper\n`;
    const levels = new Set(contentsOf(body).map((heading) => heading.level));
    expect([...levels].sort()).toEqual([2, 3]);
  });

  it("points at the anchors the reader rendered", () => {
    const body = page(CONTENTS_THRESHOLD);
    const html = render(body);
    for (const heading of contentsOf(body)) {
      expect(html).toContain(`id="${heading.id}"`);
    }
  });
});
