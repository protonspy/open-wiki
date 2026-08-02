import type { Operation } from "@open-wiki/access";
import { describe, expect, it } from "vitest";
import { describeOperation, formatWhen } from "../src/renderer/History.js";

/**
 * The history drawer's lines (plan desktop-ui 6.2).
 *
 * What is asserted is what a line is allowed to claim. The drawer's whole
 * promise (8.11) is that it shows what was observed, so a line that says more
 * than the operation log holds is the one failure worth testing for.
 */

const NOW = new Date("2026-08-02T15:00:00");

function operation(over: Partial<Operation> = {}): Operation {
  return {
    id: "op-1",
    time: "2026-08-02T14:38:02",
    origin: "editor",
    pages: [{ path: "wiki/fenix.md", existed: true }],
    snapshotId: "snap-1",
    ...over,
  };
}

describe("describeOperation (6.2)", () => {
  it("says a page was created when it did not exist before", () => {
    const line = describeOperation(
      operation({ pages: [{ path: "wiki/topics/cutover.md", existed: false }] }),
      NOW,
    );
    expect(line).toMatchObject({ verb: "created", what: "cutover" });
  });

  it("says a page was changed when it did", () => {
    expect(describeOperation(operation(), NOW)).toMatchObject({ verb: "changed", what: "fenix" });
  });

  it("does not claim a delete it cannot tell from an edit", () => {
    // Both snapshot a page that existed, and the log carries no verb. Guessing
    // "deleted" would be this panel inventing history in the one place whose
    // promise is that it shows what was observed.
    const line = describeOperation(operation(), NOW);
    expect(line.verb).not.toBe("deleted");
  });

  it("names the page and counts the rest, rather than listing a rename's whole sweep", () => {
    const line = describeOperation(
      operation({
        pages: [
          { path: "wiki/fenix.md", existed: true },
          { path: "wiki/a.md", existed: true },
          { path: "wiki/b.md", existed: true },
        ],
      }),
      NOW,
    );
    expect(line.what).toBe("fenix");
    expect(line.also).toBe("also 2 other pages");
  });

  it("treats the wiki's own records as what was touched, never as the subject", () => {
    // `createPage` snapshots the page *and* `index.md`. A line reading "created
    // index" would name the bookkeeping instead of the thing that happened.
    const line = describeOperation(
      operation({
        pages: [
          { path: "wiki/fenix.md", existed: false },
          { path: "wiki/index.md", existed: true },
        ],
      }),
      NOW,
    );
    expect(line).toMatchObject({ verb: "created", what: "fenix", also: "also the wiki's records" });
  });

  it("still says something for an operation that only touched the records", () => {
    const line = describeOperation(
      operation({ pages: [{ path: "wiki/index.md", existed: true }] }),
      NOW,
    );
    expect(line.what).toBe("index.md");
  });
});

describe("formatWhen (6.2)", () => {
  it("gives the time of day for something that happened today", () => {
    expect(formatWhen("2026-08-02T14:38:02", NOW)).toBe("14:38:02");
  });

  it("puts the date in front once it is not today", () => {
    // `14:38` on an undated line is a lie by omission the moment the project is
    // a week old.
    expect(formatWhen("2026-07-28T09:05:00", NOW)).toBe("2026-07-28 09:05:00");
  });

  it("shows a time it cannot read as itself rather than as an invented date", () => {
    expect(formatWhen("not a time", NOW)).toBe("not a time");
  });
});
