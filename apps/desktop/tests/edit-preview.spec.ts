import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { previewEdit, previewReplace } from "../src/main/agent/edit-preview.js";
import { WikiGateBackend } from "../src/main/agent/wiki-gate-backend.js";

/**
 * R5.2 — what a proposed `edit_file` will actually do, shown before the human
 * decides. The requirement is "every match site (or the full resulting page)",
 * and the failure it exists to prevent is a short `old_string` with
 * `replace_all` that looks, in the proposal, exactly like a single-site edit.
 */

/** A minimal valid entity page for `wiki/<slug>.md` the store's gate will accept. */
function pageFor(slug: string, body: string): string {
  const fm = [
    `id: t:${slug}`,
    "type: t",
    `title: ${slug}`,
    "status: active",
    "aliases: []",
    'updated: ""',
    "sources: []",
    'superseded-by: ""',
  ].join("\n");
  return `---\n${fm}\n---\n${body}`;
}

/** Everything after the frontmatter block — what the replacement is actually about. */
function bodyOf(markdown: string): string {
  const end = markdown.indexOf("\n---\n", 4);
  return end === -1 ? markdown : markdown.slice(end + "\n---\n".length);
}

describe("previewReplace — every match site (R5.2)", () => {
  it("counts every occurrence and lists each site with its line", () => {
    const content = "alpha\nx here\nbeta\nand x again\n";
    const p = previewReplace(content, "x", "y", true);
    expect(p).not.toBeNull();
    expect(p!.occurrences).toBe(2);
    expect(p!.replaced).toBe(2);
    expect(p!.sites.map((s) => s.line)).toEqual([2, 4]);
    expect(p!.sites.map((s) => s.text)).toEqual(["x here", "and x again"]);
    expect(p!.truncated).toBe(false);
  });

  it("gives the whole page as it will read once the edit lands", () => {
    const p = previewReplace("x x x\n", "x", "y", true);
    expect(p!.resulting).toBe("y y y\n");
  });

  it("replaces only the first occurrence when replace_all is off, and says so", () => {
    const p = previewReplace("x and x\n", "x", "y", false);
    // The human is told there are two matches but only one is being replaced —
    // the count and the effect are separate facts and both are shown.
    expect(p!.occurrences).toBe(2);
    expect(p!.replaced).toBe(1);
    expect(p!.sites).toHaveLength(1);
    expect(p!.resulting).toBe("y and x\n");
  });

  it("inserts the replacement literally — `$&` is text, not a substitution", () => {
    const p = previewReplace("a x b\n", "x", "$& and $1", true);
    expect(p!.resulting).toBe("a $& and $1 b\n");
  });

  it("counts overlapping matches the way the backend replaces them — not twice", () => {
    // `WikiGateBackend.edit` replaces with `split(old).join(new)`, which consumes
    // each match whole: "aa" occurs once in "aaa", not twice. A preview that
    // counted the overlap would promise two replacements and the edit would make
    // one — the human would have approved something that did not happen.
    const p = previewReplace("aaa", "aa", "b", true);
    expect(p!.occurrences).toBe(1);
    expect(p!.replaced).toBe(1);
    expect(p!.resulting).toBe("aaa".split("aa").join("b"));
    expect(p!.resulting).toBe("ba");
  });

  it("returns null when the string does not occur, or is empty", () => {
    expect(previewReplace("abc\n", "zzz", "y", true)).toBeNull();
    expect(previewReplace("abc\n", "", "y", true)).toBeNull();
  });

  it("caps the listed sites and says the list is truncated", () => {
    const p = previewReplace("x\n".repeat(300), "x", "y", true);
    expect(p!.occurrences).toBe(300);
    expect(p!.replaced).toBe(300);
    expect(p!.sites).toHaveLength(200);
    expect(p!.truncated).toBe(true);
    // Truncating the *display* must not truncate the *edit*: every match is
    // still replaced, and the resulting page shows that.
    expect(p!.resulting).toBe("y\n".repeat(300));
  });
});

