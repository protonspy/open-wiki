import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHANNELS, createApi, dispatch } from "../src/main/ipc.js";
import { PUSH_CHANNELS } from "../src/main/channels.js";
import { asDropOutcome, inboxFailure, ingestDrop, ingestFile } from "../src/main/ingest.js";
import {
  browseSource,
  findings,
  revealPath,
  MAX_BROWSE_ENTRIES,
  MAX_BROWSE_VISIT,
  MAX_BROWSE_DEPTH,
  MAX_INLINE_IMAGE_BYTES,
  locateCitation,
  sourceDetail,
  sourceRows,
  sourcesOfPage,
} from "../src/main/sources.js";
import { markSourceProcessed } from "../src/main/edit.js";
import { chunkCells, toneOfStage } from "../src/renderer/Sources.js";
import { startFragment } from "../src/shared/sources.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ow-src-"));
  for (const part of ["raw", "wiki", ".state"]) mkdirSync(join(root, part), { recursive: true });
  writeFileSync(join(root, "wiki", "index.md"), "# Index\n\n", "utf8");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function source(
  id: string,
  over: {
    kind?: "file" | "recording";
    text?: boolean;
    original?: string;
    title?: string;
  } = {},
): void {
  const dir = join(root, "raw", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      id,
      title: over.title ?? id,
      kind: over.kind ?? "file",
      original: over.original ?? "",
    }),
    "utf8",
  );
  if (over.text !== false) writeFileSync(join(dir, "text.md"), "# text\n", "utf8");
}

function page(slug: string, body: string, sources: string[] = []): void {
  const front = {
    id: `topic:${slug}`,
    type: "topic",
    title: slug,
    status: "active",
    aliases: [],
    updated: "2026-07-01",
    sources,
    "superseded-by": "",
  };
  const yaml = Object.entries(front)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  writeFileSync(join(root, "wiki", `${slug}.md`), `---\n${yaml}\n---\n\n${body}`, "utf8");
}

describe("sourceRows (6.2, 6.4, 6.6)", () => {
  it("lists every source with its state", () => {
    source("a.pdf");
    source("b.pdf");
    expect(sourceRows(root).map((r) => r.id)).toEqual(["a.pdf", "b.pdf"]);
  });

  it("says which pages cite each source", () => {
    source("a.pdf");
    page("fenix", "see src://a.pdf#p1\n");
    const row = sourceRows(root).find((r) => r.id === "a.pdf");
    expect(row?.citedBy).toEqual(["fenix"]);
  });

  it("flags a source nobody cites", () => {
    // The case that disappears from view on its own: a source nobody used
    // looks exactly like one somebody used, unless the screen says otherwise.
    source("a.pdf");
    source("b.pdf");
    page("fenix", "see src://a.pdf#p1\n");
    const rows = sourceRows(root);
    expect(rows.find((r) => r.id === "a.pdf")?.uncited).toBe(false);
    expect(rows.find((r) => r.id === "b.pdf")?.uncited).toBe(true);
  });

  it("carries the stage, so a stalled recording is visible", () => {
    source("weekly", { kind: "recording", text: false });
    writeFileSync(
      join(root, "raw", "weekly", "journal.json"),
      JSON.stringify({
        chunks: [
          { index: 0, done: true },
          { index: 1, error: "429" },
        ],
      }),
      "utf8",
    );
    const row = sourceRows(root).find((r) => r.id === "weekly");
    expect(row?.stage).toBe("failed");
    expect(row?.progress).toEqual({ done: 1, total: 2 });
  });

  it("is empty for a project with no sources", () => {
    expect(sourceRows(root)).toEqual([]);
  });
});

describe("sourceDetail (6.2)", () => {
  it("answers for one source", () => {
    source("a.pdf");
    page("fenix", "see src://a.pdf#p1\n");
    expect(sourceDetail(root, "a.pdf")).toMatchObject({ id: "a.pdf", citedBy: ["fenix"] });
  });
});

