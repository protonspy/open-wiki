import { describe, expect, it } from "vitest";
import {
  extractWikilinks,
  FRAGMENT_ATTR,
  PAGE_ATTR,
  renderPageBody,
  SOURCE_ATTR,
} from "../src/renderer/markdown.js";
import { History, isOpenableExternally, linkTarget } from "../src/renderer/navigation.js";
import { describeRecording, formatElapsed, readStatus, IDLE } from "../src/renderer/recording.js";

describe("extractWikilinks", () => {
  it("finds a plain link and a labelled one", () => {
    const links = extractWikilinks("see [[fenix]] and [[mateus|Mateus Andrade]]", ["fenix"]);
    expect(links).toEqual([
      { target: "fenix", label: "fenix", resolved: true },
      { target: "mateus", label: "Mateus Andrade", resolved: false },
    ]);
  });

  it("leaves a lone bracket in prose alone", () => {
    expect(extractWikilinks("an array [0] and a [note]", [])).toEqual([]);
  });
});

/**
 * These run the whole pipeline from a page body, because that is the
 * requirement: *a page renders with its wikilinks and citations clickable*.
 * Feeding a hand-written HTML fragment to one helper asserts that helper's
 * internal contract and misses everything markdown-it does in between — which
 * is where the substitutions used to break.
 */
describe("renderPageBody (8.5)", () => {
  const render = (body: string, slugs: string[] = []): string => renderPageBody(body, { slugs });

  it("renders markdown", () => {
    expect(render("# Title\n\nbody\n")).toContain("<h1>Title</h1>");
  });

  it("makes a resolved wikilink something the application can follow", () => {
    const html = render("see [[fenix]]\n", ["fenix"]);
    expect(html).toContain(`${PAGE_ATTR}="fenix"`);
    expect(html).toContain(">fenix<");
  });

  it("routes by attribute, not by an href scheme a page could mint", () => {
    // markdown-it renders `[x](page:evil)` happily, so a scheme proves nothing.
    const forged = render("[x](page:evil)\n", ["evil"]);
    expect(forged).not.toContain(PAGE_ATTR);
    expect(render("see [[fenix]]\n", ["fenix"])).not.toContain('href="page:');
  });

  it("shows a broken wikilink as broken where the reader would have clicked", () => {
    const html = render("see [[ghost]]\n", ["fenix"]);
    expect(html).toContain("wikilink--broken");
    expect(html).not.toContain(PAGE_ATTR);
  });

  it("shows a labelled wikilink's label, unescaped twice over", () => {
    // Escaping text markdown-it has already escaped renders `&amp;` on screen.
    expect(render("[[fenix|Tom & Jerry]]\n", ["fenix"])).toContain("Tom &amp; Jerry");
    expect(render("[[fenix|Tom & Jerry]]\n", ["fenix"])).not.toContain("&amp;amp;");
  });

  it("makes a citation openable", () => {
    const html = render("see src://arquitetura-fenix.pdf#p12\n");
    expect(html).toContain(`${SOURCE_ATTR}="arquitetura-fenix.pdf"`);
    expect(html).toContain(`${FRAGMENT_ATTR}="p12"`);
  });

  it("makes a recording citation openable at its instant", () => {
    const html = render("see rec://fenix-weekly-2026-07-31#14:32\n");
    expect(html).toContain(`${SOURCE_ATTR}="fenix-weekly-2026-07-31"`);
    expect(html).toContain(`${FRAGMENT_ATTR}="14:32"`);
  });

  it("stops a citation at the punctuation around it", () => {
    expect(render("see rec://weekly#14:32, then stop\n")).toContain(", then stop");
  });

  it("does not render a wikilink inside a code span", () => {
    // Pages in this repository quote the syntax exactly this way, and every
    // one of them used to become a live link.
    const html = render("`[[fenix]]` is the syntax\n", ["fenix"]);
    expect(html).toContain("<code>[[fenix]]</code>");
    expect(html).not.toContain(PAGE_ATTR);
  });

  it("does not render a citation inside a fenced block", () => {
    const html = render("```\nrec://weekly#14:32\n```\n");
    expect(html).not.toContain(SOURCE_ATTR);
  });

  it("does not let a citation inside a link title break out of the attribute", () => {
    // The failure that made this a token rule: a replacement over serialised
    // HTML puts its own quote inside `title="…"` and the rest becomes
    // attribute names on somebody else's tag.
    const html = render('[t](http://example.test/ "src://a.pdf#p12")\n');
    expect(html).toContain('title="src://a.pdf#p12"');
    expect(html).not.toContain('class="provenance');
  });

  it("does not let a wikilink inside an image alt become an attribute", () => {
    // An `alt` is attribute position. A substitution over serialised HTML put
    // its own quote in there and turned the rest into attribute names on the
    // `<img>`; a token rule cannot, because markdown-it writes the attribute.
    const html = render("![[[fenix]]](x.png)\n", ["fenix"]);
    expect(html).toMatch(/^<p><img src="x\.png" alt="[^"]*"><\/p>\n$/);
    expect(html).not.toContain(PAGE_ATTR);
  });

  it("does not let a page carry raw HTML", () => {
    // The wiki is markdown an agent writes, and a page carrying a script would
    // run it inside a renderer that has the project open. Everything below
    // survives as *text* — what matters is that no tag is produced.
    for (const body of [
      "<script>alert(1)</script>",
      "<ScRiPt>alert(1)</ScRiPt>",
      "<img src=x onerror=alert(1)>",
      "<div onload=alert(1)>hi</div>",
      "<a href=x onmouseover=alert(1)>hi</a>",
    ]) {
      const html = render(`${body}\n`);
      // The only tags in the output are the ones markdown-it emitted for the
      // paragraph itself.
      const tags = [...html.matchAll(/<\/?([a-z]+)/gi)].map((m) => m[1]!.toLowerCase());
      expect(tags).toEqual(["p", "p"]);
      expect(html).toContain("&lt;");
    }
  });

  it("does not let a label become markup", () => {
    const html = render("[[fenix|<img src=x onerror=alert(1)>]]\n", ["fenix"]);
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain("&lt;img");
  });

  it("does not let a target become an attribute", () => {
    const html = render('[[a" onmouseover="alert(1)]]\n', ['a" onmouseover="alert(1)']);
    expect(html).not.toContain('onmouseover="alert');
  });

  it("makes no link at all from a javascript: URL written as ordinary markdown", () => {
    // markdown-it's own `validateLink` refuses the scheme, so the syntax stays
    // literal text rather than becoming an anchor.
    const html = render("[click](javascript:alert(1))\n");
    expect(html).not.toContain("<a");
  });

  it("makes no link from a data: or vbscript: URL either", () => {
    for (const href of ["data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)"]) {
      expect(render(`[click](${href})\n`)).not.toContain("<a");
    }
  });
});