describe("previewEdit — read from the page on disk (R5.2, R3.2)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ow-preview-"));
    mkdirSync(join(root, "wiki"), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("previews an edit against the page as it is now", () => {
    writeFileSync(join(root, "wiki", "a.md"), "one x\ntwo x\n");
    const p = previewEdit(root, "wiki/a.md", {
      old_string: "x",
      new_string: "z",
      replace_all: true,
    });
    expect(p!.occurrences).toBe(2);
    expect(p!.resulting).toBe("one z\ntwo z\n");
  });

  it("returns null for a path outside the project — nothing to preview, nothing read", () => {
    expect(
      previewEdit(root, "../escape.md", { old_string: "x", new_string: "y", replace_all: true }),
    ).toBeNull();
  });

  it("returns null for a page that does not exist", () => {
    expect(previewEdit(root, "wiki/missing.md", { old_string: "x", new_string: "y" })).toBeNull();
  });

  it("returns null when the args are not an edit it can render", () => {
    writeFileSync(join(root, "wiki", "a.md"), "x\n");
    expect(previewEdit(root, "wiki/a.md", { content: "whole page" })).toBeNull();
  });

  it("previews nothing outside wiki/, which is the only place an edit can land", () => {
    // The backend refuses an edit outside `wiki/`, so previewing one would read
    // and ship a file for a change that can never happen. The preview's reach is
    // the write path's reach.
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ".claude", "settings.json"), '{ "secretish": "x" }\n');
    writeFileSync(join(root, "CLAUDE.md"), "x\n");
    mkdirSync(join(root, "raw", "big"), { recursive: true });
    writeFileSync(join(root, "raw", "big", "text.md"), "x\n");

    const args = { old_string: "x", new_string: "y", replace_all: true };
    expect(previewEdit(root, ".claude/settings.json", args)).toBeNull();
    expect(previewEdit(root, "CLAUDE.md", args)).toBeNull();
    expect(previewEdit(root, "raw/big/text.md", args)).toBeNull();
    // …and the wiki page beside them still previews, so the check is a boundary,
    // not a blanket refusal.
    writeFileSync(join(root, "wiki", "a.md"), "x\n");
    expect(previewEdit(root, "wiki/a.md", args)).not.toBeNull();
  });

  it("drops the resulting page when it is too large, and keeps the sites", () => {
    // Degrade, never abandon: the sites are the disclosure R5.2 asks for, so a
    // page too big to ship whole must still say where the edit lands.
    const body = `${"filler filler filler\n".repeat(20000)}x\n`;
    writeFileSync(join(root, "wiki", "big.md"), body);
    const p = previewEdit(root, "wiki/big.md", { old_string: "x", new_string: "y" });
    expect(p).not.toBeNull();
    expect(p!.occurrences).toBe(1);
    expect(p!.sites).toHaveLength(1);
    expect(p!.resultingOmitted).toBe(true);
    expect(p!.resulting).toBeUndefined();
  });

  it("truncates a single enormous line of context rather than shipping it whole", () => {
    writeFileSync(join(root, "wiki", "min.md"), `${"a".repeat(5000)}x\n`);
    const p = previewEdit(root, "wiki/min.md", { old_string: "x", new_string: "y" });
    expect(p!.sites[0]!.text.length).toBeLessThanOrEqual(401);
    expect(p!.sites[0]!.text.endsWith("…")).toBe(true);
  });
});

/**
 * The preview and the write must agree. The human approves the preview, so any
 * divergence between what it shows and what `WikiGateBackend.edit` then does is
 * a change nobody consented to — worse than showing nothing. These run both over
 * the same page and compare, which is what keeps the two implementations from
 * drifting apart later.
 */
