import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { writesToDisk, type FixKind } from "../src/renderer/fixes.js";
import { inputClass } from "../src/renderer/ui/Input.js";
import { selectClass } from "../src/renderer/ui/Select.js";

/**
 * Design-system drift (`plans/desktop-ui-uxpass.md`, group 7).
 *
 * The system existed — `ui/Button`, `IconButton`, `Pill`, `Segmented`, `Dialog`,
 * `Sheet`, `Drawer` — and half the application routed around it: 28 raw
 * `<button>` against 28 `<Button>`, ten raw `<input>` with no input component to
 * be, and the class four of those borrowed was the markdown editor's monospace
 * textarea style.
 */

const RENDERER = new URL("../src/renderer/", import.meta.url);

function source(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, RENDERER)), "utf8");
}

const css = source("globals.css").replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Every `.tsx` under `renderer/`, with its prose removed.
 *
 * These tests look for markup, and this file's own comments name the very
 * classes and tags they are asserting the absence of. Reading a comment as code
 * is how a test like this lies.
 */
function screens(): { name: string; text: string }[] {
  const files: { name: string; text: string }[] = [];
  for (const dir of ["", "ui/"]) {
    for (const entry of readdirSync(fileURLToPath(new URL(dir, RENDERER)))) {
      if (!entry.endsWith(".tsx")) continue;
      const text = source(`${dir}${entry}`)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      files.push({ name: `${dir}${entry}`, text });
    }
  }
  return files;
}

/**
 * The opening tag of each `<tag` in a file, near enough.
 *
 * A JSX attribute may hold `=>` and `>`, so *"up to the first `>`"* is not the
 * opening tag — which is exactly how this test first passed a `<button>` whose
 * class sat behind an arrow function. A fixed window past the tag name is crude
 * and, for the question being asked, correct: what is looked for is the class
 * a control was given, and it is always in the first few attributes.
 */
function openings(text: string, tag: string): string[] {
  return [...text.matchAll(new RegExp(`<${tag}\\b`, "g"))].map((match) =>
    text.slice(match.index, match.index + 400),
  );
}

describe("ui/Input and ui/Select (7.1)", () => {
  it("each have one class, computed where a test can reach it", () => {
    expect(inputClass()).toBe("input");
    expect(inputClass("field__wide")).toBe("input field__wide");
    expect(selectClass()).toBe("select");
  });

  it("drop an absent class rather than emitting a gap", () => {
    expect(inputClass(undefined)).toBe("input");
  });

  it("have a rule to wear", () => {
    expect(css).toMatch(/\.input\s*\{[^}]*background:\s*var\(--input\)/);
    expect(css).toMatch(/\.select select\s*\{[^}]*appearance:\s*none/);
  });

  it("no longer dress a text field as the markdown editor", () => {
    // `editor__source` is the source box's monospace style, and it was on the
    // project name, the directory, the API key and the New page slug.
    for (const { name, text } of screens()) {
      if (name === "Editor.tsx") continue;
      expect({ name, has: text.includes("editor__source") }).toEqual({ name, has: false });
    }
  });

  it("is what every text field in the window now is", () => {
    // A raw `<input>` is legitimate only for the two controls the browser draws
    // and this window does not restyle.
    for (const { name, text } of screens()) {
      for (const opening of openings(text, "input")) {
        const native = /type="(?:checkbox|radio)"/.test(opening);
        expect({ name, opening, allowed: native || name === "ui/Input.tsx" }).toMatchObject({
          allowed: true,
        });
      }
    }
  });

  it("is what the one dropdown in the window is", () => {
    for (const { name, text } of screens()) {
      if (name === "ui/Select.tsx") continue;
      expect({ name, has: /<select\b/.test(text) }).toEqual({ name, has: false });
    }
  });
});

