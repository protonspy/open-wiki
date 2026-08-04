import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { activatesLink } from "../src/renderer/keyboard.js";
import { PAGE_ATTR, renderPageBody, SOURCE_ATTR } from "../src/renderer/markdown.js";

/**
 * Links from the keyboard (`plans/desktop-ui-uxpass.md`, group 3).
 *
 * The finding, measured on a page carrying one wikilink and one citation:
 * `a.wikilink` 1, `a.provenance` 1, **focusable elements inside `<article>`: 0**.
 * The whole reader was a single tab stop, and every navigation target inside it
 * was unreachable without a mouse and invisible to assistive technology.
 *
 * `markdown.ts` mints no `href` deliberately — a scheme is something a page
 * author can forge, `data-ow-*` is not — and this is that decision's other half
 * rather than a reversal of it.
 */

const PAGE = "see [[fenix]] and [[ghost]], decided at rec://fenix-weekly-2026-07-31#14:32\n";

function render(body = PAGE, slugs: string[] = ["fenix"]): string {
  return renderPageBody(body, { slugs });
}

/** Every element the rendered HTML makes a tab stop. */
function focusable(html: string): number {
  return [...html.matchAll(/tabindex="0"/g)].length;
}

function source(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/renderer/${name}`, import.meta.url)), "utf8");
}

describe("what a rendered page makes reachable (3.1)", () => {
  it("has more than nothing to focus", () => {
    // The assertion the plan asks for, in the one form this DOM-less suite can
    // make it: a page with two navigation targets produces two tab stops.
    expect(focusable(render())).toBeGreaterThan(0);
  });

  it("makes a resolved wikilink a link a keyboard can reach", () => {
    const html = render("see [[fenix]]\n", ["fenix"]);
    expect(html).toMatch(/<a[^>]*class="wikilink"[^>]*tabindex="0"/);
    expect(html).toMatch(/<a[^>]*class="wikilink"[^>]*role="link"/);
  });

  it("makes a citation one too", () => {
    const html = render("see rec://weekly#14:32\n");
    expect(html).toMatch(/<a[^>]*class="provenance[^"]*"[^>]*tabindex="0"/);
    expect(html).toMatch(/<a[^>]*class="provenance[^"]*"[^>]*role="link"/);
  });

  it("names a citation by what it opens, not only by its fragment", () => {
    // The chip reads `14:32`, which announced on its own is not something
    // anybody can act on.
    expect(render("see rec://weekly#14:32\n")).toContain('aria-label="Recording weekly at 14:32"');
    expect(render("see src://a.pdf#p12\n")).toContain('aria-label="Source a.pdf at p.12"');
  });

  it("still mints no href, so the routing is still by attribute", () => {
    // The reason `data-ow-*` exists. Making these focusable must not smuggle a
    // scheme back in, because a scheme is what a page author can forge.
    const html = render();
    expect(html).not.toContain('href="page:');
    expect(html).not.toContain('href="rec:');
    expect(html).toContain(`${PAGE_ATTR}="fenix"`);
    expect(html).toContain(`${SOURCE_ATTR}="fenix-weekly-2026-07-31"`);
  });

  it("does not make a code span into a tab stop", () => {
    // The syntax written as an example is still an example.
    expect(focusable(render("`[[fenix]]` is the syntax\n", ["fenix"]))).toBe(0);
  });
});

describe("activatesLink (3.1)", () => {
  it("is Enter and Space — what the platform gives a real link and a button", () => {
    expect(activatesLink({ key: "Enter" })).toBe(true);
    expect(activatesLink({ key: " " })).toBe(true);
  });

  it("is not an ordinary keystroke", () => {
    for (const key of ["a", "Tab", "ArrowDown", "Escape", "Spacebar"]) {
      expect(activatesLink({ key })).toBe(false);
    }
  });

  it("leaves a modified chord to whatever else is listening", () => {
    expect(activatesLink({ key: "Enter", ctrlKey: true })).toBe(false);
    expect(activatesLink({ key: " ", metaKey: true })).toBe(false);
    expect(activatesLink({ key: "Enter", altKey: true })).toBe(false);
  });
});

describe("the reader, as it ships (3.1)", () => {
  const reader = source("Reader.tsx");

  it("follows a link on Enter through the handler the click already uses", () => {
    // Delegated on the same element, because the prose is
    // `dangerouslySetInnerHTML` and there is no React node per link to bind to.
    expect(reader).toContain("onKeyDown={onKeyDown}");
    expect(reader).toContain("if (!activatesLink(event)) return;");
    expect(reader).toContain("onLink(linkTarget(anchor));");
  });

  it("follows only what the renderer's own rules marked", () => {
    expect(reader).toContain("`[${PAGE_ATTR}], [${SOURCE_ATTR}]`");
  });
});

describe("a broken wikilink says it is broken (3.2)", () => {
  const html = render("see [[ghost]]\n", ["fenix"]);

  it("carries the reason in text, not in a title alone", () => {
    // A `title` is a mouse-hover affordance: a keyboard never surfaces it and
    // several screen readers never announce it.
    expect(html).toContain("(broken link: no page named ghost)");
    expect(html).toContain('class="visually-hidden"');
  });

  it("keeps the tooltip as well, for the reader who is pointing at it", () => {
    expect(html).toContain('title="no page named ghost"');
  });

  it("is not a tab stop, because there is nothing to open", () => {
    // A stop that cannot be activated is a promise the page cannot keep — and
    // it is `wikilink.broken`, which the checks pane already reports.
    expect(focusable(html)).toBe(0);
    expect(html).not.toContain(PAGE_ATTR);
  });

  it("is hidden from the eye rather than from the accessibility tree", () => {
    const css = readFileSync(
      fileURLToPath(new URL("../src/renderer/globals.css", import.meta.url)),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    // `display: none` would remove it from both, which is the mistake.
    const rule = /\.visually-hidden\s*\{([^}]*)\}/.exec(css);
    expect(rule?.[1]).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(rule?.[1]).not.toMatch(/display:\s*none/);
  });
});
