import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buttonClass } from "../src/renderer/ui/Button.js";
import { cellClass } from "../src/renderer/ui/Table.js";
import { iconButtonClass } from "../src/renderer/ui/IconButton.js";
import { pillClass } from "../src/renderer/ui/Pill.js";

/**
 * The primitives every later group is assembled from (plan 2.3, 2.4).
 *
 * What is asserted is the part that is a decision — which class carries which
 * state — and the one guarantee a component rewrite loses silently, which is
 * that focus is still visible.
 */

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
    expect(iconButtonClass("sm")).toBe("icon-btn icon-btn--sm");
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
 * 2.4 — focus is visible on every primitive.
 *
 * Asserted against the stylesheet rather than against a rendered component,
 * because that is where it is decided and where it gets lost: one
 * `outline: none` in a component's rule, with nothing put in its place, and a
 * keyboard has no way through that control. Nothing looks wrong from the
 * inside, which is why this is worth a test rather than a habit.
 */
describe("the focus ring", () => {
  const css = readFileSync(
    fileURLToPath(new URL("../src/renderer/globals.css", import.meta.url)),
    "utf8",
  );

  it("is drawn for every focusable thing, from one rule", () => {
    const rule = css.match(/:focus-visible\s*\{([^}]*)\}/);
    expect(rule?.[1]).toMatch(/outline:\s*2px solid var\(--ring\)/);
  });

  it("is removed in exactly one place, and put back on the box around it", () => {
    // `.search input` is the one legitimate case: the ring is moved to the
    // control's own edge, where the eye reads it, rather than deleted. Any
    // other `outline: none` in this file is the bug this test exists for.
    const removals = [...css.matchAll(/([^{}]*)\{[^}]*outline:\s*(?:none|0)[;\s]/g)].map((m) =>
      m[1]?.trim(),
    );
    expect(removals).toEqual([".search input"]);
    expect(css).toMatch(/\.search:focus-within\s*\{[^}]*outline:\s*2px solid var\(--ring\)/);
  });

  it("never turns the ring off for reduced motion", () => {
    // The reduced-motion block neutralises animation and transition. It has
    // been known to be written with `all: unset`-style breadth, which takes
    // the outline with it.
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/);
    expect(reduced?.[1]).not.toMatch(/outline/);
  });
});
