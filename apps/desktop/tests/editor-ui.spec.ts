import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyCompletion,
  completionAt,
  completionsFor,
  type Completion,
} from "../src/renderer/completion.js";
import { unsavedQuestion } from "../src/renderer/dialogs.js";
import { editorColumns } from "../src/renderer/layout.js";

/**
 * The editor (`plans/desktop-ui-uxpass.md`, group 2).
 *
 * No DOM in this package by design (`wiki-pane.spec.ts` says why), so the two
 * halves that can be reached are asserted: the arithmetic and the vocabulary in
 * their own modules, and the decisions that live in markup as the source and the
 * stylesheet that ship.
 */

function source(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/renderer/${name}`, import.meta.url)), "utf8");
}

const css = source("globals.css").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the two panes measure the same (2.1)", () => {
  // A page with one `ow check --json | jq …` fence: the preview's own content
  // will not go below the width of that line.
  const PANE = 1228;
  const WIDE_FENCE = 900;

  it("reproduces the imbalance `1fr` produced", () => {
    // `1fr` is `minmax(auto, 1fr)`, and `auto` is the minimum *content* size.
    const { source: box, preview } = editorColumns(PANE, WIDE_FENCE, "auto");
    expect(preview).toBeGreaterThan(box * 2);
  });

  it("puts the two within 10% of each other with `minmax(0, 1fr)`", () => {
    const { source: box, preview } = editorColumns(PANE, WIDE_FENCE, "zero");
    expect(Math.abs(box - preview) / Math.max(box, preview)).toBeLessThan(0.1);
  });

  it("holds for any preview, however wide its content", () => {
    // The old rule degraded with the width of the widest line on the page,
    // which is why one table made the source box unusable and the next page
    // was fine.
    for (const wide of [0, 400, 900, 5000]) {
      const { source: box, preview } = editorColumns(PANE, wide, "zero");
      expect(box).toBe(preview);
    }
  });

  it("declares the rule the arithmetic models", () => {
    expect(css).toMatch(
      /\.editor__panes\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/,
    );
  });

  it("gives the source box the height of the pane", () => {
    // It stopped 355px short of the bottom: `height: 100%` inside a column that
    // scrolls has no height to be a percentage of. The reader column becomes a
    // frame while the editor is open, and the box grows into it.
    expect(css).toMatch(/\.reader--editing\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.editor__panes\s*\{[^}]*flex:\s*1/);
    expect(css).toMatch(/\.editor__source\s*\{[^}]*flex:\s*1/);
  });
});

describe("what can be done to the page while it is being edited (2.2)", () => {
  const pane = source("WikiPane.tsx");

  it("disables edit, rename and delete", () => {
    // All three were confirmed live mid-edit, which put *Delete this page* one
    // click away from an unsaved draft.
    const disabled = [...pane.matchAll(/disabled=\{editing\}/g)];
    expect(disabled).toHaveLength(3);
  });

  it("takes the editing flag rather than guessing from the reader's contents", () => {
    expect(pane).toContain("editing?: boolean");
  });
});

describe("the dirty state (2.3)", () => {
  const editor = source("Editor.tsx");
  const app = source("App.tsx");

  it("fills the buffer when the session opens, and never again", () => {
    // Keyed on `editing` alone. `editing ? slug : undefined` reads as the same
    // thing and is not: a watcher reload that *fails* sets `page` to null, so
    // the key goes "fenix" → undefined → "fenix" and the effect fires a second
    // time over a buffer somebody is typing into — which is the silent loss the
    // whole staleness mechanism exists to prevent.
    const seeding = editor.slice(editor.indexOf("if (!editing) return;"));
    expect(seeding.slice(0, 200)).toContain("setMarkdown(seed.current);");
    expect(seeding.slice(0, 260)).toContain("}, [editing]);");
    expect(editor).not.toContain("const session = editing ? slug : undefined;");
  });

  it("reads the page through a ref, so a reload is not a dependency", () => {
    expect(editor).toContain("seed.current = opened;");
  });

  it("is the comparison the staleness check already made", () => {
    // `base` exists for 8.8; *changed since I opened it* is the same question
    // asked of the buffer instead of the disk, so it costs nothing to answer.
    expect(editor).toContain("dirty: editing && markdown !== base");
  });

  it("disables Save while there is nothing to write", () => {
    expect(editor).toContain("disabled={buffer.busy || !buffer.dirty}");
  });

  it("marks it in the pane bar", () => {
    expect(editor).toMatch(/buffer\.dirty \? <Pill tone="working">unsaved<\/Pill>/);
  });

  it("asks before every way out of the editor", () => {
    // Navigation, Back/Forward, and Cancel all pass through the same guard —
    // three call sites of one question rather than three chances to forget it.
    expect(app).toContain("unsaved.current && !(await confirm(unsavedQuestion()))");
    expect(app).toContain("editor.dirty && !(await confirm(unsavedQuestion()))");
    expect(app).toContain("void leaveFor(() => shell.current.back())");
    expect(app).toContain("void leaveFor(() => shell.current.forward())");
  });

  it("moves only after the question is answered", () => {
    // `Shell.visit` mutates the history: navigating first and asking afterwards
    // would leave the back stack believing in a move that never happened.
    expect(app).toContain("void leaveFor(() => shell.current.visit(next))");
    expect(app).toContain("void leaveFor(() => shell.current.goTo(pane))");
  });

  it("says what leaving costs, and draws it as the destructive answer", () => {
    const question = unsavedQuestion();
    expect(question.danger).toBe(true);
    expect(question.confirmLabel).toBe("Discard my changes");
    // Never "OK" and "Cancel": which of those keeps the work is a coin toss.
    expect(question.cancelLabel).toBe("Keep editing");
    expect(question.detail).toContain("no undo");
  });
});

describe("one screen, one action row (2.4)", () => {
  it("puts Save and Cancel in the bar the pane already draws", () => {
    expect(source("WikiPane.tsx")).toContain("{editing ? editorActions : null}");
    expect(source("App.tsx")).toContain("<EditorActions buffer={editor}");
  });

  it("leaves the editor itself with no action row of its own", () => {
    // The conflict card keeps one, and that is not the same thing: it is three
    // answers to a question the card is asking, not the screen's own controls.
    const editor = source("Editor.tsx");
    const body = editor.slice(
      editor.indexOf("export function Editor("),
      editor.indexOf("function Source("),
    );
    expect(body).not.toContain("editor__bar");
    expect(body).not.toContain("Cancel");
  });
});

describe("completionAt — what the caret is in the middle of (2.5)", () => {
  const at = (text: string): Completion | null => completionAt(text, text.length);

  it("reads a wikilink target being typed", () => {
    expect(at("see [[fen")).toMatchObject({ kind: "page", prefix: "fen", at: 6 });
  });

  it("offers everything the moment the brackets open", () => {
    // The most useful moment: somebody who knew the slug would have typed it.
    expect(at("see [[")).toMatchObject({ kind: "page", prefix: "" });
  });

  it("reads a citation's id being typed", () => {
    expect(at("decided in rec://fenix-we")).toMatchObject({
      kind: "source",
      prefix: "fenix-we",
      at: 17,
    });
    expect(at("see src://arq")).toMatchObject({ kind: "source", prefix: "arq" });
  });

  it("stops at the fragment, because the id has ended", () => {
    expect(at("rec://weekly#14:3")).toBeNull();
  });

  it("says nothing when the caret is in ordinary prose", () => {
    for (const text of ["just a sentence", "an array [0]", "a [note] in brackets", ""]) {
      expect(at(text)).toBeNull();
    }
  });

  it("does not offer a target for a link that is already closed", () => {
    expect(at("see [[fenix]] and then")).toBeNull();
  });

  it("does not offer one for a label, which is prose rather than a slug", () => {
    expect(at("see [[fenix|Mat")).toBeNull();
  });

  it("looks at the current line only", () => {
    // A `[[` somebody left open forty lines up is not what is being typed now.
    expect(completionAt("see [[\nnext line", "see [[\nnext line".length)).toBeNull();
  });

  it("takes the nearer opener when both are open", () => {
    expect(at("[[rec://we")).toMatchObject({ kind: "source", prefix: "we" });
  });

  it("reads the caret, not the end of the buffer", () => {
    const text = "see [[fen]] later";
    expect(completionAt(text, 9)).toMatchObject({ kind: "page", prefix: "fen" });
  });
});

describe("completionsFor — what matches (2.5)", () => {
  const known = {
    slugs: ["fenix", "retention", "referenced-thing", "cutover"],
    sourceIds: ["fenix-weekly-2026-07-31", "arquitetura-fenix.pdf"],
  };
  const query = (kind: "page" | "source", prefix: string): Completion => ({
    kind,
    prefix,
    at: 0,
    caret: prefix.length,
  });

  it("draws a page from the wiki's slugs and a citation from the source ids", () => {
    expect(completionsFor(query("page", "fen"), known)).toEqual(["fenix"]);
    expect(completionsFor(query("source", "fenix"), known)).toEqual([
      "fenix-weekly-2026-07-31",
      "arquitetura-fenix.pdf",
    ]);
  });

  it("puts what starts with the prefix before what merely contains it", () => {
    // Alphabetically `referenced-thing` wins, and it is not what "fen" meant.
    expect(
      completionsFor(query("page", "fen"), { ...known, slugs: ["referenced-fen", "fenix"] })[0],
    ).toBe("fenix");
  });

  it("ignores case, because a slug is lower case and a person's memory is not", () => {
    expect(completionsFor(query("page", "FEN"), known)).toEqual(["fenix"]);
  });

  it("offers the whole vocabulary for an empty prefix, capped", () => {
    const many = Array.from({ length: 30 }, (_, i) => `page-${String(i)}`);
    expect(completionsFor(query("page", ""), { ...known, slugs: many })).toHaveLength(8);
  });

  it("offers nothing rather than everything when nothing matches", () => {
    expect(completionsFor(query("page", "zzz"), known)).toEqual([]);
  });
});

describe("applyCompletion — the buffer afterwards (2.5)", () => {
  it("closes a wikilink and leaves the caret past it", () => {
    const completion = completionAt("see [[fen", 9)!;
    expect(applyCompletion("see [[fen", completion, "fenix")).toEqual({
      text: "see [[fenix]]",
      caret: 13,
    });
  });

  it("starts a citation's fragment, which is what has to be typed next", () => {
    const text = "decided in rec://fen";
    const completion = completionAt(text, text.length)!;
    expect(applyCompletion(text, completion, "fenix-weekly-2026-07-31")).toEqual({
      text: "decided in rec://fenix-weekly-2026-07-31#",
      caret: 41,
    });
  });

  it("does not double a closer that is already there", () => {
    // Fixing a link somebody got wrong is the ordinary way this happens, and
    // `[[fenix]]]]` is not a link.
    const text = "see [[fen]] later";
    const completion = completionAt(text, 9)!;
    expect(applyCompletion(text, completion, "fenix").text).toBe("see [[fenix]] later");
  });

  it("puts the caret after the closer either way", () => {
    const text = "see [[fen]] later";
    const completion = completionAt(text, 9)!;
    expect(applyCompletion(text, completion, "fenix").caret).toBe(13);
  });

  it("keeps whatever followed the caret", () => {
    const text = "see [[fen and the rest";
    const completion = completionAt(text, 9)!;
    expect(applyCompletion(text, completion, "fenix").text).toBe("see [[fenix]] and the rest");
  });
});

describe("the completion list, as it ships (2.5)", () => {
  const editor = source("Editor.tsx");

  it("keeps the focus in the box it is completing", () => {
    // A menu focus moves into is a menu somebody has to escape from. The
    // textarea owns the list through `aria-activedescendant` instead.
    expect(editor).toContain('role="combobox"');
    expect(editor).toContain("aria-activedescendant");
    expect(editor).toContain('role="listbox"');
    expect(editor).toContain('role="option"');
  });

  it("takes a choice on mouse down, before the blur that closes the list", () => {
    expect(editor).toContain("onMouseDown");
  });

  it("draws the vocabularies from what the renderer already holds", () => {
    // `index()` answers the slugs and the sources pane answers the ids: nothing
    // new crosses the bridge for this.
    expect(editor).toContain("completionsFor(completion, { slugs, sourceIds: buffer.sourceIds })");
  });
});
