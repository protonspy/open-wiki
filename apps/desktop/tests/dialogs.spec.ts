import { describe, expect, it } from "vitest";
import {
  ANSWERED,
  answerOf,
  canAnswer,
  deleteQuestion,
  newPageQuestion,
  occasionOf,
  occasionQuestion,
  renameQuestion,
  retitleQuestion,
} from "../src/renderer/dialogs.js";

/**
 * The questions the shell asks, and what an answer means (plan 1.1).
 *
 * These assert the requirement rather than the box: that a control which used
 * to do nothing now asks something answerable, that the sentence a dialog
 * shows is the one the operation actually performs, and that the one call site
 * where not answering still acts (4.16) is the only one.
 */

describe("answerOf", () => {
  it("takes the typed answer when a button answered", () => {
    expect(answerOf(ANSWERED, "the-thing")).toBe("the-thing");
  });

  it("trims it, because a page named ' ' is not a page", () => {
    expect(answerOf(ANSWERED, "  the-thing  ")).toBe("the-thing");
  });

  it("reads Escape's empty returnValue as unanswered", () => {
    // The platform leaves `returnValue` empty when Escape closes a dialog, and
    // the cancel button carries the same empty value on purpose: one exit.
    expect(answerOf("", "half typed")).toBeNull();
  });

  it("reads any other returnValue as unanswered rather than guessing", () => {
    expect(answerOf("something-else", "typed")).toBeNull();
  });
});

describe("occasionOf (4.16)", () => {
  it("still records when the box was not answered", () => {
    // The fallback the plan asks for: an unanswered box is an unnamed
    // recording, which `recordingId` names by the timestamp. Refusing to
    // record would be the one wrong answer here.
    expect(occasionOf(null)).toBe("");
  });

  it("passes the occasion through when there was one", () => {
    expect(occasionOf("weekly sync")).toBe("weekly sync");
  });
});

describe("canAnswer", () => {
  it("refuses an empty slug, because a page needs a name", () => {
    expect(canAnswer(newPageQuestion(), "")).toBe(false);
    expect(canAnswer(newPageQuestion(), "   ")).toBe(false);
    expect(canAnswer(newPageQuestion(), "the-thing")).toBe(true);
  });

  it("accepts an empty occasion, because capture is worth more than a name", () => {
    expect(canAnswer(occasionQuestion(), "")).toBe(true);
  });

  it("is always answerable when there is no box to fill", () => {
    expect(canAnswer(deleteQuestion("fenix"), "")).toBe(true);
  });
});

describe("the questions", () => {
  it("asks for a new page's slug with nothing in the box", () => {
    const question = newPageQuestion();
    expect(question.kind).toBe("prompt");
    expect(question.initial).toBeUndefined();
  });

  it("starts a rename from the name the page has now", () => {
    expect(renameQuestion("fenix").initial).toBe("fenix");
  });

  it("says a rename repoints the links, because it does", () => {
    expect(renameQuestion("fenix").detail).toMatch(/repointed/);
  });

  it("warns that a delete leaves the links pointing at nothing (7.1)", () => {
    const question = deleteQuestion("fenix");
    expect(question.detail).toMatch(/[Ll]inks pointing at it stay/);
    expect(question.danger).toBe(true);
  });

  it("names the page in both the title and the button that deletes it", () => {
    const question = deleteQuestion("fenix");
    expect(question.title).toContain("fenix");
    expect(question.confirmLabel).toMatch(/[Dd]elete/);
    // The other button says what it does too, rather than "Cancel".
    expect(question.cancelLabel).not.toMatch(/[Dd]elete/);
  });

  it("says a retitle leaves the id and the citations alone (6.7, adr:0011)", () => {
    const question = retitleQuestion("Weekly sync");
    expect(question.initial).toBe("Weekly sync");
    expect(question.detail).toMatch(/id stays frozen/);
    expect(question.detail).toMatch(/citation/);
  });

  it("says on the button that not naming a recording still records it", () => {
    // The one dialog whose cancel is not a refusal. The label has to say so,
    // or the button lies about what pressing it does.
    expect(occasionQuestion().cancelLabel).toMatch(/[Rr]ecord/);
    expect(occasionQuestion().emptyMeans).toBe("accept");
  });
});