describe("sourcesOfPage (6.5)", () => {
  it("is the inverse of 6.4", () => {
    source("a.pdf");
    source("weekly", { kind: "recording" });
    page("fenix", "see src://a.pdf#p1 and rec://weekly#14:32\n");
    expect(sourcesOfPage(root, "fenix").map((s) => s.id)).toEqual(["a.pdf", "weekly"]);
  });

  it("reads the field as well as the prose", () => {
    // 5.5 mirrors the body into the field, but a page written before that ran
    // has its citations only in one of the two.
    source("a.pdf");
    page("fenix", "no citations in the body\n", ["src://a.pdf#p1"]);
    expect(sourcesOfPage(root, "fenix").map((s) => s.id)).toEqual(["a.pdf"]);
  });

  it("carries the title, so a page says what it came from and not only its id", () => {
    source("a.pdf", { title: "Fenix architecture, v3" });
    page("fenix", "see src://a.pdf#p1\n");
    expect(sourcesOfPage(root, "fenix")[0]).toMatchObject({
      id: "a.pdf",
      title: "Fenix architecture, v3",
      kind: "file",
    });
  });

  it("opens each kind at its own start — a first page, a first instant", () => {
    // **Asserted through `locateCitation`, not against the constant.** The
    // fragment is only worth anything if it resolves, and asserting `"0:00"`
    // would faithfully encode the wrong string if the string were wrong: any
    // fragment `parseInstant` rejects sends a recording down the *document*
    // branch, where it resolves to "has no file to open".
    source("a.pdf", { original: "a.pdf" });
    writeFileSync(join(root, "raw", "a.pdf", "source.pdf"), "%PDF");
    source("weekly", { kind: "recording" });
    writeFileSync(join(root, "raw", "weekly", "mic.opus"), "");
    page("fenix", "see src://a.pdf#p1 and rec://weekly#14:32\n");

    const [document, recording] = sourcesOfPage(root, "fenix");
    expect(locateCitation(root, document!.id, document!.fragment)).toMatchObject({
      kind: "document",
      page: 1,
    });
    expect(locateCitation(root, recording!.id, recording!.fragment)).toMatchObject({
      kind: "audio",
      seconds: 0,
    });
  });

  it("reports a citation whose source is gone, rather than dropping it", () => {
    // Hiding it would leave the reader believing the page is sourced, which is
    // the one wrong answer available here — and 7.3 reports the same citation
    // as a finding.
    page("fenix", "see src://vanished.pdf#p1\n");
    const [missing] = sourcesOfPage(root, "fenix");
    expect(missing).toMatchObject({ id: "vanished.pdf", kind: null });
    expect(missing?.reason).toContain("there is no source");
  });

  it("tells a source that cannot be read from one that is not there", () => {
    // They have different fixes, so they cannot share a message. Saying "there
    // is no source named x" about a directory the reader can see sends them
    // looking for the wrong problem.
    mkdirSync(join(root, "raw", "broken.pdf"), { recursive: true });
    writeFileSync(join(root, "raw", "broken.pdf", "manifest.json"), '{"title":{}}', "utf8");
    page("fenix", "see src://broken.pdf#p1\n");
    const [unreadable] = sourcesOfPage(root, "fenix");
    expect(unreadable).toMatchObject({ id: "broken.pdf", kind: null });
    expect(unreadable?.reason).toContain("could not be read");
    expect(unreadable?.reason).not.toContain("there is no source");
  });

  it("is empty for a page that cites nothing, and for a page that is not there", () => {
    page("fenix", "nothing\n");
    expect(sourcesOfPage(root, "fenix")).toEqual([]);
    expect(sourcesOfPage(root, "ghost")).toEqual([]);
  });
});

describe("findings (7.6)", () => {
  it("reports what the checks report", () => {
    // Rendering, not new checking: the findings already carry a `fix`.
    page("fenix", "see [[ghost]]\n");
    const all = findings(root);
    expect(all.some((f) => f.code.startsWith("wikilink"))).toBe(true);
    expect(all.every((f) => typeof f.fix === "string")).toBe(true);
  });

  it("is empty for a project with nothing wrong", () => {
    expect(findings(root).filter((f) => f.severity === "error")).toEqual([]);
  });
});

describe("locateCitation (8.6)", () => {
  it("opens a source that has been filed into a folder (8.3)", () => {
    // A citation into a filed source passed `ow check` — which resolves through
    // the walk — and then opened as "there is no source named …" the moment
    // anybody clicked it. A source that is there, reported absent: the same
    // confidently-wrong answer `adr:0016` had to fix once for pages.
    mkdirSync(join(root, "raw", "2026", "q3", "arch.pdf"), { recursive: true });
    writeFileSync(
      join(root, "raw", "2026", "q3", "arch.pdf", "manifest.json"),
      JSON.stringify({ id: "arch.pdf", title: "Arch", kind: "file", original: "arch.pdf" }),
      "utf8",
    );
    writeFileSync(join(root, "raw", "2026", "q3", "arch.pdf", "source.pdf"), "%PDF");

    expect(locateCitation(root, "arch.pdf", "p12")).toMatchObject({ kind: "document", page: 12 });
  });

  it("opens a document at its page", () => {
    source("a.pdf", { original: "a.pdf" });
    writeFileSync(join(root, "raw", "a.pdf", "source.pdf"), "%PDF");
    const at = locateCitation(root, "a.pdf", "p12");
    expect(at).toMatchObject({ kind: "document", page: 12 });
  });

  it("opens a recording at its instant, in seconds", () => {
    source("weekly", { kind: "recording" });
    writeFileSync(join(root, "raw", "weekly", "mic.opus"), "");
    const at = locateCitation(root, "weekly", "14:32");
    expect(at).toMatchObject({ kind: "audio", seconds: 14 * 60 + 32 });
  });

  it("refuses an instant past the end of the recording", () => {
    // The same rule 5.4 applies when it refuses the citation in the first
    // place. Opening at zero would be the application saying it found it.
    source("weekly", { kind: "recording" });
    writeFileSync(join(root, "raw", "weekly", "mic.opus"), "");
    writeFileSync(
      join(root, "raw", "weekly", "timemap.json"),
      JSON.stringify({
        version: 1,
        compressedDurationNs: 60 * 1_000_000_000,
        segments: [{ compressedStartNs: 0, durationNs: 60e9, recordedStartNs: 0, wallStartMs: 1 }],
        chunks: [],
      }),
      "utf8",
    );
    expect(locateCitation(root, "weekly", "14:32")).toMatchObject({ kind: "missing" });
  });

  it("says so when the source is not there", () => {
    expect(locateCitation(root, "ghost", "p1")).toMatchObject({ kind: "missing" });
  });

  it("refuses an id that climbs out of raw/", () => {
    expect(locateCitation(root, "../../etc", "p1")).toMatchObject({ kind: "missing" });
  });

  it("says so when a recording has no audio to open", () => {
    source("weekly", { kind: "recording" });
    expect(locateCitation(root, "weekly", "14:32")).toMatchObject({ kind: "missing" });
  });

  it("does not open a file the manifest merely names", () => {
    // The manifest is a file in a project directory that arrives with a clone.
    source("a.pdf", { original: "../../../../Windows/System32/calc.exe" });
    expect(locateCitation(root, "a.pdf", "p1")).toMatchObject({ kind: "missing" });
  });
});

