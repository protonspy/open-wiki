import { describe, expect, it } from "vitest";
import { pageTemplate } from "../src/renderer/page-template.js";
import {
  ANSWERED,
  answerOf,
  buttonsFor,
  canAnswer,
  deleteQuestion,
  exportQuestion,
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

describe("buttonsFor", () => {
  /**
   * The default button is the *first submit button in tree order*, and Enter in
   * a text field submits through it — not through whatever has focus. When both
   * buttons submitted and cancel came first, typing a slug and pressing Enter
   * closed the box with cancel's empty `returnValue` and threw the answer away.
   * Every prompt this plan adds is a one-field form, and Enter is how a
   * one-field form gets filled in.
   */
  it("has exactly one submitting button, and it is the one that answers", () => {
    const submitting = buttonsFor(newPageQuestion()).filter((button) => button.submits);
    expect(submitting).toHaveLength(1);
    expect(submitting[0]?.value).toBe(ANSWERED);
  });

  it("gives the cancel button Escape's empty returnValue", () => {
    // So `answerOf` sees one exit rather than two that have to stay in step.
    const cancel = buttonsFor(newPageQuestion()).find((button) => !button.submits);
    expect(cancel?.value).toBe("");
    expect(answerOf(cancel?.value ?? "", "typed")).toBeNull();
  });

  it("marks the destructive button, and only that one", () => {
    const buttons = buttonsFor(deleteQuestion("fenix"));
    expect(buttons.filter((button) => button.danger).map((button) => button.value)).toEqual([
      ANSWERED,
    ]);
  });

  it("leaves an ordinary question with no destructive button at all", () => {
    expect(buttonsFor(newPageQuestion()).some((button) => button.danger)).toBe(false);
  });

  it("carries the question's own labels, so no button says OK", () => {
    const question = occasionQuestion();
    expect(buttonsFor(question).map((button) => button.label)).toEqual([
      question.cancelLabel,
      question.confirmLabel,
    ]);
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

/**
 * Exporting from the wiki pane's bar (`plans/settings-pane-and-export`, 2.1;
 * `specs/wiki-pane` R6.2).
 *
 * The settings sheet printed the size beside the button. A pane bar has no room
 * for a sentence, and dropping it would turn a several-hundred-megabyte write
 * into something you discover afterwards — so carrying the survey into the
 * question is the whole reason there is a question at all.
 */
describe("exportQuestion (R6.2)", () => {
  it("says how many files and how many bytes, before anything is written", () => {
    const question = exportQuestion({ files: 214, bytes: 357_000_000 });
    expect(question.detail).toContain("214 files");
    // Human units, not a raw byte count — 357000000 is not a size anybody reads.
    expect(question.detail).toMatch(/\d+(\.\d+)?\s?[KMG]B/);
  });

  it("counts one file in the singular", () => {
    expect(exportQuestion({ files: 1, bytes: 40 }).detail).toContain("1 file,");
  });

  it("still asks when the survey failed, and says that it did", () => {
    // Not knowing the size is a reason to say so, not a reason to refuse to
    // export. Refusing would make a failed count fatal to a working feature.
    const question = exportQuestion(null);
    expect(question.detail).toMatch(/could not be measured/);
    expect(question.confirmLabel).toMatch(/[Ss]ave/);
  });

  it("says what the archive leaves out, because .state/ is where a redaction hides", () => {
    expect(exportQuestion(null).detail).toContain(".state/");
  });

  it("promises only the save dialog, since that is all pressing it opens", () => {
    // The affirmative does not write anything: where it goes is the system
    // dialog's answer, and a button reading "Export" would claim otherwise.
    const question = exportQuestion({ files: 2, bytes: 10 });
    expect(question.confirmLabel).toBe("Choose where to save it");
    expect(question.danger).toBeUndefined();
  });
});

/**
 * The page type, chosen rather than assumed (plan desktop-ui 8.2).
 *
 * The type is half of the `id` (`type:slug`, 5.1), so it is what `ow graph`
 * walks by — and every page this window made was born `topic`, a person and a
 * project alike.
 */
describe("pageTemplate (8.2)", () => {
  it("writes the chosen type into both the type and the id", () => {
    const page = pageTemplate("ana", "person", "2026-08-02");
    expect(page).toContain("id: person:ana");
    expect(page).toContain("type: person");
  });

  it("still satisfies the schema the gate checks", () => {
    // The whole reason a template exists: the first save must not be a fight.
    const page = pageTemplate("fenix", "project", "2026-08-02");
    for (const field of ["id:", "type:", "title:", "status:", "aliases:", "updated:", "sources:"]) {
      expect(page).toContain(field);
    }
    expect(page.startsWith("---\n")).toBe(true);
  });

  it("falls back to a topic when nothing was chosen", () => {
    // A blank `type` is refused by 5.1 as "not a lowercase token", so an empty
    // choice must not reach the gate as one.
    expect(pageTemplate("thing", "", "2026-08-02")).toContain("type: topic");
  });

  it("takes the date it is given rather than reading a clock", () => {
    expect(pageTemplate("thing", "topic", "2026-01-09")).toContain("updated: 2026-01-09");
  });
});

describe("newPageQuestion, with a type to choose (8.2)", () => {
  it("offers the types the convention names, defaulting to topic", () => {
    const question = newPageQuestion();
    expect(question.choose?.options.map((o) => o.value)).toEqual(["topic", "project", "person"]);
    expect(question.choose?.initial).toBe("topic");
  });

  it("does not offer codewiki, which is a skill's job and not a box's", () => {
    // A codewiki page is narrated code under `wiki/codewiki/`, written by the
    // codewiki skill — offering it here would make a page in the wrong place
    // with the right frontmatter.
    expect(newPageQuestion().choose?.options.map((o) => o.value)).not.toContain("codewiki");
  });
});
