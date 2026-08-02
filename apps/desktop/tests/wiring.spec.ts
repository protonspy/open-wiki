import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bridge, hasBridge, NoBridgeError } from "../src/renderer/bridge.js";
import { RecorderError, resolveRecorder, spawnTransport } from "../src/main/recorder.js";
import { watchProject } from "../src/main/watcher.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ow-wiring-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env["OPEN_WIKI_RECORDER"];
  delete (globalThis as { window?: unknown }).window;
});

describe("the renderer's bridge (8.2)", () => {
  it("hands back what the preload exposed", () => {
    const ow = { project: () => Promise.resolve({}) };
    (globalThis as { window?: unknown }).window = { ow };
    expect(hasBridge()).toBe(true);
    expect(bridge()).toBe(ow);
  });

  it("says which half is missing rather than failing on undefined", () => {
    // Opening the built page in a plain browser happens while iterating, and
    // "cannot read properties of undefined" is a worse answer.
    (globalThis as { window?: unknown }).window = {};
    expect(hasBridge()).toBe(false);
    expect(() => bridge()).toThrow(NoBridgeError);
  });

  it("is absent outside a window entirely", () => {
    expect(hasBridge()).toBe(false);
  });
});

describe("resolveRecorder (8.2)", () => {
  it("takes the binary beside the application", () => {
    writeFileSync(join(root, "recorder.exe"), "");
    expect(resolveRecorder(root)).toBe(join(root, "recorder.exe"));
  });

  it("falls back to a checkout's build output", () => {
    mkdirSync(join(root, "target", "release"), { recursive: true });
    writeFileSync(join(root, "target", "release", "recorder.exe"), "");
    expect(resolveRecorder(root)).toBe(join(root, "target", "release", "recorder.exe"));
  });

  it("prefers an explicitly named binary", () => {
    writeFileSync(join(root, "recorder.exe"), "");
    const other = join(root, "mine.exe");
    writeFileSync(other, "");
    process.env["OPEN_WIKI_RECORDER"] = other;
    expect(resolveRecorder(root)).toBe(other);
  });

  it("says how to get one rather than failing obscurely", () => {
    expect(() => resolveRecorder(root)).toThrow(RecorderError);
    expect(() => resolveRecorder(root)).toThrow(/cargo build --release/);
  });
});

describe("the transcription door withdraws a processed declaration (source-status R3.1)", () => {
  // `text.md` reaches a source through two doors. `writeSourceText` is one and
  // withdraws in `@open-wiki/access`, where its own tests exercise it. The other
  // is `finishRecording`, which writes through `@open-wiki/audio` — a package
  // that deliberately does not depend on `@open-wiki/access` — so the
  // withdrawal has to be made by the caller that imports both.
  //
  // This is a source-level assertion, the way the MCP read-only boundary is
  // pinned, because `runTranscription` needs a configured provider and an
  // ffmpeg binary and CI has neither. It cannot prove the call runs; it does
  // catch the regression that actually happened once — the recording path
  // quietly not withdrawing at all, which is the very case R3.1 exists for.
  const source = readFileSync(join(__dirname, "..", "src", "main", "transcribe-run.ts"), "utf8");

  it("imports the one withdrawal both doors share, rather than writing a second", () => {
    expect(source).toMatch(/withdrawProcessed/);
    expect(source).not.toMatch(/processed:\s*null/);
  });

  it("withdraws only once the transcript actually landed", () => {
    // A part-done run gets a timeline and no `text.md`, and nothing changed
    // under a declaration that has not been outrun.
    expect(source).toMatch(/finished\.textReady\s*\)?\s*withdrawProcessed\(projectRoot, id\)/);
  });
});

describe("spawnTransport (8.2)", () => {
  it("splits the sidecar's output into whole lines", async () => {
    // `process.execPath` stands in for the recorder: this tests the framing,
    // which is the half of the module that has nothing to do with audio. The
    // two objects are written in one chunk and split across another, which is
    // exactly how a pipe delivers them.
    const lines: string[] = [];
    const transport = spawnTransport(process.execPath, [
      "-e",
      `process.stdout.write('{"ok":true,"a":1}\\n{"ok":true,` +
        `');process.stdout.write('"b":2}\\n')`,
    ]);
    transport.onLine((line) => lines.push(line));
    await new Promise<void>((resolve) => transport.onClose(() => resolve()));
    expect(lines).toEqual(['{"ok":true,"a":1}', '{"ok":true,"b":2}']);
  }, 15_000);

  it("does not deliver a line that has not ended yet", async () => {
    const lines: string[] = [];
    const transport = spawnTransport(process.execPath, [
      "-e",
      `process.stdout.write('{"ok":true}');setTimeout(()=>process.exit(0),50)`,
    ]);
    transport.onLine((line) => lines.push(line));
    await new Promise<void>((resolve) => transport.onClose(() => resolve()));
    expect(lines).toEqual([]);
  }, 15_000);

  it("can be closed", () => {
    const transport = spawnTransport(process.execPath, ["-e", "setTimeout(()=>{},10000)"]);
    expect(() => transport.close()).not.toThrow();
  });
});

describe("watchProject (8.10)", () => {
  it("reports a page written by anything at all", async () => {
    mkdirSync(join(root, "wiki"), { recursive: true });
    mkdirSync(join(root, "raw"), { recursive: true });
    const seen: string[] = [];
    const watcher = watchProject(root, (change) => seen.push(`${change.kind} ${change.path}`), {
      stabilityMs: 20,
    });
    try {
      await new Promise((r) => setTimeout(r, 150));
      writeFileSync(join(root, "wiki", "fenix.md"), "---\nid: fenix\n---\n", "utf8");
      await waitFor(() => seen.length > 0);
      expect(seen[0]).toBe("added wiki/fenix.md");
    } finally {
      await watcher.close();
    }
  }, 15_000);

  it("does not watch .state, which is not content", async () => {
    mkdirSync(join(root, "wiki"), { recursive: true });
    mkdirSync(join(root, "raw"), { recursive: true });
    mkdirSync(join(root, ".state"), { recursive: true });
    const seen: string[] = [];
    const watcher = watchProject(root, (change) => seen.push(change.path), { stabilityMs: 20 });
    try {
      await new Promise((r) => setTimeout(r, 150));
      writeFileSync(join(root, ".state", "log.json"), "[]", "utf8");
      writeFileSync(join(root, "wiki", "a.md"), "x", "utf8");
      await waitFor(() => seen.length > 0);
      expect(seen.every((p) => p.startsWith("wiki/"))).toBe(true);
    } finally {
      await watcher.close();
    }
  }, 15_000);
});

async function waitFor(condition: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the watcher");
    await new Promise((r) => setTimeout(r, 25));
  }
}