describe("dropping files onto the window (3.5)", () => {
  let from: string;

  beforeEach(() => {
    from = mkdtempSync(join(tmpdir(), "ow-drop-"));
  });

  afterEach(() => rmSync(from, { recursive: true, force: true }));

  function file(name: string, content = "# notes\n"): string {
    const path = join(from, name);
    writeFileSync(path, content, "utf8");
    return path;
  }

  it("ingests a markdown file through the same path 3.1 registers everything with", async () => {
    const outcome = await ingestFile(root, file("Notes.md"));
    expect(outcome).toMatchObject({ ok: true, id: "notes.md" });
  });

  it("stores a format nothing here reads, rather than refusing it", async () => {
    // `adr:0021-sources-are-stored-not-parsed`: there is nothing left to
    // recognise. A deck is bytes, and the agent opens it.
    const outcome = await ingestFile(root, file("deck.pptx"));
    expect(outcome).toMatchObject({ ok: true, id: "deck.pptx" });
  });

  it("reports a name already taken as itself", async () => {
    // `adr:0011` chose this refusal deliberately — the user renames the file
    // rather than the application inventing `notes (2).md`.
    await ingestFile(root, file("Notes.md"));
    const second = await ingestFile(root, file("notes.md"));
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.reason).toMatch(/already here|rename/i);
  });

  it("reports every file in a drop, good and bad", async () => {
    // A partial success reported as success is how a source silently never
    // arrives.
    mkdirSync(join(root, "raw", "taken.md"), { recursive: true });
    const outcomes = await ingestDrop(root, [file("one.md"), file("taken.md"), file("two.txt")]);
    expect(outcomes.map((o) => o.ok)).toEqual([true, false, true]);
    expect(outcomes.map((o) => o.name)).toEqual(["one.md", "taken.md", "two.txt"]);
  });

  it("does not let one failure stop the rest", async () => {
    const outcomes = await ingestDrop(root, [join(from, "gone.md"), file("here.md")]);
    expect(outcomes[0]!.ok).toBe(false);
    expect(outcomes[1]!.ok).toBe(true);
  });
});

describe("the inbox doorway, as the window reports it (3.7)", () => {
  it("says an arrival the way a drop says it", () => {
    expect(
      asDropOutcome({ ok: true, name: "notes.md", stored: "text", id: "notes.md", removed: true }),
    ).toEqual({
      name: "notes.md",
      ok: true,
      id: "notes.md",
    });
  });

  it("carries the refusal's own reason, not a generic one", () => {
    // The reason is the whole value of reporting a refusal: "could not ingest"
    // tells the person nothing they can act on, and a file refused in silence
    // is material an agent believes it handed over.
    expect(
      asDropOutcome({
        ok: false,
        name: "big.pdf",
        reason: "over the size limit for a source",
        removed: false,
      }),
    ).toEqual({ name: "big.pdf", ok: false, reason: "over the size limit for a source" });
  });

  it("reports a doorway that stopped working, because a quiet watcher looks like an empty inbox", () => {
    const outcome = inboxFailure(new Error("EPERM: operation not permitted"));
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toContain("EPERM");
  });

  it("lists what is waiting without taking it", async () => {
    // What is already in the doorway when a window opens is listed and left
    // alone: `raw/` arrives with a clone, so ingesting on sight would parse a
    // stranger's bytes and delete the file out of the user's tree with nobody
    // having clicked anything.
    mkdirSync(join(root, "raw", "_inbox"), { recursive: true });
    writeFileSync(join(root, "raw", "_inbox", "notes.md"), "# notes\n", "utf8");
    const api = createApi({ projectRoot: root });

    expect(api.inboxWaiting()).toEqual(["notes.md"]);
    // Still there, and still not a source.
    expect(existsSync(join(root, "raw", "_inbox", "notes.md"))).toBe(true);
    expect(sourceRows(root)).toEqual([]);
  });

  it("takes it when asked, and then it is gone from the doorway", async () => {
    mkdirSync(join(root, "raw", "_inbox"), { recursive: true });
    writeFileSync(join(root, "raw", "_inbox", "notes.md"), "# notes\n", "utf8");
    const api = createApi({ projectRoot: root });

    const outcomes = await api.inboxDrain();
    expect(outcomes).toEqual([{ name: "notes.md", ok: true, id: "notes.md" }]);
    expect(api.inboxWaiting()).toEqual([]);
    expect(sourceRows(root).map((r) => r.id)).toEqual(["notes.md"]);
  });
});

