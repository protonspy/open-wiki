import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buttonClass } from "../src/renderer/ui/Button.js";
import { cellClass } from "../src/renderer/ui/Table.js";
import { iconButtonClass } from "../src/renderer/ui/IconButton.js";
import { pillClass } from "../src/renderer/ui/Pill.js";
import { segmentClass } from "../src/renderer/ui/Segmented.js";

/**
 * The primitives every later group is assembled from (plan 2.3, 2.4).
 *
 * What is asserted is the part that is a decision — which class carries which
 * state — and the one guarantee a component rewrite loses silently, which is
 * that focus is still visible.
 */

/** The one stylesheet, read from disk — it is what ships, not a fixture. */
function stylesheet(): string {
  return readFileSync(
    fileURLToPath(new URL("../src/renderer/globals.css", import.meta.url)),
    "utf8",
  );
}

describe("buttonClass", () => {
  it("gives an ordinary button no variant class at all", () => {
    // The default is the default: a class named `btn--default` would be a
    // second way to say the same thing, and the two drift.
    expect(buttonClass()).toBe("btn");
  });

  it("names the variant", () => {
    expect(buttonClass("primary")).toBe("btn btn--primary");
    expect(buttonClass("ghost")).toBe("btn btn--ghost");
    expect(buttonClass("danger")).toBe("btn btn--danger");
  });

  it("names the small size, and says nothing about the ordinary one", () => {
    expect(buttonClass("default", "sm")).toBe("btn btn--sm");
    expect(buttonClass("default", "md")).toBe("btn");
  });

  it("combines a variant and a size", () => {
    expect(buttonClass("ghost", "sm")).toBe("btn btn--ghost btn--sm");
  });

  it("keeps the caller's own class last, so it can win", () => {
    expect(buttonClass("primary", "md", "chrome__wide")).toBe("btn btn--primary chrome__wide");
  });

  it("drops an absent class rather than emitting a gap", () => {
    // The failure of every hand-rolled version: `undefined` reaching the DOM
    // as the string "undefined", or a leading space in `class`.
    expect(buttonClass("default", "md", undefined)).toBe("btn");
  });
});

describe("iconButtonClass", () => {
  it("is its own class, not a button with the label removed", () => {
    // Square, so a row of them is a row. A `.btn` with no text is a 10px-padded
    // rectangle around a 13px glyph, which is not the same shape.
    expect(iconButtonClass()).toBe("icon-btn");
  });

  it("has one size, because the draft draws one", () => {
    // No `icon-btn--sm`. It was invented here, and a size the draft does not
    // draw is a decision nobody made that every later group would inherit.
    expect(iconButtonClass("chrome__wide")).toBe("icon-btn chrome__wide");
  });
});

describe("pillClass", () => {
  it("gives the neutral tone no modifier", () => {
    expect(pillClass()).toBe("pill");
    expect(pillClass("neutral")).toBe("pill");
  });

  it("names each state the draft draws", () => {
    expect(pillClass("ok")).toBe("pill pill--ok");
    expect(pillClass("error")).toBe("pill pill--error");
    expect(pillClass("cited")).toBe("pill pill--cited");
    expect(pillClass("working")).toBe("pill pill--working");
    expect(pillClass("uncited")).toBe("pill pill--uncited");
  });
});

describe("cellClass", () => {
  it("sets numbers in tabular figures, so a column can be read down", () => {
    expect(cellClass({ header: "Cited", align: "right" })).toBe("table__num");
  });

  it("leaves a text column alone", () => {
    expect(cellClass({ header: "Source" })).toBe("");
  });
});

/**
 * 2.1 — the palette migrated, rather than half-migrated.
 *
 * The failure this guards is the one CSS is silent about: `var(--ink-2)`
 * survives a rename, resolves to nothing, and the property falls back to
 * whatever it inherits. Nothing errors, nothing logs, and the rule quietly
 * stops applying — which over a rewrite this size is exactly how a palette
 * becomes two palettes.
 */
describe("every token a rule asks for exists", () => {
  // Comments, not rules: this file names the old palette on purpose, to say
  // what it replaced. Reading prose as CSS is how a test like this lies.
  const rules = stylesheet().replace(/\/\*[\s\S]*?\*\//g, "");

  it("defines every custom property the file references", () => {
    const defined = new Set([...rules.matchAll(/^\s{2}(--[\w-]+):/gm)].map((m) => m[1]));
    const used = new Set([...rules.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });

  it("has no rule left referring to the palette 8.1 invented", () => {
    // `var(…)` only. A BEM modifier is spelled the same way a custom property
    // is, and `.btn--danger` is a class this file keeps on purpose.
    const stale = [...rules.matchAll(/var\((--[\w-]+)\)/g)]
      .map((m) => m[1] ?? "")
      .filter((name) => /^--(surface|ink|line|accent|danger|warn|recording)\b/.test(name));
    expect(stale).toEqual([]);
  });
});

/**
 * 2.4 — focus is visible on every primitive.
 *
 * Asserted against the stylesheet rather than against a rendered component,
 * because that is where it is decided and where it gets lost: one
 * `outline: none` in a component's rule, with nothing put in its place, and a
 * keyboard has no way through that control. Nothing looks wrong from the
 * inside, which is why this is worth a test rather than a habit.
 */
describe("the focus ring", () => {
  const css = stylesheet().replace(/\/\*[\s\S]*?\*\//g, "");

  it("is drawn for every focusable thing, from one rule", () => {
    const rule = css.match(/:focus-visible\s*\{([^}]*)\}/);
    expect(rule?.[1]).toMatch(/outline:\s*2px solid var\(--ring\)/);
  });

  it("is never removed anywhere", () => {
    // `.search input` used to be the one legitimate case — the ring moved to
    // the control's own edge rather than deleted — and `ui/SearchInput` had
    // zero importers, so uxpass 7.6 took the component and its rules together.
    // With nothing left to except, the invariant is the stronger one: any
    // `outline: none` in this file is the bug this test exists for.
    const removals = [...css.matchAll(/([^{}]*)\{[^}]*outline:\s*(?:none|0)[;\s]/g)].map((m) =>
      m[1]?.trim(),
    );
    expect(removals).toEqual([]);
  });

  it("never turns the ring off for reduced motion", () => {
    // The reduced-motion block neutralises animation and transition. It has
    // been known to be written with `all: unset`-style breadth, which takes
    // the outline with it.
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/);
    expect(reduced?.[1]).not.toMatch(/outline/);
  });
});

describe("segmentClass (desktop-ui 6.1)", () => {
  it("names the chosen one, and says nothing about the others", () => {
    expect(segmentClass(true)).toBe("seg__option seg__option--on");
    expect(segmentClass(false)).toBe("seg__option");
  });

  it("keeps the caller's own class last, so it can win", () => {
    expect(segmentClass(false, "seg__option--wide")).toBe("seg__option seg__option--wide");
  });

  it("carries weight as well as colour when chosen", () => {
    // The same guarantee the rail and the pills make: a state that is only a
    // colour is a state somebody cannot read.
    expect(stylesheet()).toMatch(/\.seg__option--on\s*\{[^}]*font-weight:/);
  });
});