describe("the raw buttons (7.2)", () => {
  /**
   * The controls that are deliberately not `.btn`.
   *
   * Each is a shape the draft draws and a button is not: a row in a list, a tab
   * in the rail, text in the status bar, a card, a count in a table cell, a
   * seek target over a waveform. Converting them would make a `.btn` of a row.
   * They are listed so a *new* raw button is a failing test rather than one more
   * entry in a count nobody is watching.
   */
  const NOT_BUTTONS = [
    "tree-item", // a row in the page list
    "rail-btn", // a tab in the rail
    "statusbar__button", // text that acts
    "src-card", // a source, as a card
    "side-toc__item", // a heading, as a line of the page's own words
    "table__count", // a number in a cell that opens the list behind it
    "playbar__seek", // the waveform, which is its own target
    "switch", // ui/Switch — a switch, not a button
    "segmentClass", // ui/Segmented — one of a row of choices, classed by helper
    "editor__completion", // a candidate in the completion list
  ];

  it("are gone, except the ones that are a different control", () => {
    const stray: string[] = [];
    for (const { name, text } of screens()) {
      if (name === "ui/Button.tsx" || name === "ui/IconButton.tsx") continue;
      for (const opening of openings(text, "button")) {
        if (NOT_BUTTONS.some((cls) => opening.includes(cls))) continue;
        stray.push(`${name}: ${opening.slice(0, 80).replace(/\s+/g, " ")}`);
      }
    }
    expect(stray).toEqual([]);
  });

  it("left no screen hand-writing the button's own classes", () => {
    // `className="btn btn--primary"` is `<Button variant="primary">` with the
    // variant spelled where nothing can check it.
    for (const { name, text } of screens()) {
      if (name === "ui/Button.tsx") continue;
      expect({ name, has: text.includes('className="btn') }).toEqual({ name, has: false });
    }
  });
});

describe(".seg inside a grid (7.3)", () => {
  it("is the width of its own segments", () => {
    // `inline-flex` sizes a box to its content everywhere except inside a grid,
    // where `justify-self` decides and the default is `stretch`: in the New page
    // dialog the track measured 406px holding 170px of segments.
    expect(css).toMatch(/\.seg\s*\{[^}]*justify-self:\s*start/);
  });

  it("says so once, rather than at the one call site that noticed", () => {
    expect(css).not.toMatch(/\.ask__field \.seg/);
  });
});

describe("the WAV setting (7.4)", () => {
  const settings = source("Settings.tsx");

  it("has a heading, a label and a switch that agree", () => {
    // The section read *Keep the WAV after transcribing* over a control reading
    // *Delete it once transcription succeeds*: two halves of one setting stating
    // opposite polarities, with ON meaning delete under a heading saying keep.
    expect(settings).toContain("<h4>Delete the WAV after transcribing</h4>");
    expect(settings).toContain("<span>Delete the WAV once transcription succeeds</span>");
    expect(settings).toContain('label="Delete the WAV once transcription succeeds"');
  });

  it("says which way round the switch is", () => {
    expect(settings).toContain("On, the WAV is deleted");
  });

  it("draws the on state in the accent, not in the one green in the window", () => {
    // `--ok` is spent on *succeeded*. A switch being on is a choice.
    const on = /\.switch\[aria-checked="true"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(on).toContain("217 154 78");
    expect(on).not.toContain("76 195 138");
    expect(css).toMatch(
      /\.switch\[aria-checked="true"\]::after\s*\{[^}]*background:\s*var\(--primary\)/,
    );
  });
});

describe("writesToDisk (7.5)", () => {
  it("is true for every fix that changes the wiki", () => {
    for (const kind of ["add-to-index", "create-page", "replace"] as FixKind[]) {
      expect(writesToDisk(kind)).toBe(true);
    }
  });

  it("is false for the ones that only take you somewhere", () => {
    for (const kind of ["open-page", "open-source", "open-at"] as FixKind[]) {
      expect(writesToDisk(kind)).toBe(false);
    }
  });

  it("is what the pane draws the emphasis from", () => {
    // `create-page` was a ghost while `add-to-index` and `replace` were solid —
    // all three write, and two of them looked like it.
    expect(source("App.tsx")).toContain('variant={writesToDisk(fix.kind) ? "default" : "ghost"}');
  });
});

describe("the dead components (7.6)", () => {
  it("are gone", () => {
    // Zero importers each. A component nothing renders is a component nobody
    // maintains and everybody has to read past.
    for (const name of ["ui/Card.tsx", "ui/SearchInput.tsx"]) {
      expect({ name, there: existsSync(fileURLToPath(new URL(name, RENDERER))) }).toEqual({
        name,
        there: false,
      });
    }
  });

  it("took their rules with them", () => {
    // A rule for markup nothing emits is the same drift in the other direction.
    expect(css).not.toMatch(/^\.card\s*\{/m);
    expect(css).not.toMatch(/^\.search\s*\{/m);
  });

  it("left every other primitive with somewhere it is used", () => {
    const used = screens()
      .filter(({ name }) => !name.startsWith("ui/"))
      .map(({ text }) => text)
      .join("\n");
    for (const entry of readdirSync(fileURLToPath(new URL("ui/", RENDERER)))) {
      if (!entry.endsWith(".tsx")) continue;
      const name = entry.slice(0, -4);
      // The three that are only ever used by other primitives.
      if (["Dialog"].includes(name)) continue;
      expect({ name, used: used.includes(`ui/${name}.js`) }).toEqual({ name, used: true });
    }
  });
});