describe("the widened IPC surface (6.x, 7.6, 8.6 to 8.11)", () => {
  it("routes every channel it declares", async () => {
    source("a.pdf");
    page("fenix", "see src://a.pdf#p1\n");
    const api = createApi({ projectRoot: root });

    // Every read channel answers. A channel in `CHANNELS` that `dispatch` does
    // not handle would throw "unknown channel" here rather than in production.
    await expect(dispatch(api, CHANNELS.sources, [])).resolves.toBeInstanceOf(Array);
    await expect(dispatch(api, CHANNELS.sourceDetail, ["a.pdf"])).resolves.toMatchObject({
      id: "a.pdf",
    });
    await expect(dispatch(api, CHANNELS.sourcesOfPage, ["fenix"])).resolves.toMatchObject([
      { id: "a.pdf" },
    ]);
    await expect(dispatch(api, CHANNELS.findings, [])).resolves.toBeInstanceOf(Array);
    await expect(dispatch(api, CHANNELS.locate, ["a.pdf", "p1"])).resolves.toMatchObject({
      kind: "missing",
    });
    await expect(dispatch(api, CHANNELS.history, [])).resolves.toBeInstanceOf(Array);
  });

  it("names exactly the channels the main process pushes on", () => {
    // The loop below skips `PUSH_CHANNELS`, which is the same set `index.ts`
    // uses to decide what gets no `ipcMain.handle`. Trusting it in both places
    // means a channel wrongly added to it is skipped twice over: no handler
    // registered, no dispatch case exercised, test green, and the renderer's
    // `invoke` hanging against a channel nobody answers. This pins it.
    expect([...PUSH_CHANNELS].sort()).toEqual(
      [CHANNELS.changed, CHANNELS.inbox, CHANNELS.chatEvent].sort(),
    );
  });

  it("handles every channel it declares, with no gaps", async () => {
    const api = createApi({ projectRoot: root });
    for (const channel of Object.values(CHANNELS)) {
      if (PUSH_CHANNELS.has(channel)) continue; // main → renderer only
      // `createProject` actually scaffolds. Calling every channel with
      // arbitrary arguments once left a real project directory behind in the
      // repository — a test with side effects is a test that edits the thing
      // it is checking.
      if (channel === CHANNELS.createProject) continue;
      // Most will fail for want of a page or a recorder, which is fine. What
      // none may say is "unknown channel" — that is a name in the list the
      // switch forgot, and it would only ever be found in production.
      const failure = await dispatch(api, channel, ["x", "y"]).then(
        () => null,
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
      );
      expect(failure ?? "").not.toContain("unknown channel");
    }
  });

  it("takes only strings from a drop, whatever the renderer sent", async () => {
    const api = createApi({ projectRoot: root });
    await expect(dispatch(api, CHANNELS.drop, [[1, null, { path: "x" }]])).resolves.toEqual([]);
  });

  it("refuses a channel that is not on the list", async () => {
    const api = createApi({ projectRoot: root });
    await expect(dispatch(api, "wiki:rm-rf", [])).rejects.toThrow(/unknown channel/);
  });
});

/**
 * The sources pane as a table (plan desktop-ui 5.1).
 *
 * The two decisions the rows carry: which pill a stage wears, and what the
 * progress bar is allowed to claim.
 */
describe("toneOfStage (5.1)", () => {
  it("gives being cited its own tone, and a source that just arrived none", () => {
    // `received` is not a problem — a source that landed a minute ago has not
    // failed at anything, and a coloured pill would say it had.
    expect(toneOfStage("cited")).toBe("cited");
    expect(toneOfStage("received")).toBe("neutral");
  });

  it("tells the three working states apart", () => {
    expect(toneOfStage("text-ready")).toBe("ok");
    expect(toneOfStage("transcribing")).toBe("working");
    expect(toneOfStage("failed")).toBe("error");
  });
});

