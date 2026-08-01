import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSourceStates, sourceState } from "../src/sources/state.js";
import { MissingSourceError } from "../src/sources/manifest.js";

function tempProject(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ow-state-")));
  mkdirSync(join(root, "raw"), { recursive: true });
  return root;
}

/** A source directory, with only the parts a case needs. */
function source(
  root: string,
  id: string,
  parts: { kind?: "file" | "recording"; text?: string; journal?: unknown } = {},
): void {
  const dir = join(root, "raw", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ id, title: `Title of ${id}`, kind: parts.kind ?? "file", original: id }),
    "utf8",
  );
  if (parts.text !== undefined) writeFileSync(join(dir, "text.md"), parts.text, "utf8");
  if (parts.journal !== undefined) {
    writeFileSync(join(dir, "journal.json"), JSON.stringify(parts.journal), "utf8");
  }
}

describe("source state (6.1)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  describe("sourceState", () => {
    it("is received when the manifest is there and nothing else is", () => {
      source(root, "arch.pdf");
      const state = sourceState(root, "arch.pdf");
      expect(state.stage).toBe("received");
      expect(state.textReady).toBe(false);
      expect(state.title).toBe("Title of arch.pdf");
      expect(state.kind).toBe("file");
    });

    it("is text-ready once text.md exists and no page cites it", () => {
      source(root, "arch.pdf", { text: "# Arch\n" });
      const state = sourceState(root, "arch.pdf");
      expect(state.stage).toBe("text-ready");
      expect(state.textReady).toBe(true);
      expect(state.citedBy).toEqual([]);
    });

    it("is not cited while its text never landed, though it records the citation", () => {
      // A page citing a source with no text.md cites something nothing could
      // have read. Calling that the last stage of the pipeline hides it.
      source(root, "arch.pdf");
      const state = sourceState(root, "arch.pdf", ["wiki/fenix.md"]);
      expect(state.stage).toBe("received");
      expect(state.citedBy).toEqual(["wiki/fenix.md"]);
      expect(state.textReady).toBe(false);
    });

    it("is cited once a page rests on it, and says which pages", () => {
      source(root, "arch.pdf", { text: "# Arch\n" });
      const state = sourceState(root, "arch.pdf", ["wiki/fenix.md"]);
      expect(state.stage).toBe("cited");
      expect(state.citedBy).toEqual(["wiki/fenix.md"]);
    });

    it("is transcribing while a journal is part-done, with the progress", () => {
      source(root, "weekly", {
        kind: "recording",
        journal: { chunks: [{ done: true }, { done: true }, { done: false }] },
      });
      const state = sourceState(root, "weekly");
      expect(state.stage).toBe("transcribing");
      expect(state.progress).toEqual({ done: 2, total: 3 });
    });

    it("is failed, with the reason, when a chunk stopped and no text landed", () => {
      // A run abandoned partway is the case that keeps its WAV forever, so
      // surfacing it is part of the retention story, not a nicety.
      source(root, "weekly", {
        kind: "recording",
        journal: { chunks: [{ done: true }, { error: "groq: 401 unauthorized" }] },
      });
      const state = sourceState(root, "weekly");
      expect(state.stage).toBe("failed");
      expect(state.error).toContain("401");
      expect(state.progress).toEqual({ done: 1, total: 2 });
    });

    it("is not failed once the text landed anyway", () => {
      // A chunk that failed and was retried successfully leaves its error in
      // the journal; the text is the thing that says it finished.
      source(root, "weekly", {
        kind: "recording",
        text: "# Weekly\n",
        journal: { chunks: [{ done: true, error: "transient" }] },
      });
      expect(sourceState(root, "weekly").stage).toBe("text-ready");
    });

    it("falls back to the directory when the journal will not parse", () => {
      const dir = join(root, "raw", "weekly");
      source(root, "weekly", { kind: "recording", text: "# Weekly\n" });
      writeFileSync(join(dir, "journal.json"), "{ not json", "utf8");
      expect(sourceState(root, "weekly").stage).toBe("text-ready");
    });

    it("refuses an id that is not a source", () => {
      expect(() => sourceState(root, "nothing")).toThrow(MissingSourceError);
    });

    it("refuses an id that escapes raw/ but stays inside the project", () => {
      // The interesting case is a single `..`: it leaves `raw/` while staying
      // in the project, so confining against the project root would let it
      // through. `../../elsewhere` leaves the project too and proves less.
      expect(() => sourceState(root, "../wiki")).toThrow();
      expect(() => sourceState(root, "../../elsewhere")).toThrow();
    });
  });

  describe("listSourceStates", () => {
    it("lists every source, in a stable order", () => {
      source(root, "b.md", { text: "b" });
      source(root, "a.md");
      expect(listSourceStates(root).map((s) => s.id)).toEqual(["a.md", "b.md"]);
    });

    it("marks the ones a page cites, from the map it is handed", () => {
      source(root, "a.md", { text: "a" });
      source(root, "b.md", { text: "b" });

      const states = listSourceStates(root, new Map([["a.md", ["wiki/fenix.md"]]]));
      expect(states.find((s) => s.id === "a.md")?.stage).toBe("cited");
      expect(states.find((s) => s.id === "b.md")?.stage).toBe("text-ready");
    });

    it("never lists the inbox, which is a doorway and not a source", () => {
      mkdirSync(join(root, "raw", "_inbox"), { recursive: true });
      source(root, "a.md");
      expect(listSourceStates(root).map((s) => s.id)).toEqual(["a.md"]);
    });

    it("keeps listing the rest when one manifest will not parse", () => {
      // A sources screen showing nothing because of one bad directory is worse
      // than one showing the other nineteen.
      source(root, "good.md", { text: "g" });
      mkdirSync(join(root, "raw", "broken.md"), { recursive: true });
      writeFileSync(join(root, "raw", "broken.md", "manifest.json"), "{ not json", "utf8");

      expect(listSourceStates(root).map((s) => s.id)).toEqual(["good.md"]);
    });

    it("returns nothing for a project with no sources", () => {
      expect(listSourceStates(root)).toEqual([]);
    });

    it("survives a restart without reconciling anything", () => {
      // The state is the directory, so a second read of the same disk reaches
      // the same answer — there is nothing to persist and nothing to resume.
      source(root, "a.md", { text: "a" });
      expect(listSourceStates(root)).toEqual(listSourceStates(root));
    });
  });
});
