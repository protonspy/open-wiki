import { describe, expect, it } from "vitest";
import {
  clearAt,
  clearFailureAt,
  failure,
  note,
  noticeAt,
  replaceAt,
  type Notice,
} from "../src/renderer/notices.js";

/**
 * What went wrong, and where (plan 1.5).
 *
 * The requirement is that a failure is reported where it happened, and these
 * assert the part of that a test can hold: that a place keeps its own notice,
 * that a failure somewhere else does not take it away, and that a success and
 * a failure do not arrive through the same channel.
 */

describe("failure", () => {
  it("takes an Error's message", () => {
    expect(failure("page", new Error("that page moved")).text).toBe("that page moved");
  });

  it("takes a sentence, for the refusals this side decides itself", () => {
    expect(failure("wiki", 'a page named "fenix" already exists').text).toBe(
      'a page named "fenix" already exists',
    );
  });

  it("survives a rejection that was not an Error at all", () => {
    expect(failure("shell", { nope: true }).text).toBe("[object Object]");
  });
});

describe("replaceAt", () => {
  it("puts a notice where it belongs", () => {
    expect(replaceAt([], failure("page", new Error("gone")))).toEqual([
      { place: "page", tone: "error", text: "gone" },
    ]);
  });

  it("replaces what that place was saying rather than stacking on it", () => {
    // A watcher failing every 120ms would otherwise pile thirty identical
    // lines onto the screen.
    const once = replaceAt([], failure("wiki", new Error("first")));
    const twice = replaceAt(once, failure("wiki", new Error("second")));
    expect(twice).toHaveLength(1);
    expect(noticeAt(twice, "wiki")?.text).toBe("second");
  });

  it("leaves every other place alone — this is the whole task", () => {
    // The failure the single error line lost: a drop refusing a file while the
    // page was already failing to load left one of the two on screen, chosen
    // by whichever finished last.
    const both = replaceAt(
      replaceAt([], failure("page", new Error("that page moved"))),
      failure("recording", new Error("no input device")),
    );
    expect(noticeAt(both, "page")?.text).toBe("that page moved");
    expect(noticeAt(both, "recording")?.text).toBe("no input device");
  });
});

describe("clearAt", () => {
  it("takes everything a place was saying", () => {
    const notices = replaceAt([], failure("page", new Error("gone")));
    expect(noticeAt(clearAt(notices, "page"), "page")).toBeUndefined();
  });

  it("says nothing about the other places", () => {
    const notices: Notice[] = replaceAt(
      replaceAt([], failure("shell", new Error("no bridge"))),
      failure("page", new Error("gone")),
    );
    expect(noticeAt(clearAt(notices, "page"), "shell")?.text).toBe("no bridge");
  });
});

describe("clearFailureAt", () => {
  it("clears the failure, because a successful read answers it", () => {
    const notices = replaceAt([], failure("page", new Error("gone")));
    expect(noticeAt(clearFailureAt(notices, "page"), "page")).toBeUndefined();
  });

  it("keeps a note, because a successful read does not answer that", () => {
    // The rename's "Repointed the links on: …" is set after the navigation it
    // caused, and the load that follows must not wipe the one record of it.
    const notices = replaceAt([], note("page", "Renamed. Repointed the links on: a, b"));
    expect(noticeAt(clearFailureAt(notices, "page"), "page")?.tone).toBe("note");
  });
});

describe("note", () => {
  it("is not an error, so it is not shown as one", () => {
    // A rename that repointed six links reported its success through the error
    // channel, in the same red box a failed rename used.
    expect(note("page", "Renamed.").tone).toBe("note");
  });
});