describe("the preview matches what the backend actually writes (R5.2)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ow-preview-match-"));
    mkdirSync(join(root, "wiki"), { recursive: true });
    mkdirSync(join(root, ".state"), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const cases: Array<{ name: string; body: string; old: string; next: string; all: boolean }> = [
    { name: "several plain matches", body: "x a x b x\n", old: "x", next: "y", all: true },
    { name: "overlapping candidates", body: "aaa aaaa\n", old: "aa", next: "b", all: true },
    { name: "first only", body: "x and x\n", old: "x", next: "y", all: false },
    {
      name: "a multi-line match",
      body: "one\ntwo\nthree\n",
      old: "one\ntwo",
      next: "1\n2",
      all: true,
    },
    {
      name: "a replacement containing the match",
      body: "cat\n",
      old: "cat",
      next: "cat cat",
      all: true,
    },
  ];

  for (const c of cases) {
    it(`agrees on ${c.name}`, () => {
      // The page is seeded through the gate's own shape, so `backend.edit`
      // actually lands — a page the gate refuses would leave every assertion
      // below comparing the preview against nothing.
      const page = join(root, "wiki", "p.md");
      const seeded = pageFor("p", c.body);
      writeFileSync(page, seeded);

      const preview = previewReplace(seeded, c.old, c.next, c.all);
      const backend = new WikiGateBackend(root);
      const result = backend.edit(page, c.old, c.next, c.all);
      expect(result.error, `the gate accepts the seeded page`).toBeUndefined();

      // Unconditional, both ways: the count the backend reports and the page it
      // actually wrote, against what the preview promised the human. Comparing
      // the preview to a re-implementation of the preview would leave a change
      // to `WikiGateBackend.edit`'s semantics green.
      expect(preview!.replaced).toBe(result.occurrences);
      // The body only — the whole file folds in the gate's frontmatter
      // completion (`updated`), which is the store's bookkeeping and not part of
      // the replacement the human approved.
      expect(bodyOf(readFileSync(page, "utf8"))).toBe(bodyOf(preview!.resulting!));
    });
  }
});

/**
 * Computing the preview and not showing it would satisfy nothing: R5.2 is about
 * what the human sees. The pane has no DOM test in this package — the renderer
 * is asserted through its pure model and against its source, the way
 * `ui.spec.ts` reads the shipped stylesheet — so this is the same check: the
 * card renders the sites and the resulting page, in classes the stylesheet has.
 */
describe("the interrupt card shows the preview (R5.2, 4.3)", () => {
  const source = (name: string): string =>
    readFileSync(join(import.meta.dirname, "..", "src", "renderer", name), "utf8");

  it("renders every match site and the resulting page", () => {
    const chat = source("Chat.tsx");
    expect(chat).toContain("preview.sites.map");
    expect(chat).toContain("preview.resulting");
    expect(chat).toContain("preview.occurrences");
    // And it says when the list of sites was capped, so a truncated list is
    // never mistaken for "these are all of them".
    expect(chat).toContain("preview.truncated");
  });

  it("uses classes the stylesheet defines", () => {
    const css = source("globals.css");
    for (const cls of ["chat__sites", "chat__site-line", "chat__site-text", "chat__sites-lead"]) {
      expect(css, `${cls} is styled`).toContain(`.${cls}`);
    }
  });

  it("keys the card by the interrupt, so a replaced proposal resets the editor", () => {
    // A second interrupt replaces the first — that is how a changed page comes
    // back as a fresh proposal (R5.5). Without a key React reuses the card
    // instance and its local `editing` survives, so `Send edited` would post the
    // new action's args carrying the superseded proposal's text: the clobber the
    // re-propose exists to prevent, reintroduced one layer up.
    const chat = source("Chat.tsx");
    expect(chat).toMatch(/<InterruptCard\s+key=\{/);
    expect(chat).toContain("state.interrupt.interruptId");
  });
});

/**
 * R7.1 is one conversation per window, and the component holds it: the reducer
 * with the transcript and the `threadId` generated once. Unmounting it discards
 * both — and the new thread id addresses a thread the main process has never
 * checkpointed, so the conversation is not recoverable either. Asserted over
 * `App.tsx`'s source for the same reason the card is: no DOM in this package.
 */
describe("the chat pane survives a pane switch (R7.1)", () => {
  const source = (name: string): string =>
    readFileSync(join(import.meta.dirname, "..", "src", "renderer", name), "utf8");

  it("renders Chat unconditionally and hides it, rather than unmounting it", () => {
    const app = source("App.tsx");
    // The other panes are mounted conditionally; this one must not be.
    expect(app).not.toMatch(/location\.pane === "chat" \? \(\s*<Chat/);
    expect(app).toMatch(/<div className="pane-chat" hidden=\{location\.pane !== "chat"\}>/);
  });

  it("hides the wrapper through a rule the stylesheet actually has", () => {
    const css = source("globals.css");
    expect(css).toContain(".pane-chat[hidden]");
    expect(css).toMatch(/\.pane-chat\[hidden\]\s*\{\s*display:\s*none;/);
  });
});
