import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { listOperations } from "@open-wiki/access";
import { isSandboxBackend } from "deepagents";
import { MAX_READ_BYTES, WikiGateBackend } from "../src/main/agent/wiki-gate-backend.js";

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "ow-wgb-"));
  mkdirSync(join(root, "wiki"), { recursive: true });
  mkdirSync(join(root, ".state"), { recursive: true });
  mkdirSync(join(root, "raw"), { recursive: true });
  return root;
}

/** A minimal valid entity page for `wiki/<slug>.md` the store will accept. */
function pageFor(slug: string, body = "Body.\n"): string {
  const fm = [
    `id: t:${slug}`,
    "type: t",
    `title: ${slug}`,
    "status: active",
    "aliases: []",
    'updated: ""',
    "sources: []",
    'superseded-by: ""',
  ].join("\n");
  return `---\n${fm}\n---\n${body}`;
}

describe("WikiGateBackend — confinement (R3.1, R3.2)", () => {
  let root: string;
  let backend: WikiGateBackend;
  beforeEach(() => {
    root = tempProject();
    backend = new WikiGateBackend(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("ls returns an error for a path outside the project and reads nothing", () => {
    const out = mkdtempSync(join(tmpdir(), "ow-wgb-out-"));
    try {
      const r = backend.ls(join(out, "sub"));
      expect(r.error).toBeDefined();
      expect(r.files).toBeUndefined();
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("read returns an error for a path outside the project and reads nothing", () => {
    const r = backend.read("../secret.md");
    expect(r.error).toBeDefined();
    expect(r.content).toBeUndefined();
  });

  it("readRaw returns an error for a path outside the project and reads nothing (R3.2, 6.13)", () => {
    const r = backend.readRaw("../secret.md");
    expect(r.error).toBeDefined();
    expect(r.data).toBeUndefined();
  });

  it("refuses a Windows directory junction inside the project that points outside — R3.2, 6.6", (ctx) => {
    // The confinement the backend leans on (`assertWithin` + real-path resolve)
    // is proven against symlinks and junctions in `@open-wiki/access`. This is
    // the same check seen *through* the backend: a read through a junction that
    // lands outside the project returns an error and reads nothing, not the
    // secret on the other side of the link.
    const outside = join(dirname(root), "wgb-junction-target");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.md"), "no");
    const junction = join(root, "wiki", "junction");
    try {
      symlinkSync(outside, junction, "junction");
    } catch (err) {
      rmSync(outside, { recursive: true, force: true });
      // A junction needs no privilege on Windows, so a failure there is a test
      // problem, not an account one. Elsewhere a junction is emulated as a
      // symlink and may genuinely be unavailable.
      if (process.platform === "win32") throw err;
      ctx.skip(`junction creation unavailable: ${err instanceof Error ? err.message : err}`);
      return;
    }
    try {
      const through = join(junction, "secret.md");
      const r = backend.read(through);
      expect(r.error).toBeDefined();
      expect(r.content).toBeUndefined();
      const raw = backend.readRaw(through);
      expect(raw.error).toBeDefined();
      expect(raw.data).toBeUndefined();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("ls lists a directory's entries, marking directories with a trailing slash", () => {
    writeFileSync(join(root, "wiki", "fenix.md"), pageFor("fenix"));
    const r = backend.ls(join(root, "wiki"));
    expect(r.error).toBeUndefined();
    const files = r.files!;
    const names = files.map((f) => f.path);
    expect(names.some((p) => p.replace(/\\/g, "/").endsWith("/wiki/fenix.md"))).toBe(true);
    expect(files.find((f) => f.is_dir)).toBeUndefined(); // no subdirs in wiki/
  });

  it("read paginates by line offset/limit", () => {
    const content = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
    writeFileSync(join(root, "notes.txt"), content);
    const r = backend.read(join(root, "notes.txt"), 2, 3);
    expect(r.content).toBe("line 2\nline 3\nline 4");
  });

  it("read returns raw bytes for a binary file", () => {
    writeFileSync(join(root, "raw", "blob.bin"), Buffer.from([0, 1, 2, 3]));
    const r = backend.read(join(root, "raw", "blob.bin"));
    expect(r.content).toBeInstanceOf(Uint8Array);
    expect((r.content as Uint8Array).length).toBe(4);
  });

  it("readRaw returns FileData with text content and a mime type for a markdown page", () => {
    writeFileSync(join(root, "wiki", "fenix.md"), pageFor("fenix"));
    const r = backend.readRaw(join(root, "wiki", "fenix.md"));
    expect(r.error).toBeUndefined();
    const data = r.data!;
    expect(typeof data.content).toBe("string");
    expect((data.content as string).startsWith("---")).toBe(true);
    expect("mimeType" in data && data.mimeType).toBe("text/markdown");
  });

  it("glob matches files under a confined base", () => {
    writeFileSync(join(root, "wiki", "fenix.md"), pageFor("fenix"));
    writeFileSync(join(root, "wiki", "index.md"), "# Index\n");
    const r = backend.glob("**/*.md", join(root, "wiki"));
    expect(r.files!.length).toBe(2);
  });

  it("grep finds literal matches with 1-indexed line numbers, skipping binary files", () => {
    writeFileSync(join(root, "wiki", "fenix.md"), "alpha\nbeta FENIX\ngamma\n");
    writeFileSync(join(root, "raw", "blob.bin"), Buffer.from([0, 1, 2]));
    const r = backend.grep("FENIX", join(root, "wiki"));
    expect(r.matches).toHaveLength(1);
    expect(r.matches![0]!.line).toBe(2);
    expect(r.matches![0]!.text).toContain("FENIX");
  });
});

describe("WikiGateBackend — not a sandbox (R4.4, 6.3)", () => {
  it("has no execute, so isSandboxBackend is false", () => {
    const backend = new WikiGateBackend(tempProject());
    expect(isSandboxBackend(backend)).toBe(false);
    expect((backend as unknown as { execute?: unknown }).execute).toBeUndefined();
  });
});

describe("WikiGateBackend.write — the write boundary is the store (R4.1, R4.3, R4.5)", () => {
  let root: string;
  let backend: WikiGateBackend;
  beforeEach(() => {
    root = tempProject();
    backend = new WikiGateBackend(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("refuses a write outside wiki/ and writes nothing (TDD red)", () => {
    const r = backend.write("README.md", "hello");
    expect(r.error).toBeDefined();
    expect(existsSync(join(root, "README.md"))).toBe(false);
  });

  it("refuses a write to the gate's own configuration and writes nothing", () => {
    const r = backend.write(".claude/settings.json", "{}");
    expect(r.error).toBeDefined();
    expect(existsSync(join(root, ".claude", "settings.json"))).toBe(false);
  });

  it("writes a valid entity page through the store with origin agent (TDD red)", () => {
    const r = backend.write("wiki/fenix.md", pageFor("fenix"));
    expect(r.error).toBeUndefined();
    expect(r.path).toBeDefined();
    expect(existsSync(join(root, "wiki", "fenix.md"))).toBe(true);
    const ops = listOperations(root);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.origin).toBe("agent");
    expect(ops[0]!.pages[0]!.path.replace(/\\/g, "/")).toBe("wiki/fenix.md");
  });

  it("refuses a page the gate rejects (bad frontmatter) and writes nothing", () => {
    const r = backend.write("wiki/bad.md", "---\nbroken\n---\n");
    expect(r.error).toBeDefined();
    expect(existsSync(join(root, "wiki", "bad.md"))).toBe(false);
    expect(listOperations(root)).toHaveLength(0);
  });
});

describe("WikiGateBackend.edit — exact replacement through the store (R4.1, R4.3, 6.1)", () => {
  let root: string;
  let backend: WikiGateBackend;
  beforeEach(() => {
    root = tempProject();
    backend = new WikiGateBackend(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("refuses an edit outside wiki/ and writes nothing (TDD red)", () => {
    writeFileSync(join(root, "README.md"), "hello world");
    const r = backend.edit("README.md", "hello", "goodbye");
    expect(r.error).toBeDefined();
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("hello world");
  });

  it("applies an exact single replacement and preserves the rest of the page (TDD red)", () => {
    writeFileSync(join(root, "wiki", "fenix.md"), pageFor("fenix", "alpha\nbeta\ngamma\n"));
    const r = backend.edit(join(root, "wiki", "fenix.md"), "beta", "BETA");
    expect(r.error).toBeUndefined();
    expect(r.occurrences).toBe(1);
    const after = readFileSync(join(root, "wiki", "fenix.md"), "utf8");
    expect(after).toContain("BETA");
    expect(after).toContain("alpha");
    expect(after).toContain("gamma");
  });

  it("replaces every match with replace_all and reports the count (TDD red)", () => {
    // slug "alpha" carries no "x", so the replace only hits the body.
    writeFileSync(join(root, "wiki", "alpha.md"), pageFor("alpha", "x x x\n"));
    const r = backend.edit(join(root, "wiki", "alpha.md"), "x", "y", true);
    expect(r.error).toBeUndefined();
    expect(r.occurrences).toBe(3);
    const after = readFileSync(join(root, "wiki", "alpha.md"), "utf8");
    expect(after).toContain("y y y");
    expect(after).not.toMatch(/\bx\b/);
  });

  it("refuses an edit whose old_string is absent and writes nothing (TDD red)", () => {
    writeFileSync(join(root, "wiki", "fenix.md"), pageFor("fenix", "alpha\n"));
    const before = readFileSync(join(root, "wiki", "fenix.md"), "utf8");
    const r = backend.edit(join(root, "wiki", "fenix.md"), "nope", "yes");
    expect(r.error).toBeDefined();
    expect(readFileSync(join(root, "wiki", "fenix.md"), "utf8")).toBe(before);
  });

  it("refuses an empty old_string and leaves the page byte-identical", () => {
    // An empty `old_string` is a whole-page rewrite wearing an edit's clothes:
    // `split("").join(s)` puts `s` between every character, and without
    // `replace_all` it prepends. `previewReplace` returns null for it, so the
    // human would be approving the most destructive edit there is with nothing
    // shown. Both branches are refused, and both leave the page untouched.
    writeFileSync(join(root, "wiki", "fenix.md"), pageFor("fenix", "alpha\n"));
    const page = join(root, "wiki", "fenix.md");
    const before = readFileSync(page, "utf8");
    for (const all of [false, true]) {
      const r = backend.edit(page, "", "INJECTED", all);
      expect(r.error, `replace_all=${all} is refused`).toBeDefined();
      expect(r.occurrences).toBeUndefined();
      expect(readFileSync(page, "utf8")).toBe(before);
    }
  });
});

describe("WikiGateBackend — reads fail closed and stay bounded (R3.1)", () => {
  let root: string;
  let backend: WikiGateBackend;
  beforeEach(() => {
    root = tempProject();
    backend = new WikiGateBackend(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("readRaw answers a directory with an error instead of raising EISDIR", () => {
    // `read` already guarded this and `readRaw` did not, so the model reached a
    // raw exception out of the backend by naming a directory — a path it can
    // find with `ls`. Every failure in this class is a `{ error }` result.
    mkdirSync(join(root, "wiki", "sub"), { recursive: true });
    const r = backend.readRaw(join(root, "wiki", "sub"));
    expect(r.error).toBeDefined();
    expect(r.data).toBeUndefined();
  });

  it("edit answers a directory with an error instead of raising EISDIR", () => {
    // `existsSync` is true for a directory, so the read behind `edit` met one too.
    mkdirSync(join(root, "wiki", "sub"), { recursive: true });
    const r = backend.edit(join(root, "wiki", "sub"), "a", "b");
    expect(r.error).toBeDefined();
  });

  it("refuses a file over the read limit rather than pulling it into main", () => {
    // These reads run in the Electron main process, so an unbounded read of a
    // recording under `raw/` is the application's memory. The limit is refused
    // as an error, not silently truncated — a truncated read would make the
    // model reason about a file it only partly saw.
    const big = join(root, "raw", "huge.txt");
    writeFileSync(big, "");
    truncateSync(big, MAX_READ_BYTES + 1);
    expect(backend.read(big).error).toBeDefined();
    expect(backend.read(big).content).toBeUndefined();
    expect(backend.readRaw(big).error).toBeDefined();
    expect(backend.readRaw(big).data).toBeUndefined();
  });

  it("grep skips a file it cannot read instead of losing every match found", () => {
    // One unreadable or oversized file in a scan must not discard the matches
    // already collected: a project has a lock, a dangling link or a recording in
    // it sooner or later, and losing the whole result to one turns a working
    // tool into an intermittent failure.
    writeFileSync(join(root, "wiki", "a.md"), "needle here\n");
    const big = join(root, "raw", "huge.txt");
    writeFileSync(big, "");
    truncateSync(big, MAX_READ_BYTES + 1);
    writeFileSync(join(root, "wiki", "b.md"), "needle again\n");

    const r = backend.grep("needle");
    expect(r.error).toBeUndefined();
    expect(r.matches?.map((m) => m.text)).toEqual(["needle here", "needle again"]);
  });
});
