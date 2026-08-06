import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { closesOverlay, isFieldTag, listMove, paneShortcut } from "../src/renderer/keyboard.js";
import { PANES } from "../src/renderer/Rail.js";

/**
 * The keyboard (plan desktop-ui 8.1).
 *
 * A dense window read beside a harness is a window somebody keeps their hands
 * off the mouse for. What is asserted is what a chord means and where an arrow
 * goes — attaching a listener is not a decision.
 */

describe("paneShortcut (8.1)", () => {
  it("reaches each pane by its position in the rail", () => {
    // The order the rail draws, so the number is what the eye already counted.
    PANES.forEach((entry, i) => {
      expect(paneShortcut({ key: String(i + 1), ctrlKey: true })).toBe(entry.pane);
    });
  });

  it("takes Cmd as well as Ctrl", () => {
    // Chat leads the rail, so Ctrl/Cmd+1 reaches it.
    expect(paneShortcut({ key: "1", metaKey: true })).toBe("chat");
  });

  it("is nothing without a modifier", () => {
    // A bare digit is a character somebody is typing.
    expect(paneShortcut({ key: "1" })).toBeNull();
  });

  it("is nothing with Alt, which Windows gives to the menu bar", () => {
    expect(paneShortcut({ key: "1", ctrlKey: true, altKey: true })).toBeNull();
  });

  it("is nothing for a number no pane sits at", () => {
    expect(paneShortcut({ key: String(PANES.length + 1), ctrlKey: true })).toBeNull();
    expect(paneShortcut({ key: "0", ctrlKey: true })).toBeNull();
    expect(paneShortcut({ key: "e", ctrlKey: true })).toBeNull();
  });

  it("reaches the settings, which the sheet could never be reached by", () => {
    // The settings are a pane now, so they take a digit like every other one.
    // As a sheet there was no chord for them at all: an overlay is not a place.
    expect(paneShortcut({ key: String(PANES.length), ctrlKey: true })).toBe("settings");
  });
});

describe("listMove (8.1)", () => {
  it("moves one at a time", () => {
    expect(listMove({ key: "ArrowDown" }, 2, 10)).toBe(3);
    expect(listMove({ key: "ArrowUp" }, 2, 10)).toBe(1);
  });

  it("jumps to the ends", () => {
    expect(listMove({ key: "Home" }, 5, 10)).toBe(0);
    expect(listMove({ key: "End" }, 5, 10)).toBe(9);
  });

  it("stops at the ends rather than wrapping", () => {
    // A list that jumps from the last page to the first when you hold Down is a
    // list you cannot feel the end of.
    expect(listMove({ key: "ArrowUp" }, 0, 10)).toBe(0);
    expect(listMove({ key: "ArrowDown" }, 9, 10)).toBe(9);
  });

  it("is nothing for a key that is not a move, or an empty list", () => {
    expect(listMove({ key: "a" }, 0, 10)).toBeNull();
    expect(listMove({ key: "ArrowDown" }, 0, 0)).toBeNull();
  });
});

describe("closesOverlay (8.1)", () => {
  it("closes the one overlay that is not a modal", () => {
    // The drawer is a `<dialog>`: the platform closes it and its own `onClose`
    // dismisses the shell. The provenance panel is deliberately not modal
    // (`desktop-shell` R2.6), so nothing was listening.
    expect(closesOverlay({ key: "Escape" }, "provenance", false)).toBe(true);
    expect(closesOverlay({ key: "Escape" }, "history", false)).toBe(false);
  });

  it("does not close a pane, which is what the settings are now", () => {
    // Leaving a pane is Back, or another pane. Escape closing one would make
    // the settings the only pane in the window you can dismiss.
    expect(closesOverlay({ key: "Escape" }, "settings", false)).toBe(false);
  });

  it("leaves Escape alone inside a field", () => {
    // Escape in a text box belongs to the box — taking it would close the panel
    // somebody was typing a citation into.
    expect(closesOverlay({ key: "Escape" }, "provenance", true)).toBe(false);
  });

  it("is nothing with no overlay open, and nothing for another key", () => {
    expect(closesOverlay({ key: "Escape" }, null, false)).toBe(false);
    expect(closesOverlay({ key: "Enter" }, "provenance", false)).toBe(false);
  });
});

describe("isFieldTag (8.1)", () => {
  it("knows where a keystroke belongs to the control", () => {
    for (const tag of ["INPUT", "textarea", "Select"]) expect(isFieldTag(tag)).toBe(true);
    for (const tag of ["BUTTON", "div", undefined]) expect(isFieldTag(tag)).toBe(false);
  });
});

describe("the tree's focus path, as it ships (8.1)", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/renderer/Tree.tsx", import.meta.url)),
    "utf8",
  );

  it("is one tab stop, not one per page", () => {
    // Two hundred pages as two hundred stops between the rail and the reader is
    // the shape that makes somebody reach for the mouse again.
    expect(source).toContain("tabIndex={at === currentIndex ? 0 : -1}");
  });

  it("moves the focus and not only the mark", () => {
    // A roving tabindex that does not follow the focus leaves the ring behind
    // on the item you left.
    expect(source).toContain("next?.focus()");
  });
});