describe("History (8.5)", () => {
  it("remembers where the reader came from", () => {
    const history = new History();
    history.visit({ view: "wiki", slug: "a" });
    history.visit({ view: "wiki", slug: "b" });
    expect(history.back()).toEqual({ view: "wiki", slug: "a" });
    expect(history.canGoForward).toBe(true);
  });

  it("goes forward again", () => {
    const history = new History();
    history.visit({ view: "wiki", slug: "a" });
    history.visit({ view: "wiki", slug: "b" });
    history.back();
    expect(history.forward()).toEqual({ view: "wiki", slug: "b" });
  });

  it("discards the forward history when a new link is followed", () => {
    // Exactly as a browser does, or Back stops meaning "where I came from".
    const history = new History();
    history.visit({ view: "wiki", slug: "a" });
    history.visit({ view: "wiki", slug: "b" });
    history.back();
    history.visit({ view: "wiki", slug: "c" });
    expect(history.canGoForward).toBe(false);
    expect(history.back()).toEqual({ view: "wiki", slug: "a" });
  });

  it("does not record visiting the place you are already at", () => {
    const history = new History();
    history.visit({ view: "wiki", slug: "a" });
    history.visit({ view: "wiki", slug: "a" });
    expect(history.canGoBack).toBe(false);
  });

  it("cannot go back past the beginning or forward past the end", () => {
    const history = new History();
    expect(history.back()).toBeNull();
    history.visit({ view: "wiki" });
    expect(history.back()).toEqual({ view: "wiki" });
    expect(history.forward()).toEqual({ view: "wiki" });
  });

  it("keeps the trail behind the cursor", () => {
    const history = new History();
    history.visit({ view: "wiki", slug: "a" });
    history.visit({ view: "wiki", slug: "b" });
    history.back();
    expect(history.trail).toEqual([{ view: "wiki", slug: "a" }]);
  });
});

