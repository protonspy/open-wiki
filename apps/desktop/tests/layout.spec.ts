import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Pane } from "../src/renderer/navigation.js";
import { PANES } from "../src/renderer/Rail.js";
import {
  contentWidth,
  furnitureFor,
  MIN_READER,
  MIN_WIDTH,
  RAIL_WIDTH,
  shellLayout,
  SIDE_BREAKPOINT,
  SIDE_WIDTH,
  TREE_BREAKPOINT,
  TREE_WIDTH,
} from "../src/renderer/layout.js";

/**
 * The window at every size it allows (`plans/desktop-ui-uxpass.md`, group 1).
 *
 * Two halves, because the decision has two homes and they can drift apart: the
 * arithmetic is `layout.ts`, the rules are `globals.css`, and a breakpoint that
 * moved in one and not the other is exactly the failure this file exists to
 * catch. There is no DOM in this suite by design — see `wiki-pane.spec.ts` —
 * so the stylesheet is read as text, which is also what ships.
 */

/** The one stylesheet, read from disk — it is what ships, not a fixture. */
function stylesheet(): string {
  return readFileSync(
    fileURLToPath(new URL("../src/renderer/globals.css", import.meta.url)),
    "utf8",
  );
}

/** The stylesheet with its prose removed, so a comment is never read as a rule. */
function rules(): string {
  return stylesheet().replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("shellLayout — the right rail below ~1000px (1.1)", () => {
  it("keeps the side column while the reader can still afford it", () => {
    expect(shellLayout(1280).side).toBe("docked");
    expect(shellLayout(1024).side).toBe("docked");
    expect(shellLayout(SIDE_BREAKPOINT).side).toBe("docked");
  });

  it("drops it to a sheet below the breakpoint", () => {
    expect(shellLayout(SIDE_BREAKPOINT - 1).side).toBe("overlay");
    expect(shellLayout(860).side).toBe("overlay");
  });

  it("leaves the reader above 380px at 860×560", () => {
    // The measurement the plan asks for. It was 255px, with the *Needs
    // attention* rail nearly twice as wide as the article it annotates.
    expect(shellLayout(860).reader).toBeGreaterThan(MIN_READER);
  });

  it("still clears 380px at the narrowest width that keeps the column", () => {
    // The breakpoint is only honest if the width just above it is habitable:
    // dropping a column at 1000 buys nothing if 1000 itself is unreadable.
    expect(shellLayout(SIDE_BREAKPOINT).reader).toBeGreaterThan(MIN_READER);
  });
});

describe("shellLayout — the tree below ~820px (1.2)", () => {
  it("keeps the tree a column above the breakpoint", () => {
    expect(shellLayout(TREE_BREAKPOINT).tree).toBe("docked");
    expect(shellLayout(860).tree).toBe("docked");
  });

  it("drops it to a sheet below it", () => {
    expect(shellLayout(TREE_BREAKPOINT - 1).tree).toBe("overlay");
    expect(shellLayout(MIN_WIDTH).tree).toBe("overlay");
  });

  it("leaves the reader above 380px at 720×480 — the application's own minimum", () => {
    // 115px before this: the title wrapped across two lines, the frontmatter
    // chips broke mid-token, and prose ran three words to a line.
    expect(shellLayout(MIN_WIDTH).reader).toBeGreaterThan(MIN_READER);
  });

  it("clears 380px at the narrowest width that keeps the tree", () => {
    expect(shellLayout(TREE_BREAKPOINT).reader).toBeGreaterThan(MIN_READER);
  });

  it("never leaves the reader under 380px at any width the window allows", () => {
    // Swept rather than sampled: a breakpoint chosen for two screenshots can
    // still have a hole between them, and the hole is what somebody drags into.
    for (let width = MIN_WIDTH; width <= 2560; width += 1) {
      expect(shellLayout(width).reader).toBeGreaterThan(MIN_READER);
    }
  });
});

describe("nothing overflows the viewport at 720×480 (1.3)", () => {
  it("leaves every pane something to render in", () => {
    for (const { pane } of PANES) {
      expect(contentWidth(pane, MIN_WIDTH)).toBeGreaterThan(MIN_READER);
    }
  });

  it("spends nothing but the rail on the panes that have no columns", () => {
    for (const pane of ["sources", "checks", "chat"] as Pane[]) {
      expect(furnitureFor(pane, MIN_WIDTH)).toBe(RAIL_WIDTH);
    }
  });

  it("declares no fixed width wider than the narrowest content column, unbounded", () => {
    // The failure this catches is the one a breakpoint cannot: a control given a
    // literal width that is simply wider than the window is allowed to be. A
    // `max-width` beside it is the legitimate case — the sheet, the drawer and
    // the question box all do exactly that — so what is asserted is that every
    // wide fixed width has one.
    const narrowest = MIN_WIDTH - RAIL_WIDTH;
    const offenders: string[] = [];
    for (const block of rules().matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = (block[1] ?? "").trim();
      const body = block[2] ?? "";
      const width = /(?:^|;)\s*width:\s*(\d+)px/.exec(body);
      if (!width) continue;
      if (Number(width[1]) <= narrowest) continue;
      if (/max-width:/.test(body)) continue;
      offenders.push(selector);
    }
    expect(offenders).toEqual([]);
  });

  it("lets the two table panes scroll sideways rather than clipping a column", () => {
    // The sources table is six columns and the window may be 720px wide.
    // `overflow-y: auto` alone hides whatever does not fit, which is a column
    // nobody can reach rather than a column somebody has to scroll to.
    expect(rules()).toMatch(/\.sources-body\s*\{[^}]*overflow:\s*auto/);
    expect(rules()).toMatch(/\.checks-body\s*\{[^}]*overflow:\s*auto/);
  });
});

describe("the stylesheet and layout.ts agree about where the breakpoints are", () => {
  const css = rules();

  it("has a breakpoint for each column that is dropped", () => {
    // `layout.ts` holds the arithmetic and `globals.css` holds the rule. Neither
    // can see the other, so this is the seam — and a number changed in one place
    // only is the whole reason it is asserted rather than trusted.
    expect(css).toContain(`@media (max-width: ${String(SIDE_BREAKPOINT - 1)}px)`);
    expect(css).toContain(`@media (max-width: ${String(TREE_BREAKPOINT - 1)}px)`);
  });

  it("declares the same column widths the arithmetic assumes", () => {
    expect(css).toMatch(
      new RegExp(
        `\\.wiki-pane\\s*\\{[^}]*grid-template-columns:\\s*${String(TREE_WIDTH)}px minmax\\(0, 1fr\\) ${String(SIDE_WIDTH)}px`,
      ),
    );
    expect(css).toMatch(
      new RegExp(`\\.app-body\\s*\\{[^}]*grid-template-columns:\\s*${String(RAIL_WIDTH)}px`),
    );
  });

  it("draws each dropped column as a sheet over the pane rather than a fourth track", () => {
    // Absolutely positioned, so it leaves the grid entirely: a collapsed panel
    // still in flow would create an implicit column and take the width back.
    expect(css).toMatch(/\.side\s*\{\s*position:\s*absolute/);
    expect(css).toMatch(/\.tree\s*\{\s*position:\s*absolute/);
    expect(css).toMatch(/\.side\[data-open="false"\]\s*\{\s*display:\s*none/);
    expect(css).toMatch(/\.tree\[data-open="false"\]\s*\{\s*display:\s*none/);
  });

  it("shows each panel's toggle only where that panel is a sheet", () => {
    // Hidden by default and revealed inside the query that collapses its panel,
    // so a control for a column that is already on screen is never offered.
    expect(css).toMatch(/\.pane-bar__panel\s*\{\s*display:\s*none/);
    expect(css).toMatch(/\.pane-bar__panel--side\s*\{\s*display:\s*inline-flex/);
    expect(css).toMatch(/\.pane-bar__panel--tree\s*\{\s*display:\s*inline-flex/);
  });

  it("anchors the sheets to the pane, not to the window", () => {
    // Without this they would be positioned against the viewport and sit over
    // the titlebar and the status bar.
    expect(css).toMatch(/\.wiki-pane\s*\{[^}]*position:\s*relative/);
  });
});
