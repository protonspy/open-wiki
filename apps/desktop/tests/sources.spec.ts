import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHANNELS, createApi, dispatch } from "../src/main/ipc.js";
import { PUSH_CHANNELS } from "../src/main/channels.js";
import {
  asDropOutcome,
  inboxFailure,
  ingestDrop,
  ingestFile,
  recognises,
  recognisedExtensions,
} from "../src/main/ingest.js";
import {
  findings,
  locateCitation,
  sourceDetail,
  sourceRows,
  sourcesOfPage,
} from "../src/main/sources.js";

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

  it("recognises what it has an adapter for", () => {
    expect(recognises("notes.md")).toBe(true);
    expect(recognises("NOTES.MD")).toBe(true);
    expect(recognises("deck.pptx")).toBe(false);
    expect(recognisedExtensions()).toContain(".pdf");
  });

  it("ingests a markdown file through the same path 3.1 registers everything with", async () => {
    const outcome = await ingestFile(root, file("Notes.md"));
    expect(outcome).toMatchObject({ ok: true, id: "notes.md" });
  });

  it("says what it did not recognise, rather than dropping it silently", async () => {
    const outcome = await ingestFile(root, file("deck.pptx"));
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toContain(".pdf");
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
    const outcomes = await ingestDrop(root, [file("one.md"), file("deck.pptx"), file("two.txt")]);
    expect(outcomes.map((o) => o.ok)).toEqual([true, false, true]);
    expect(outcomes.map((o) => o.name)).toEqual(["one.md", "deck.pptx", "two.txt"]);
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
      asDropOutcome({ ok: true, name: "notes.md", format: "text", id: "notes.md", removed: true }),
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
        format: null,
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
    expect([...PUSH_CHANNELS].sort()).toEqual([CHANNELS.changed, CHANNELS.inbox].sort());
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
