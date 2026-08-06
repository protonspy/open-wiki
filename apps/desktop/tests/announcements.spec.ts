import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyEvent, chatAnnouncement, initialChat, sendUser } from "../src/renderer/chat-model.js";
import { htmlLang } from "../src/renderer/languages.js";
import { railMove } from "../src/renderer/keyboard.js";
import { PANES } from "../src/renderer/Rail.js";

/**
 * Nothing in the application was announced (`plans/desktop-ui-uxpass.md`,
 * group 4): zero `aria-live` regions, zero `role="status"`, zero `role="alert"`
 * across every screen driven. The things that change *without the user acting*
 * are exactly the things that need one.
 */

function source(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/renderer/${name}`, import.meta.url)), "utf8");
}

const css = source("globals.css").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the notices region (4.1)", () => {
  const reported = source("Reported.tsx");

  it("is a status, and a failure is an alert", () => {
    // Not one role for both: a rename that repointed six links can wait for a
    // pause in the speech, and a save that did not happen cannot.
    expect(reported).toContain('role={failed ? "alert" : "status"}');
    expect(reported).toContain('aria-live={failed ? "assertive" : "polite"}');
  });

  it("is in the document before there is anything to say", () => {
    // The whole of it. A region that appears at the moment of the failure is a
    // region nothing was watching, and nothing is announced.
    expect(reported).toContain("): React.JSX.Element {");
    expect(reported).not.toContain("if (!notice) return null;");
  });

  it("is out of the layout while it is empty", () => {
    expect(css).toMatch(/\.reported:empty\s*\{\s*display:\s*none/);
  });

  it("no longer asks whether the wrapper itself is empty", () => {
    // The wrapper always has children now, so `:not(:empty)` on it would be
    // permanently true and every window would carry the gap.
    expect(css).not.toContain(".main__notices:not(:empty)");
    expect(css).toContain(".main__notices:has(> *:not(:empty))");
  });
});

describe("chatAnnouncement — the agent's turn boundaries (4.2)", () => {
  const event = (kind: "done", runId = "r") => ({ kind, threadId: "t", runId }) as never;

  it("says nothing before a conversation has started", () => {
    expect(chatAnnouncement(initialChat)).toBe("");
  });

  it("says the agent is working while a run is live", () => {
    expect(chatAnnouncement(sendUser(initialChat, "write the page"))).toBe("The agent is working.");
  });

  it("says the turn is over when the run ends", () => {
    const running = applyEvent(sendUser(initialChat, "hello"), {
      kind: "token",
      threadId: "t",
      runId: "r",
      text: "hi",
    });
    expect(chatAnnouncement(applyEvent(running, event("done")))).toBe(
      "The agent has finished its turn.",
    );
  });

  it("says it is waiting, which is the one that cannot be missed", () => {
    const paused = applyEvent(sendUser(initialChat, "edit it"), {
      kind: "interrupt",
      threadId: "t",
      runId: "r",
      interruptId: "i",
      actionRequests: [{ name: "edit_file", args: {} }],
    });
    expect(chatAnnouncement(paused)).toContain("waiting for your approval");
  });

  it("carries a failure rather than falling silent on one", () => {
    const failed = applyEvent(sendUser(initialChat, "hello"), {
      kind: "error",
      threadId: "t",
      runId: "r",
      message: "the key was refused",
    });
    expect(chatAnnouncement(failed)).toBe("The agent stopped: the key was refused");
  });

  it("announces boundaries and never the stream itself", () => {
    // A region that reads every token is a region people turn off.
    const streaming = applyEvent(sendUser(initialChat, "hello"), {
      kind: "token",
      threadId: "t",
      runId: "r",
      text: "a long answer arriving one word at a time",
    });
    expect(chatAnnouncement(streaming)).toBe("The agent is working.");
  });

  it("is rendered into a region that is always there", () => {
    const chat = source("Chat.tsx");
    expect(chat).toMatch(
      /<p className="visually-hidden" role="status" aria-live="polite">\s*\{chatAnnouncement\(state\)\}/,
    );
  });
});

describe("the transcription progress, and the column nobody named (4.3)", () => {
  const sources = source("Sources.tsx");

  it("is a progressbar carrying its own numbers", () => {
    expect(sources).toContain('role="progressbar"');
    expect(sources).toContain("aria-valuemax={row.progress?.total ?? 0}");
    expect(sources).toContain("aria-valuenow={row.progress?.done ?? 0}");
  });

  it("says which source it is about, because a table has many rows", () => {
    expect(sources).toContain("aria-label={`Transcribing ${row.title}`}");
  });

  it("gives the actions column a heading for the ear", () => {
    expect(sources).toContain('{ header: "Actions", hiddenHeader: true, align: "right" }');
    expect(source("ui/Table.tsx")).toContain(
      '<span className="visually-hidden">{column.header}</span>',
    );
  });
});

describe("htmlLang (4.4)", () => {
  it("takes the project's content language", () => {
    expect(htmlLang("pt-BR")).toBe("pt-BR");
    expect(htmlLang("es")).toBe("es");
    expect(htmlLang("en")).toBe("en");
  });

  it("falls back rather than passing through whatever `ow.json` held", () => {
    // `lang` takes a BCP-47 tag and `ow.json` is a file somebody can type into.
    for (const value of [null, undefined, "", "klingon", "PT-br "]) {
      expect(htmlLang(value)).toBe("en");
    }
  });

  it("is applied to the document rather than written into the HTML", () => {
    // `index.html` cannot know: the answer arrives with `project()` and changes
    // in the settings sheet.
    expect(source("App.tsx")).toContain(
      "document.documentElement.lang = htmlLang(project?.language);",
    );
  });
});

describe("railMove — the rail as one tab stop (4.5)", () => {
  const last = PANES.length - 1;

  it("moves along the rail with either axis", () => {
    // The role's default orientation is horizontal and the rail is drawn as a
    // column, so both are answered and the markup declares which it is.
    expect(railMove({ key: "ArrowRight" }, 0, PANES.length)).toBe(1);
    expect(railMove({ key: "ArrowDown" }, 0, PANES.length)).toBe(1);
    expect(railMove({ key: "ArrowLeft" }, 2, PANES.length)).toBe(1);
    expect(railMove({ key: "ArrowUp" }, 2, PANES.length)).toBe(1);
  });

  it("wraps, because four tabs are a ring", () => {
    // Deliberately unlike the tree, which does not: two hundred pages are a
    // list you cannot feel the end of if holding Down returns you to the top.
    expect(railMove({ key: "ArrowRight" }, last, PANES.length)).toBe(0);
    expect(railMove({ key: "ArrowLeft" }, 0, PANES.length)).toBe(last);
  });

  it("reaches both ends outright", () => {
    expect(railMove({ key: "Home" }, 2, PANES.length)).toBe(0);
    expect(railMove({ key: "End" }, 0, PANES.length)).toBe(last);
  });

  it("says nothing about a key that is not a move", () => {
    for (const key of ["Enter", "a", "Escape", "Tab"]) {
      expect(railMove({ key }, 0, PANES.length)).toBeNull();
    }
  });

  it("says nothing when there is nothing to move through", () => {
    expect(railMove({ key: "ArrowDown" }, 0, 0)).toBeNull();
  });
});

describe("the rail, as it ships (4.5)", () => {
  const rail = source("Rail.tsx");

  it("has one tab stop, and it is the open pane", () => {
    // Four separate stops before this: reaching the reader from the titlebar
    // cost four presses of Tab through controls the arrows should have moved
    // between.
    expect(rail).toContain("tabIndex={i === at ? 0 : -1}");
  });

  it("moves the focus as well as the selection", () => {
    // A roving tabindex that does not follow the focus leaves the ring behind
    // on the tab you arrowed away from.
    expect(rail).toContain("data-ow-rail-index");
    expect(rail).toContain("?.focus()");
  });

  it("declares the orientation it is drawn in", () => {
    expect(rail).toContain('aria-orientation="vertical"');
  });

  it("keeps the language chip out of the tablist", () => {
    // It is not a tab, and a non-tab child of a `tablist` is a child nothing
    // can name — that did not change when it became a button. The settings tab
    // *is* one, which is why it stays inside the list and is pushed to the foot
    // from within it, so the slice ends at the list's closing tag.
    const tabs = rail.slice(rail.indexOf('className="rail__tabs"'), rail.indexOf("</div>"));
    expect(tabs).not.toContain("rail-lang");
    expect(css).toMatch(/\.rail__tabs\s*\{[^}]*flex-direction:\s*column/);
  });

  it("offers the language from the chip, not only from the settings pane", () => {
    // The chip opens a menu of the content languages and reports the choice back
    // through `onLanguageChange`, so the language can be changed without leaving
    // the pane the reader is on.
    expect(rail).toContain("onLanguageChange");
    expect(rail).toContain('aria-haspopup="menu"');
    expect(rail).toContain('role="menu"');
    expect(rail).toContain("LANGUAGES.map(");
    // The current language is marked, not just coloured.
    expect(rail).toContain('aria-checked={value === language}');
  });

  it("keeps the keyboard contract its `role=\"menu\"` claims", () => {
    // Declaring the role is a promise: arrows move between items, Escape closes,
    // and focus lands in the menu on open and back on the chip on close. Asserted
    // at the source because this suite has no DOM — the behaviour is the code.
    expect(rail).toMatch(/ArrowDown|ArrowUp/);
    expect(rail).toMatch(/Escape/);
    expect(rail).toContain("chipRef.current?.focus()");
    // Focus moves into the menu when it opens, not left on the chip.
    expect(rail).toMatch(/querySelectorAll<HTMLButtonElement>\('\[role="menuitemradio"\]'\)/);
  });
});