describe("linkTarget (8.5)", () => {
  /** Just enough of an element for the router, without a DOM. */
  const element = (attrs: Record<string, string>) => ({
    getAttribute: (name: string): string | null => attrs[name] ?? null,
  });

  it("reads the two attributes the renderer's rules emit", () => {
    expect(linkTarget(element({ [PAGE_ATTR]: "fenix" }))).toEqual({
      kind: "page",
      slug: "fenix",
    });
    expect(linkTarget(element({ [SOURCE_ATTR]: "weekly", [FRAGMENT_ATTR]: "14:32" }))).toEqual({
      kind: "source",
      id: "weekly",
      fragment: "14:32",
    });
  });

  it("treats a forged href scheme as somebody else's URL", () => {
    // The whole reason for routing on an attribute: a page author can write
    // `[x](page:evil)` and markdown-it renders it.
    expect(linkTarget(element({ href: "page:evil" }))).toEqual({
      kind: "external",
      href: "page:evil",
    });
    expect(linkTarget(element({ href: "source:evil#p1" })).kind).toBe("external");
  });

  it("treats an ordinary URL as external", () => {
    expect(linkTarget(element({ href: "https://example.test" }))).toEqual({
      kind: "external",
      href: "https://example.test",
    });
  });
});

describe("isOpenableExternally (8.2)", () => {
  it("allows what a browser handles", () => {
    for (const href of ["https://example.test/x", "http://example.test", "mailto:a@b.test"]) {
      expect(isOpenableExternally(href)).toBe(true);
    }
  });

  it("refuses a protocol handler that is a documented path to code execution", () => {
    // `shell.openExternal` is `ShellExecute` on Windows: it invokes whichever
    // handler is registered, and markdown-it's own filter blocks only
    // `javascript:`, `vbscript:`, `file:` and most `data:`.
    for (const href of [
      "ms-msdt:/id PCWDiagnostic",
      "ms-officecmd:%7B%22id%22:3%7D",
      "search-ms:query=x&crumb=location:\\\\evil\\share",
      "file:///C:/Windows/System32/calc.exe",
      "javascript:alert(1)",
      "not a url at all",
      "",
    ]) {
      expect(isOpenableExternally(href)).toBe(false);
    }
  });
});

describe("the recording indicator (8.1, 8.2)", () => {
  it("shows nothing when nothing is being recorded", () => {
    expect(describeRecording(IDLE).visible).toBe(false);
  });

  it("shows the elapsed length while recording", () => {
    const text = describeRecording({ state: "recording", recordedMs: 247_000 });
    expect(text.visible).toBe(true);
    expect(text.label).toBe("Recording");
    expect(text.elapsed).toBe("04:07");
  });

  it("looks different while paused", () => {
    const text = describeRecording({ state: "paused", recordedMs: 1000 });
    expect(text.label).toBe("Paused");
    expect(text.className).toContain("recording--paused");
  });

  it("grows an hours field when it needs one", () => {
    expect(formatElapsed(3600_000 + 247_000)).toBe("1:04:07");
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(-1)).toBe("00:00");
  });

  it("reads the sidecar's status", () => {
    expect(readStatus({ state: "recording", recorded_ms: 5000 })).toEqual({
      state: "recording",
      recordedMs: 5000,
    });
  });

  it("reads anything it does not recognise as idle", () => {
    // An indicator that says "recording" because a field arrived misspelled is
    // worse than one that says nothing.
    for (const payload of [null, "recording", {}, { state: "capturing" }, { state: 1 }]) {
      expect(readStatus(payload).state).toBe("idle");
    }
  });
});