describe("chunkCells (5.1, plan 6.3)", () => {
  it("draws one cell per chunk, filled up to what is done", () => {
    expect(chunkCells({ done: 2, total: 5 }, false)).toEqual([
      "done",
      "done",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("pulses the next cell only while a run is actually in flight", () => {
    // A stopped transcription four chunks in is not a transcription doing
    // anything, and an animation saying otherwise is the difference between
    // "come back later" and "press the button".
    expect(chunkCells({ done: 1, total: 3 }, true)).toEqual(["done", "doing", "pending"]);
    expect(chunkCells({ done: 1, total: 3 }, false)).toEqual(["done", "pending", "pending"]);
  });

  it("never marks a cell as the one that failed", () => {
    // The row carries a count, not a map. Which chunk failed is in the journal
    // and not in `SourceRow` — painting a cell red would invent it, and 4.9
    // records an error and carries on, so the failed one is not simply the
    // next one after the done ones.
    expect(chunkCells({ done: 3, total: 7 }, false)).not.toContain("failed");
  });

  it("has nothing to draw for a source with no transcription in it", () => {
    expect(chunkCells(undefined, false)).toEqual([]);
    expect(chunkCells({ done: 0, total: 0 }, true)).toEqual([]);
  });

  it("survives a count that outruns the total rather than drawing a longer bar", () => {
    expect(chunkCells({ done: 9, total: 3 }, false)).toEqual(["done", "done", "done"]);
  });
});

describe("startFragment (5.1, plan 6.5)", () => {
  it("opens a recording at its first passage and a document at its first page", () => {
    // The anchors 4.13 and `pdf.ts` actually write. A fragment of the wrong
    // shape resolves to nothing while reading perfectly reasonably.
    expect(startFragment("recording")).toBe("0:00");
    expect(startFragment("file")).toBe("p1");
  });

  it("falls back to a page for a source nobody could describe", () => {
    expect(startFragment(null)).toBe("p1");
  });
});

describe("the provenance viewer opens what it is given (7.4)", () => {
  /** A source holding a preserved original of this name. */
  function withOriginal(id: string, bytes = "x"): void {
    source(id, { text: false });
    const dot = id.lastIndexOf(".");
    writeFileSync(join(root, "raw", id, dot > 0 ? `source${id.slice(dot)}` : "source"), bytes);
  }

  it("opens an image as an image, with a type the CSP will load", () => {
    // The renderer's CSP is `default-src 'none'` with `img-src 'self' data:`,
    // so this is a real constraint: these bytes can reach an `<img>` and a
    // PDF's cannot.
    withOriginal("diagram.png");
    const at = locateCitation(root, "diagram.png", "p1");
    expect(at.kind).toBe("image");
    expect(at.kind === "image" && at.mime).toBe("image/png");
  });

  it("opens a PDF at the page the citation named", () => {
    withOriginal("report.pdf");
    const at = locateCitation(root, "report.pdf", "p12");
    expect(at.kind).toBe("document");
    expect(at.kind === "document" && at.page).toBe(12);
  });

  it("hands an SVG to the system rather than to an img element", () => {
    // It is a document that can carry script, and it arrived from a source
    // nobody parsed. The CSP would load it; that is the problem, not the
    // permission.
    withOriginal("chart.svg");
    expect(locateCitation(root, "chart.svg", "p1").kind).toBe("external");
  });

  it("names anything else and offers it to the system handler", () => {
    // `adr:0021` means a source can be any file at all, so this branch is what
    // keeps "any file" from quietly meaning "any file we listed".
    for (const name of ["model.step", "book.epub", "sheet.xlsx", "notes"]) {
      withOriginal(name);
      expect(locateCitation(root, name, "p1").kind, name).toBe("external");
    }
  });

  it("opens an unpacked archive as its tree, not as the zip beside it", () => {
    withOriginal("repo.zip");
    mkdirSync(join(root, "raw", "repo.zip", "contents", "src"), { recursive: true });
    writeFileSync(join(root, "raw", "repo.zip", "contents", "src", "main.rs"), "fn main() {}\n");
    const at = locateCitation(root, "repo.zip", "p1");
    expect(at.kind).toBe("tree");
    expect(at.kind === "tree" && at.incomplete).toBe(false);
  });

  it("says when the tree it opens is only part of one", () => {
    withOriginal("repo.zip");
    mkdirSync(join(root, "raw", "repo.zip", "contents"), { recursive: true });
    writeFileSync(join(root, "raw", "repo.zip", "unpacking.json"), "{}");
    const at = locateCitation(root, "repo.zip", "p1");
    expect(at.kind === "tree" && at.incomplete).toBe(true);
  });
});

describe("browsing into a source (7.5)", () => {
  it("lists the files a source holds", () => {
    source("notes.md");
    const browse = browseSource(root, "notes.md");
    expect(browse.tree).toBe(false);
    expect(browse.entries.map((e) => e.path).sort()).toEqual(["manifest.json", "text.md"]);
    expect(browse.entries.find((e) => e.path === "text.md")?.bytes).toBeGreaterThan(0);
  });

  it("lists an unpacked archive as a tree, and not the two files beside it", () => {
    // `source.zip` and `contents/` is a listing nobody came to see.
    source("repo.zip", { text: false });
    mkdirSync(join(root, "raw", "repo.zip", "contents", "src"), { recursive: true });
    writeFileSync(join(root, "raw", "repo.zip", "contents", "README.md"), "# acme\n");
    writeFileSync(join(root, "raw", "repo.zip", "contents", "src", "main.rs"), "fn main() {}\n");

    const browse = browseSource(root, "repo.zip");
    expect(browse.tree).toBe(true);
    expect(browse.entries.map((e) => e.path)).toEqual(["README.md", "src", "src/main.rs"]);
    expect(browse.entries.find((e) => e.path === "src")?.kind).toBe("dir");
  });

  it("says when the tree is only part of an archive", () => {
    source("repo.zip", { text: false });
    mkdirSync(join(root, "raw", "repo.zip", "contents"), { recursive: true });
    writeFileSync(join(root, "raw", "repo.zip", "unpacking.json"), "{}");
    expect(browseSource(root, "repo.zip").incomplete).toBe(true);
  });

  it("refuses an id that names no source", () => {
    expect(() => browseSource(root, "ghost")).toThrow(/no source/i);
  });

  it("finds a source filed into a folder", () => {
    mkdirSync(join(root, "raw", "2026", "filed.md"), { recursive: true });
    writeFileSync(
      join(root, "raw", "2026", "filed.md", "manifest.json"),
      JSON.stringify({ id: "filed.md", title: "Filed", kind: "file", original: "" }),
      "utf8",
    );
    expect(browseSource(root, "filed.md").entries.map((e) => e.path)).toEqual(["manifest.json"]);
  });
});

describe("a superseded source says so where the page shows it (7.6)", () => {
  function superseded(id: string, by: string, date?: string): void {
    source(id);
    writeFileSync(
      join(root, "raw", id, "manifest.json"),
      JSON.stringify({
        id,
        title: "The old one",
        kind: "file",
        original: id,
        status: "superseded",
        "superseded-by": by,
        ...(date ? { superseded: date } : {}),
      }),
      "utf8",
    );
  }

  it("carries the replacement onto the page's own list of what it rests on", () => {
    // A citation into replaced evidence resolving silently is the outcome
    // supersession exists to prevent, so it is said here and not only on the
    // sources screen somebody may never open.
    superseded("old.pdf", "new.pdf", "2026-08-03");
    page("fenix", "As src://old.pdf#p1 says.");

    const cited = sourcesOfPage(root, "fenix");
    expect(cited).toHaveLength(1);
    expect(cited[0]!.superseded).toEqual({ by: "new.pdf", date: "2026-08-03" });
  });

  it("says nothing about supersession for a source nobody replaced", () => {
    source("current.pdf");
    page("fenix", "As src://current.pdf#p1 says.");
    expect(sourcesOfPage(root, "fenix")[0]!.superseded).toBeUndefined();
  });

  it("shows it on the sources row too", () => {
    superseded("old.pdf", "new.pdf");
    expect(sourceRows(root)[0]!.superseded?.by).toBe("new.pdf");
  });
});

describe("marking a source read by hand (7.1)", () => {
  it("writes the declaration through the one manifest mutator", () => {
    source("notes.md");
    markSourceProcessed(root, "notes.md", true, "2026-08-03");
    expect(sourceRows(root)[0]!.processed).toBe("2026-08-03");
  });

  it("withdraws it again", () => {
    source("notes.md");
    markSourceProcessed(root, "notes.md", true, "2026-08-03");
    markSourceProcessed(root, "notes.md", false, "2026-08-03");
    expect(sourceRows(root)[0]!.processed).toBeUndefined();
  });

  it("reaches the renderer through its own channel", async () => {
    source("notes.md");
    const api = createApi({ projectRoot: root });
    await dispatch(api, CHANNELS.markSource, ["notes.md", true]);
    expect(sourceDetail(root, "notes.md").processed).toBeTruthy();
    const browse = await dispatch(api, CHANNELS.browseSource, ["notes.md"]);
    expect((browse as { entries: unknown[] }).entries.length).toBeGreaterThan(0);
  });
});

describe("the sources pane shows what a source is (7.1)", () => {
  it("carries the size of what arrived onto the row", () => {
    source("report.pdf", { text: false });
    writeFileSync(join(root, "raw", "report.pdf", "source.pdf"), "%PDF-1.4 and then some");
    expect(sourceRows(root)[0]!.bytes).toBe(22);
  });

  it("carries the description the agent wrote", () => {
    source("fnd348r34nr483r.txt");
    writeFileSync(
      join(root, "raw", "fnd348r34nr483r.txt", "manifest.json"),
      JSON.stringify({
        id: "fnd348r34nr483r.txt",
        title: "fnd348r34nr483r.txt",
        kind: "file",
        original: "fnd348r34nr483r.txt",
        description: "The Q3 incident timeline.",
      }),
      "utf8",
    );
    // The row this whole group exists for: its only readable field was the
    // filename, and the filename says nothing.
    expect(sourceRows(root)[0]!.description).toBe("The Q3 incident timeline.");
  });
});

describe("group 7, after review", () => {
  it("refuses to walk a contents/ that is itself a junction (7.5)", () => {
    // `walk` skips a symlinked *entry*, which is the easier half — `contents`
    // can itself be a junction, and a junction needs no privilege on Windows
    // and is not a symlink. Walking it listed an arbitrary directory and handed
    // the names and sizes to the renderer. `export/zip.ts` had to add the same
    // "the tree root is checked too" fix after the same finding.
    source("repo.zip", { text: false });
    const outside = mkdtempSync(join(tmpdir(), "ow-outside-"));
    writeFileSync(join(outside, "secret-file.txt"), "not this project's");
    try {
      symlinkSync(outside, join(root, "raw", "repo.zip", "contents"), "junction");
    } catch {
      rmSync(outside, { recursive: true, force: true });
      return; // junction creation unavailable on this machine
    }

    const browse = browseSource(root, "repo.zip");
    expect(browse.entries.map((e) => e.path)).not.toContain("secret-file.txt");
    // It falls back to the source's own directory, which is inside `raw/`.
    expect(browse.tree).toBe(false);
    // And the viewer does not offer it either.
    expect(locateCitation(root, "repo.zip", "p1").kind).not.toBe("tree");
    rmSync(outside, { recursive: true, force: true });
  });

  it("counts what it did not show, including inside a directory past the cap (7.5)", () => {
    // Skipping an over-cap directory outright meant none of its descendants
    // were ever counted, so `truncated` said 1 where the answer was 501 — a
    // number whose only job is to be right about what was not shown.
    source("many.zip", { text: false });
    const contents = join(root, "raw", "many.zip", "contents");
    mkdirSync(contents, { recursive: true });
    for (let i = 0; i < MAX_BROWSE_ENTRIES; i++) {
      writeFileSync(join(contents, `f${String(i).padStart(5, "0")}.txt`), "x");
    }
    const deeper = join(contents, "zzz-more");
    mkdirSync(deeper, { recursive: true });
    for (let i = 0; i < 500; i++) writeFileSync(join(deeper, `g${i}.txt`), "x");

    const browse = browseSource(root, "many.zip");
    expect(browse.entries).toHaveLength(MAX_BROWSE_ENTRIES);
    // 1 for the directory itself plus its 500 files.
    expect(browse.truncated).toBe(501);
    // 2,500 synchronous file writes: ~800ms on a developer's machine and ~8s on
    // the Windows CI runner under V8 coverage instrumentation, which crossed the
    // 5s default and reddened a branch that had changed nothing on this path.
    // The assertions are untouched — only the clock is, and 15s is the same
    // allowance `wiring.spec.ts` and `socket.spec.ts` already give their slow
    // cases. The cost is inherent to what the test is for: the bug it guards
    // only appears past the cap, so the files have to actually exist.
  }, 15_000);

  it("keeps the original date when a source is marked twice (7.1)", () => {
    // `runSourceMark`'s contract, and this is "the same act through the other
    // door". The declaration records *when somebody read the source*, so
    // re-stamping it on a repeat would lose the only fact it carries.
    source("notes.md");
    markSourceProcessed(root, "notes.md", true, "2026-08-01");
    markSourceProcessed(root, "notes.md", true, "2026-08-09");
    expect(sourceRows(root)[0]!.processed).toBe("2026-08-01");
  });

  it("writes nothing when there is nothing to withdraw (7.1)", () => {
    source("notes.md");
    const before = readFileSync(join(root, "raw", "notes.md", "manifest.json"), "utf8");
    markSourceProcessed(root, "notes.md", false, "2026-08-01");
    expect(readFileSync(join(root, "raw", "notes.md", "manifest.json"), "utf8")).toBe(before);
  });

  it("carries an image as a data URL, because img-src has no file: in it (7.4)", () => {
    // `media-src` does, which is how the audio player loads an Opus off disk;
    // `img-src` is `'self' data:`, and widening it to show a picture would
    // answer a real constraint by removing it.
    source("shot.png", { text: false });
    // A one-pixel PNG, so the bytes are a real image rather than a placeholder.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    writeFileSync(join(root, "raw", "shot.png", "source.png"), png);

    const at = locateCitation(root, "shot.png", "p1");
    expect(at.kind).toBe("image");
    if (at.kind !== "image") return;
    expect(at.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(Buffer.from(at.dataUrl.split(",")[1]!, "base64")).toEqual(png);
  });

  it("offers an image too large to inline to the system instead (7.4)", () => {
    source("huge.png", { text: false });
    writeFileSync(
      join(root, "raw", "huge.png", "source.png"),
      Buffer.alloc(MAX_INLINE_IMAGE_BYTES + 1),
    );
    // A panel is not where a 9 MB screenshot is read anyway, and the fallback is
    // the same answer every other unshowable file gets.
    expect(locateCitation(root, "huge.png", "p1").kind).toBe("external");
  });

  it("confines the file it hands to the system (7.4)", () => {
    source("model.step", { text: false });
    writeFileSync(join(root, "raw", "model.step", "source.step"), "solid");
    expect(revealPath(root, "model.step")).toContain(join("raw", "model.step"));
    expect(() => revealPath(root, "../../elsewhere")).toThrow();
    expect(() => revealPath(root, "ghost")).toThrow(/no file to show/i);
  });
});

describe("the browse walk is bounded (7.5, second review)", () => {
  it("has bounds that are the product's, not the tests'", () => {
    // The tests below pass their own so the suite does not write forty thousand
    // files to prove arithmetic. What the product enforces is pinned here, so
    // loosening it by accident is a failing test rather than a frozen window.
    expect(MAX_BROWSE_ENTRIES).toBe(2000);
    expect(MAX_BROWSE_VISIT).toBe(10000);
    expect(MAX_BROWSE_DEPTH).toBe(32);
  });

  it("stops counting past the visit bound, and says the number is a floor", () => {
    // Making `truncated` exact removed the early exit, and nothing upstream
    // bounds the tree: `unpackArchive` caps total bytes and the expansion
    // ratio, and an archive of a million empty files passes both. This runs
    // synchronously in the Electron main process, so an unbounded walk is a
    // frozen window.
    source("many.zip", { text: false });
    const contents = join(root, "raw", "many.zip", "contents");
    mkdirSync(contents, { recursive: true });
    for (let i = 0; i < 40; i++) {
      writeFileSync(join(contents, `f${String(i).padStart(3, "0")}.txt`), "");
    }
    const browse = browseSource(root, "many.zip", { entries: 5, visit: 20 });
    expect(browse.entries).toHaveLength(5);
    expect(browse.atLeast).toBe(true);
    // A floor, not a count: 20 seen, 5 shown, and it stopped looking.
    expect(browse.truncated).toBe(15);
  });

  it("stops descending past the depth bound rather than blowing the stack", () => {
    // `walk` recurses, so a tree of a thousand single-child directories is an
    // uncaught RangeError rather than a slow answer.
    source("deep.zip", { text: false });
    let at = join(root, "raw", "deep.zip", "contents");
    mkdirSync(at, { recursive: true });
    for (let i = 0; i <= 8; i++) {
      at = join(at, `d${i}`);
      mkdirSync(at, { recursive: true });
    }
    writeFileSync(join(at, "buried.txt"), "x");

    const browse = browseSource(root, "deep.zip", { depth: 4 });
    expect(browse.atLeast).toBe(true);
    expect(browse.entries.some((e) => e.path.endsWith("buried.txt"))).toBe(false);
  });

  it("says nothing about a floor for a tree it counted whole", () => {
    source("small.zip", { text: false });
    const contents = join(root, "raw", "small.zip", "contents");
    mkdirSync(contents, { recursive: true });
    writeFileSync(join(contents, "a.txt"), "x");
    const browse = browseSource(root, "small.zip");
    expect(browse.atLeast).toBeUndefined();
    expect(browse.truncated).toBe(0);
  });

  it("reveals a real source through the channel, not only through the function", () => {
    // The `deps.reveal` branch was wired and never exercised for a valid id:
    // the channel test used one that throws before reaching it.
    source("model.step", { text: false });
    writeFileSync(join(root, "raw", "model.step", "source.step"), "solid");
    const revealed: string[] = [];
    const api = createApi({ projectRoot: root, reveal: (file) => revealed.push(file) });
    api.revealSource("model.step");
    expect(revealed).toHaveLength(1);
    expect(revealed[0]).toContain(join("raw", "model.step"));
  });
});

describe("a source's own file cannot be a link out (7.4, security review)", () => {
  /**
   * Whether this machine can make a file symlink at all.
   *
   * Windows needs Developer Mode or an elevated shell, so the three cases below
   * are **skipped rather than passed** where it cannot: a security test that
   * quietly returns early reads as coverage it does not have, which is the
   * failure this repository names in its own archive tests. The case that needs
   * no privilege is asserted unconditionally at the end.
   */
  const canSymlink = ((): boolean => {
    const probe = mkdtempSync(join(tmpdir(), "ow-sl-"));
    try {
      writeFileSync(join(probe, "t"), "x");
      symlinkSync(join(probe, "t"), join(probe, "l"), "file");
      return true;
    } catch {
      return false;
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  })();

  /** A source whose `source.<ext>` is a link to `target`. */
  function linkedOriginal(id: string, target: string): boolean {
    source(id, { text: false });
    symlinkSync(target, join(root, "raw", id, `source${id.slice(id.lastIndexOf("."))}`), "file");
    return true;
  }

  it.skipIf(!canSymlink)("does not read a symlinked original into a data URL", () => {
    // The directory being confined was not enough. A repository shipping
    // `raw/leak.png/source.png` as a symlink to a key read that file's bytes
    // into a `data:` URL and across IPC into the renderer, on one click of what
    // looks like an ordinary citation.
    const outside = mkdtempSync(join(tmpdir(), "ow-secret-"));
    const secret = join(outside, "id_rsa");
    writeFileSync(secret, "PRIVATE KEY MATERIAL");
    try {
      linkedOriginal("leak.png", secret);
      const at = locateCitation(root, "leak.png", "p1");
      expect(at.kind).not.toBe("image");
      expect(JSON.stringify(at)).not.toContain("PRIVATE KEY");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it.skipIf(!canSymlink)("does not hand a symlinked original to the system", () => {
    const outside = mkdtempSync(join(tmpdir(), "ow-secret-"));
    writeFileSync(join(outside, "creds.txt"), "secret");
    try {
      linkedOriginal("leak.step", join(outside, "creds.txt"));
      expect(() => revealPath(root, "leak.step")).toThrow(/no file to show/i);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it.skipIf(!canSymlink)("does not open a symlinked recording as audio", () => {
    const outside = mkdtempSync(join(tmpdir(), "ow-secret-"));
    writeFileSync(join(outside, "anything.bin"), "bytes");
    try {
      source("weekly", { kind: "recording", text: false });
      symlinkSync(join(outside, "anything.bin"), join(root, "raw", "weekly", "mic.opus"), "file");
      const at = locateCitation(root, "weekly", "0:01");
      expect(at.kind).toBe("missing");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("refuses a source.<ext> that is not a regular file, on any machine", () => {
    // The half of `fileIn` that needs no privilege to exercise: a directory
    // standing where the preserved original should be. It is the same rule —
    // what is opened has to be the file this application wrote — and it runs
    // everywhere, including where a symlink cannot be made.
    source("odd.pdf", { text: false });
    mkdirSync(join(root, "raw", "odd.pdf", "source.pdf"), { recursive: true });
    expect(locateCitation(root, "odd.pdf", "p1").kind).toBe("missing");
    expect(() => revealPath(root, "odd.pdf")).toThrow(/no file to show/i);
  });

  it("still opens an ordinary file that is really there", () => {
    source("report.pdf", { text: false });
    writeFileSync(join(root, "raw", "report.pdf", "source.pdf"), "%PDF-1.4");
    expect(locateCitation(root, "report.pdf", "p3").kind).toBe("document");
  });
});
