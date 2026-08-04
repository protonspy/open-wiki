import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyEvent,
  chatReducer,
  composerDisabled,
  composerPlaceholder,
  initialChat,
  interruptShortcut,
  sendUser,
  type ChatState,
} from "../src/renderer/chat-model.js";
import { DIFF_CHAR_LIMIT, DIFF_LIMIT, sideOf, tokenize, wordDiff } from "../src/renderer/diff.js";

/**
 * The chat pane (`plans/desktop-ui-uxpass.md`, group 6).
 *
 * It is the one surface in this application where a person decides whether a
 * write lands, and it had no bar, no model, no way to start again, an assistant
 * bubble that was a fixed-width box whatever it held, two blocks of
 * near-identical prose to compare by eye, a composer that stayed live through
 * the pause, and a working state that vanished when anybody typed.
 */

function source(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/renderer/${name}`, import.meta.url)), "utf8");
}

const css = source("globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
const chat = source("Chat.tsx");

/** A state paused on a write, which is the state most of this group is about. */
function paused(): ChatState {
  return applyEvent(sendUser(initialChat, "edit the page"), {
    kind: "interrupt",
    threadId: "t",
    runId: "r",
    interruptId: "i",
    actionRequests: [{ name: "edit_file", args: {} }],
  });
}

describe("the pane bar (6.1)", () => {
  it("has a title, like every other pane", () => {
    expect(chat).toContain('<PaneBar\n        title="Chat"');
  });

  it("shows the model the agent is running", () => {
    // Chosen in Settings and never shown where it is used, though
    // `agentModels()` has been on the bridge the whole time.
    expect(chat).toContain("(await bridge().agentModels()).selectedModel");
    expect(chat).toContain('<code className="pane-bar__path">{model}</code>');
  });

  it("says where the model is set when there is none to show", () => {
    expect(chat).toContain("the agent&rsquo;s model is set in Settings");
  });

  it("starts a new conversation", () => {
    expect(chat).toContain("New conversation");
    expect(chat).toContain('dispatch({ type: "reset" });');
  });

  it("replaces the thread id with the transcript", () => {
    // A cleared window still addressing the checkpointed thread would show
    // nothing while the agent remembered everything.
    expect(chat).toContain("setThreadId(crypto.randomUUID());");
  });

  it("stops a run in flight before clearing it", () => {
    // The events of a cancelled run would otherwise arrive into the transcript
    // that replaced it.
    const startOver = chat.slice(chat.indexOf("const startOver"), chat.indexOf("if (hasKey ==="));
    expect(startOver).toContain("bridge().chatCancel({ runId })");
  });

  it("clears to the state the pane started in", () => {
    const after = chatReducer(paused(), { type: "reset" });
    expect(after).toEqual(initialChat);
  });

  it("joins the panes that frame themselves, now that it has a bar", () => {
    // Asserted by membership rather than against the whole literal: the
    // settings joined the same set when they stopped being a sheet, and a test
    // that spells the list out fails on every pane added after it, for no
    // reason of its own.
    const app = source("App.tsx");
    const from = app.indexOf("const FRAMED_PANES");
    const framed = app.slice(from, app.indexOf("]);", from));
    for (const pane of ["wiki", "sources", "checks", "chat"]) {
      expect(framed).toContain(`"${pane}"`);
    }
  });
});

describe("the assistant bubble (6.2)", () => {
  it("is the width of what it holds", () => {
    // It was a 910px bordered box at 1280 whatever the answer was, so a short
    // one read as an empty input field.
    expect(css).toMatch(/\.chat__bubble\s*\{[^}]*width:\s*fit-content/);
    expect(css).toMatch(/\.chat__turn\s*\{[^}]*justify-items:\s*start/);
  });

  it("is capped at the measure the reader is capped at", () => {
    // A long answer ran ~140 characters to the line while the reader two panes
    // over was held near 70 — the same prose set twice, one of them unreadable.
    const bubble = /\.chat__bubble\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const cap = /max-width:\s*min\(80%,\s*(\d+)ch\)/.exec(bubble)?.[1];
    const prose = /\.page p,[\s\S]*?max-width:\s*(\d+)ch/.exec(css)?.[1];
    expect(cap).toBe(prose);
  });
});

describe("tokenize (6.3)", () => {
  it("keeps the whitespace, so the text can be rebuilt exactly", () => {
    expect(tokenize("the cutover window")).toEqual(["the", " ", "cutover", " ", "window"]);
    expect(tokenize("a\nb")).toEqual(["a", "\n", "b"]);
  });

  it("has nothing to say about nothing", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("wordDiff (6.3)", () => {
  const text = (spans: ReturnType<typeof wordDiff>, side: "before" | "after"): string =>
    sideOf(spans ?? [], side)
      .map((span) => span.text)
      .join("");

  it("marks the words that changed and nothing else", () => {
    const spans = wordDiff("the cutover window", "the cutover weekend");
    expect(spans).toEqual([
      { kind: "same", text: "the cutover " },
      { kind: "removed", text: "window" },
      { kind: "added", text: "weekend" },
    ]);
  });

  it("rebuilds both sides exactly", () => {
    // The card shows the two strings the model proposed; a diff that loses a
    // character is a card that shows something else.
    const before = "The cutover runs on the 14th, after the freeze.";
    const after = "The cutover runs on the 15th, after the freeze and the review.";
    const spans = wordDiff(before, after);
    expect(text(spans, "before")).toBe(before);
    expect(text(spans, "after")).toBe(after);
  });

  it("is word-level, not character-level", () => {
    // A character diff of `window` against `weekend` marks `w`, `e`, `e` and
    // leaves the reader assembling words out of highlighted letters.
    const spans = wordDiff("window", "weekend");
    expect(spans).toEqual([
      { kind: "removed", text: "window" },
      { kind: "added", text: "weekend" },
    ]);
  });

  it("merges adjacent runs of one kind into a span somebody can see", () => {
    // A stream of one-word marks is not a diff anybody reads; several removed
    // words in a row are one struck-through phrase.
    const spans = wordDiff("the old long name", "the name");
    expect(spans).toEqual([
      { kind: "same", text: "the " },
      { kind: "removed", text: "old long " },
      { kind: "same", text: "name" },
    ]);
  });

  it("says everything is the same when it is", () => {
    expect(wordDiff("identical text", "identical text")).toEqual([
      { kind: "same", text: "identical text" },
    ]);
  });

  it("handles one side being empty", () => {
    expect(wordDiff("", "new text")).toEqual([{ kind: "added", text: "new text" }]);
    expect(wordDiff("old text", "")).toEqual([{ kind: "removed", text: "old text" }]);
  });

  it("refuses rather than freezing the window on a whole page", () => {
    // The table is quadratic in both time and memory, and `edit_file` may carry
    // a page. Past the cap the card shows both sides whole and says so.
    const huge = Array.from({ length: DIFF_LIMIT + 1 }, (_, i) => `w${String(i)}`).join(" ");
    expect(wordDiff(huge, "short")).toBeNull();
    expect(wordDiff("short", huge)).toBeNull();
  });

  it("still answers right at the cap", () => {
    const atLimit = Array.from({ length: DIFF_LIMIT }, () => "w").join("");
    expect(wordDiff(atLimit, atLimit)).not.toBeNull();
  });

  it("refuses on total length too, not only on how many tokens there are", () => {
    // The token cap bounds the table's *dimensions*; each cell compares two
    // tokens for equality, which costs a token's length rather than a constant.
    // A few hundred very long tokens stay under `DIFF_LIMIT` and still make the
    // walk arbitrarily expensive — and these strings are the agent's, on the
    // one surface whose job is to be available before a write lands.
    const long = "x".repeat(DIFF_CHAR_LIMIT + 1);
    expect(wordDiff(long, "short")).toBeNull();
    expect(wordDiff("short", long)).toBeNull();
  });

  it("refuses before it allocates anything", () => {
    // `tokenize` on a megabyte is already the work the cap exists to avoid.
    const huge = "y ".repeat(DIFF_CHAR_LIMIT);
    const started = performance.now();
    expect(wordDiff(huge, huge)).toBeNull();
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("still answers at the character cap", () => {
    const atLimit = "z".repeat(DIFF_CHAR_LIMIT);
    expect(wordDiff(atLimit, atLimit)).not.toBeNull();
  });
});

describe("sideOf (6.3)", () => {
  const spans = wordDiff("the cutover window", "the cutover weekend") ?? [];

  it("drops what the other side added", () => {
    expect(sideOf(spans, "before").map((s) => s.kind)).toEqual(["same", "removed"]);
  });

  it("drops what this side removed", () => {
    expect(sideOf(spans, "after").map((s) => s.kind)).toEqual(["same", "added"]);
  });
});

describe("the diff, as it ships (6.3)", () => {
  it("computes it once and renders it as both rows", () => {
    // Two independent renderings of one comparison can disagree.
    expect(chat).toContain('<Marked spans={sideOf(spans, "before")} side="before" />');
    expect(chat).toContain('<Marked spans={sideOf(spans, "after")} side="after" />');
  });

  it("falls back to both sides whole, and says why", () => {
    expect(chat).toContain("Too long to compare word by word");
  });

  it("marks a change by shape as well as by colour", () => {
    // The same rule the checks pane follows for severity.
    expect(css).toMatch(/\.chat__diff-removed\s*\{[^}]*text-decoration:\s*line-through/);
    expect(css).toMatch(/\.chat__diff-added\s*\{[^}]*text-decoration:\s*underline/);
  });

  it("names each change for the ear too", () => {
    expect(chat).toContain('{changed === "removed" ? "removed: " : "added: "}');
  });
});

describe("the composer while a run is paused (6.4)", () => {
  it("cannot be typed into", () => {
    // It stayed live through an interrupt, so a message could be sent into a
    // run that was waiting for a decision.
    expect(composerDisabled(paused())).toBe(true);
  });

  it("cannot be typed into while the agent is working either", () => {
    expect(composerDisabled(sendUser(initialChat, "go"))).toBe(true);
  });

  it("can be typed into the rest of the time", () => {
    expect(composerDisabled(initialChat)).toBe(false);
  });

  it("says why, in the place the box is read", () => {
    expect(composerPlaceholder(paused())).toBe("Approve or reject the write above to carry on");
    expect(composerPlaceholder(sendUser(initialChat, "go"))).toBe("The agent is working…");
    expect(composerPlaceholder(initialChat)).toBe("Message the agent");
  });

  it("is what the pane actually renders", () => {
    expect(chat).toContain("placeholder={composerPlaceholder(state)}");
    expect(chat).toContain("disabled={composerDisabled(state)}");
  });
});

describe("interruptShortcut (6.5)", () => {
  it("approves and rejects with the chords every editor already uses", () => {
    expect(interruptShortcut({ key: "Enter", ctrlKey: true })).toBe("approve");
    expect(interruptShortcut({ key: "Backspace", ctrlKey: true })).toBe("reject");
    expect(interruptShortcut({ key: "Enter", metaKey: true })).toBe("approve");
  });

  it("is never a bare key", () => {
    // The card carries an Edit textarea, and a bare letter that decides a write
    // while somebody is typing into one is the worst false positive available
    // on a human-in-the-loop surface.
    expect(interruptShortcut({ key: "Enter" })).toBeNull();
    expect(interruptShortcut({ key: "a" })).toBeNull();
    expect(interruptShortcut({ key: "Backspace" })).toBeNull();
  });

  it("leaves a further-modified chord alone", () => {
    expect(interruptShortcut({ key: "Enter", ctrlKey: true, shiftKey: true })).toBeNull();
    expect(interruptShortcut({ key: "Enter", ctrlKey: true, altKey: true })).toBeNull();
  });

  it("says nothing about any other chord", () => {
    expect(interruptShortcut({ key: "s", ctrlKey: true })).toBeNull();
  });
});

describe("the approval card, as it ships (6.5)", () => {
  it("takes the focus when it appears", () => {
    // The run has stopped and the window is waiting on a person; leaving the
    // focus in the composer it just disabled is a pause nobody can answer.
    expect(chat).toContain("useEffect(() => card.current?.focus(), []);");
    expect(chat).toContain("tabIndex={-1}");
  });

  it("binds the two decisions where the focus is", () => {
    expect(chat).toContain("const decision = interruptShortcut(event);");
  });

  it("does not decide anything while the proposal is being edited", () => {
    // The edit textarea is a descendant of the card, so a keydown in it bubbles
    // to this handler — and both chords mean something else inside a text
    // field. `Ctrl+Enter` is the submit reflex and would have approved the
    // *original* proposal, discarding the edit somebody opened the box to make;
    // `Ctrl+Backspace` is delete-previous-word and would have rejected the whole
    // write instead of deleting a word. That is the one failure this surface
    // exists to prevent, arriving through the shortcut meant to speed it up.
    const handler = chat.slice(
      chat.indexOf("const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>)"),
    );
    expect(handler.slice(0, 200)).toContain("if (editing !== null) return;");
    expect(handler.indexOf("if (editing !== null) return;")).toBeLessThan(
      handler.indexOf("interruptShortcut(event)"),
    );
  });

  it("says what the chords are, where they are used", () => {
    // A shortcut nobody is told about is a shortcut nobody uses.
    expect(chat).toContain("<kbd>Ctrl</kbd>+<kbd>Enter</kbd> approves");
  });

  it("names itself, since focus lands on it", () => {
    expect(chat).toContain("aria-label={`The agent wants to ${labelFor(proposal)}`}");
  });
});

describe("the working state (6.6)", () => {
  it("is an element in the transcript", () => {
    // It was the composer's placeholder, which disappears the moment anybody
    // types into the box.
    expect(chat).toContain('<p className="chat__working">');
    expect(css).toMatch(/\.chat__working\s*\{[^}]*color:\s*var\(--muted-foreground\)/);
  });

  it("is drawn where the answer is going to appear", () => {
    const scroll = chat.indexOf('className="chat__scroll"');
    const working = chat.indexOf('className="chat__working"');
    const composer = chat.indexOf('className="chat__composer"');
    expect(working).toBeGreaterThan(scroll);
    expect(working).toBeLessThan(composer);
  });
});
