import { describe, expect, it } from "vitest";
import {
  extractWikilinks,
  renderPageBody,
  renderProvenance,
  renderWikilinks,
} from "../src/renderer/markdown.js";
import { History, parseLink } from "../src/renderer/navigation.js";
import { describeRecording, formatElapsed, readStatus, IDLE } from "../src/renderer/recording.js";

describe("wikilinks (8.5)", () => {
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

  it("makes a resolved link something the application can follow", () => {
    // Never a real navigation: a renderer that follows an href leaves the app.
    const html = renderWikilinks("<p>see [[fenix]]</p>", ["fenix"]);
    expect(html).toContain('href="page:fenix"');
    expect(html).toContain(">fenix<");
  });

  it("shows a broken link as broken where the reader would have clicked", () => {
    // A link to nowhere that looks like a link is worse than obviously missing
    // text — and it is the same thing 7.1 reports.
    const html = renderWikilinks("<p>see [[ghost]]</p>", ["fenix"]);
    expect(html).toContain("wikilink--broken");
    expect(html).not.toContain("href=");
  });

  it("escapes a label rather than letting it become markup", () => {
    const html = renderWikilinks("[[fenix|<img src=x onerror=alert(1)>]]", ["fenix"]);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("encodes a target that would otherwise break the href", () => {
    const html = renderWikilinks('[[a"b]]', ['a"b']);
    expect(html).toContain('href="page:a%22b"');
  });
});

describe("provenance links (8.5, for 8.6)", () => {
  it("turns a file citation into something openable", () => {
    const html = renderProvenance("<p>src://arquitetura-fenix.pdf#p12</p>");
    expect(html).toContain('href="source:arquitetura-fenix.pdf#p12"');
  });

  it("turns a recording citation into something openable", () => {
    const html = renderProvenance("<p>rec://fenix-weekly-2026-07-31#14:32</p>");
    expect(html).toContain("source:fenix-weekly-2026-07-31#14%3A32");
  });

  it("stops at the punctuation around it", () => {
    const html = renderProvenance("<p>see rec://weekly#14:32, then stop</p>");
    expect(html).toContain(", then stop");
  });

  it("leaves ordinary prose alone", () => {
    expect(renderProvenance("<p>nothing here</p>")).toBe("<p>nothing here</p>");
  });
});

describe("renderPageBody (8.5)", () => {
  it("renders markdown", () => {
    expect(renderPageBody("# Title\n\nbody\n", { slugs: [] })).toContain("<h1>Title</h1>");
  });

  it("does not let a page carry raw HTML", () => {
    // The wiki is markdown an agent writes, and a page carrying a script would
    // run it inside a renderer that has the project open.
    const html = renderPageBody("<script>alert(1)</script>\n", { slugs: [] });
    expect(html).not.toContain("<script>");
  });

  it("resolves wikilinks against the index it was given", () => {
    const html = renderPageBody("see [[fenix]] and [[ghost]]\n", { slugs: ["fenix"] });
    expect(html).toContain('href="page:fenix"');
    expect(html).toContain("wikilink--broken");
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

describe("parseLink (8.5)", () => {
  it("reads the two schemes the renderer mints", () => {
    expect(parseLink("page:fenix")).toEqual({ kind: "page", slug: "fenix" });
    expect(parseLink("source:weekly#14%3A32")).toEqual({
      kind: "source",
      id: "weekly",
      fragment: "14:32",
    });
  });

  it("reads a source citation with no fragment", () => {
    expect(parseLink("source:weekly")).toEqual({ kind: "source", id: "weekly", fragment: "" });
  });

  it("treats anything else as somebody else's URL", () => {
    // Which the application must not follow in-window.
    expect(parseLink("https://example.test")).toEqual({
      kind: "external",
      href: "https://example.test",
    });
    expect(parseLink("javascript:alert(1)").kind).toBe("external");
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
