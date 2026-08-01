import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  INBOX,
  drainInbox,
  ensureInbox,
  inboxPath,
  watchInbox,
  MAX_SOURCE_BYTES,
  type InboxOutcome,
} from "../src/sources/inbox.js";
import { listSources } from "../src/sources/manifest.js";
import { scaffold } from "../src/scaffold.js";
import { buildPdf } from "./fixtures/documents.js";

function tempProject(): string {
  // Resolved once, here. `inboxPath` returns the real path (`assertWithin`
  // does), and `os.tmpdir()` is itself a symlink on macOS (/var → /private/var),
  // so an unresolved root would not compare equal to what the code returns.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ow-inbox-")));
  mkdirSync(join(root, "raw", INBOX), { recursive: true });
  return root;
}

/** Poll until `predicate` holds, so the watcher tests wait on the event, not a sleep. */
async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the watcher");
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * Create a symlink, or return false when this account cannot. A Windows
 * account without the symlink privilege is a different failure from the
 * behaviour under test, and the repo already treats it that way in
 * `paths.spec.ts` — Windows is the platform this product supports, so the
 * suite has to run there for a developer who is not elevated.
 */
function trySymlink(target: string, path: string): boolean {
  try {
    symlinkSync(target, path);
    return true;
  } catch (err) {
    // Only the missing-privilege codes are a platform skip. Anything else is a
    // real failure and has to fail the test rather than pass it quietly.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") return false;
    throw err;
  }
}

describe("the raw/_inbox doorway (3.7)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  describe("inboxPath / ensureInbox", () => {
    it("is raw/_inbox inside the project", () => {
      expect(inboxPath(root)).toBe(join(root, "raw", INBOX));
    });

    it("creates the directory when it is not there", () => {
      rmSync(join(root, "raw", INBOX), { recursive: true, force: true });
      ensureInbox(root);
      expect(existsSync(join(root, "raw", INBOX))).toBe(true);
    });

    it("is scaffolded with the project, so the doorway is visible from the start", () => {
      const fresh = join(root, "fresh");
      scaffold(fresh);
      expect(existsSync(join(fresh, "raw", INBOX))).toBe(true);
    });
  });

  describe("drainInbox", () => {
    it("ingests what landed there through the same path as an upload", async () => {
      writeFileSync(join(root, "raw", INBOX, "fetched.md"), "# Fetched\n");
      const outcomes = await drainInbox(root);

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]).toMatchObject({ ok: true, id: "fetched.md", removed: true });
      expect(readFileSync(join(root, "raw", "fetched.md", "text.md"), "utf8")).toBe("# Fetched\n");
    });

    it("empties the doorway of what became a source", async () => {
      writeFileSync(join(root, "raw", INBOX, "a.md"), "a");
      await drainInbox(root);
      expect(existsSync(join(root, "raw", INBOX, "a.md"))).toBe(false);
    });

    it("ingests a PDF dropped in, with its page anchors", async () => {
      writeFileSync(join(root, "raw", INBOX, "paper.pdf"), buildPdf([["page one"]]));
      const outcomes = await drainInbox(root);
      expect(outcomes[0]).toMatchObject({ ok: true, format: "pdf", removed: true });
      expect(readFileSync(join(root, "raw", "paper.pdf", "text.md"), "utf8")).toContain("## p1");
    });

    it("reports every file in a batch, in a stable order", async () => {
      writeFileSync(join(root, "raw", INBOX, "b.md"), "b");
      writeFileSync(join(root, "raw", INBOX, "a.md"), "a");
      writeFileSync(join(root, "raw", INBOX, "c.mp3"), "c");
      const outcomes = await drainInbox(root);
      expect(outcomes.map((o) => o.name)).toEqual(["a.md", "b.md", "c.mp3"]);
    });

    it("leaves a file it could not ingest where it is, with the reason", async () => {
      writeFileSync(join(root, "raw", INBOX, "clip.mp3"), "not a source");
      const outcomes = await drainInbox(root);

      expect(outcomes[0]!.ok).toBe(false);
      expect(outcomes[0]!.removed).toBe(false);
      // The user's file is the only copy of it; tidying the doorway must not
      // be a way to lose material.
      expect(existsSync(join(root, "raw", INBOX, "clip.mp3"))).toBe(true);
      expect((outcomes[0] as { reason: string }).reason).toContain(".mp3");
    });

    it("refuses to follow a symbolic link out of the project", async () => {
      const outside = join(root, "secret.md");
      writeFileSync(outside, "# not the agent's to publish\n");
      if (!trySymlink(outside, join(root, "raw", INBOX, "innocuous.md"))) return;

      const outcomes = await drainInbox(root);
      expect(outcomes[0]!.ok).toBe(false);
      expect((outcomes[0] as { reason: string }).reason).toContain("symbolic link");
      expect(listSources(root)).toEqual([]);
    });

    it("keeps draining the rest of the batch after a file it refused", async () => {
      // One bad entry ending the whole drain would mean a single dropped
      // symlink silently stops every later file from ever being ingested.
      if (!trySymlink(join(root, "raw"), join(root, "raw", INBOX, "a-link.md"))) return;
      writeFileSync(join(root, "raw", INBOX, "z-real.md"), "# Real\n");

      const outcomes = await drainInbox(root);
      expect(outcomes.map((o) => o.name)).toEqual(["a-link.md", "z-real.md"]);
      expect(outcomes[1]).toMatchObject({ ok: true, id: "z-real.md" });
    });

    it("refuses a directory rather than walking into it", async () => {
      mkdirSync(join(root, "raw", INBOX, "a-folder"));
      const outcomes = await drainInbox(root);
      expect(outcomes[0]!.ok).toBe(false);
      expect((outcomes[0] as { reason: string }).reason).toContain("directory");
    });

    it("is idempotent — a second drain sees only what the first could not take", async () => {
      writeFileSync(join(root, "raw", INBOX, "good.md"), "g");
      writeFileSync(join(root, "raw", INBOX, "bad.mp3"), "b");
      await drainInbox(root);

      const second = await drainInbox(root);
      expect(second.map((o) => o.name)).toEqual(["bad.mp3"]);
    });

    it("refuses an oversized file on its stat, without reading it", async () => {
      // A file too large to hold in memory must not be read into memory to
      // discover that it is too large.
      const big = join(root, "raw", INBOX, "huge.pdf");
      writeFileSync(big, Buffer.alloc(1));
      truncateSync(big, MAX_SOURCE_BYTES + 1);

      const outcomes = await drainInbox(root);
      expect(outcomes[0]!.ok).toBe(false);
      expect((outcomes[0] as { reason: string }).reason).toMatch(/over the \d+-byte limit/);
      expect(existsSync(big)).toBe(true);
    });

    it("returns nothing when there is no inbox at all", async () => {
      rmSync(join(root, "raw", INBOX), { recursive: true, force: true });
      expect(await drainInbox(root)).toEqual([]);
    });

    it("does not make the inbox itself a source", async () => {
      writeFileSync(join(root, "raw", INBOX, "x.md"), "x");
      await drainInbox(root);
      // Nothing enumerates the doorway, so it never appears as something to
      // cite or as an uncited source.
      expect(listSources(root)).toEqual(["x.md"]);
    });
  });

  describe("watchInbox", () => {
    // These wait on real filesystem events, not on a fake clock.
    const WATCH_TIMEOUT = 20_000;

    /** Start a watcher with short timings, collecting outcomes and errors. */
    async function start(project = root) {
      const seen: InboxOutcome[] = [];
      const errors: Error[] = [];
      const watcher = await watchInbox(
        project,
        { onOutcome: (o) => seen.push(o), onError: (e) => errors.push(e) },
        { stabilityThreshold: 150, pollInterval: 25 },
      );
      return { seen, errors, watcher };
    }

    it("ingests a file that lands after the watch started", async () => {
      const { seen, watcher } = await start();
      try {
        writeFileSync(join(root, "raw", INBOX, "late.md"), "# Late\n");
        await until(() => seen.length > 0);
        expect(seen[0]).toMatchObject({ ok: true, id: "late.md" });
        expect(existsSync(join(root, "raw", "late.md", "text.md"))).toBe(true);
      } finally {
        await watcher.close();
      }
    });

    it("picks up what was already sitting there when it started", async () => {
      writeFileSync(join(root, "raw", INBOX, "early.md"), "# Early\n");
      const { seen, watcher } = await start();
      try {
        await until(() => seen.length > 0);
        expect(seen[0]).toMatchObject({ ok: true, id: "early.md" });
      } finally {
        await watcher.close();
      }
    });

    it(
      "does not ingest a file that is still being written",
      { timeout: WATCH_TIMEOUT },
      async () => {
        // The stability threshold holds back the event for the file being
        // copied — but only for *that* file. Draining the whole directory on
        // another file's event reads this one mid-copy, freezes half of it as an
        // immutable source, and deletes the user's only copy.
        const { seen, watcher } = await start();
        const partial = join(root, "raw", INBOX, "big.md");
        const fd = openSync(partial, "w");
        let copying = true;
        // A real copy keeps growing, which is exactly what stops the watcher
        // calling it finished. Simulate that rather than writing once and hoping
        // the threshold has not elapsed.
        const grow = setInterval(() => {
          if (copying) writeSync(fd, "chunk\n");
        }, 40);

        try {
          // A second file finishes copying and fires its own event.
          writeFileSync(join(root, "raw", INBOX, "small.md"), "# Small\n");
          await until(() => seen.some((o) => o.name === "small.md"), 8000);

          // The file still being written must not have been touched.
          expect(listSources(root)).toEqual(["small.md"]);
          expect(existsSync(partial)).toBe(true);
          expect(seen.some((o) => o.name === "big.md")).toBe(false);

          copying = false;
          clearInterval(grow);
          writeSync(fd, "last\n");
          closeSync(fd);

          await until(() => seen.some((o) => o.name === "big.md"), 8000);
          const text = readFileSync(join(root, "raw", "big.md", "text.md"), "utf8");
          expect(text.endsWith("last\n")).toBe(true);
        } finally {
          copying = false;
          clearInterval(grow);
          try {
            closeSync(fd);
          } catch {
            // already closed on the happy path
          }
          await watcher.close();
        }
      },
    );

    it(
      "serialises overlapping drains, so nothing loses a race to itself",
      { timeout: WATCH_TIMEOUT },
      async () => {
        // Asserting only on the successes cannot fail: the loser of a race comes
        // back as a refusal (TakenIdError, or ENOENT on a file the winner already
        // removed) and is simply filtered out. The refusals are the evidence.
        writeFileSync(join(root, "raw", INBOX, "a.md"), "a");
        writeFileSync(join(root, "raw", INBOX, "b.md"), "b");
        writeFileSync(join(root, "raw", INBOX, "c.md"), "c");

        const { seen, watcher } = await start();
        try {
          const batches = await Promise.all([
            watcher.drain(),
            watcher.drain(),
            watcher.drain(),
            watcher.drain(),
          ]);
          const all = [...batches.flat(), ...seen];
          expect(all.filter((o) => !o.ok)).toEqual([]);
          expect(listSources(root).sort()).toEqual(["a.md", "b.md", "c.md"]);
        } finally {
          await watcher.close();
        }
      },
    );

    it("reports a file it cannot ingest once, not on every later event", async () => {
      writeFileSync(join(root, "raw", INBOX, "clip.mp3"), "x");
      const { seen, watcher } = await start();
      try {
        await until(() => seen.length > 0);
        // The refused file stays in the doorway, so every later drain sees it
        // again; the caller is a UI and must not be told twice.
        await watcher.drain();
        await watcher.drain();
        expect(seen.filter((o) => o.name === "clip.mp3")).toHaveLength(1);
      } finally {
        await watcher.close();
      }
    });

    it(
      "reports a refused name again once that file has left and come back",
      { timeout: WATCH_TIMEOUT },
      async () => {
        // Silence is how success looks here. Remembering the name forever means a
        // second, different file dropped under a name that once failed is never
        // mentioned, and the user believes it landed.
        writeFileSync(join(root, "raw", INBOX, "clip.mp3"), "x");
        const { seen, watcher } = await start();
        try {
          await until(() => seen.length > 0);
          rmSync(join(root, "raw", INBOX, "clip.mp3"));

          writeFileSync(join(root, "raw", INBOX, "clip.mp3"), "a different recording");
          await until(() => seen.filter((o) => o.name === "clip.mp3").length === 2, 8000);
        } finally {
          await watcher.close();
        }
      },
    );

    it("surfaces a failure of the doorway itself rather than going quiet", async () => {
      const { watcher } = await start();
      try {
        // Replace raw/ with a link out of the project: the inbox no longer
        // resolves inside it, and an explicit drain has to say so.
        try {
          rmSync(join(root, "raw"), { recursive: true, force: true });
        } catch (err) {
          // Windows refuses to delete a directory that is being watched. That
          // is the platform, not the behaviour under test — but only for the
          // codes that actually mean it.
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY") return;
          throw err;
        }
        const elsewhere = mkdtempSync(join(tmpdir(), "ow-elsewhere-"));
        try {
          if (!trySymlink(elsewhere, join(root, "raw"))) return;
          await expect(watcher.drain()).rejects.toThrow(/outside the project/);
        } finally {
          rmSync(elsewhere, { recursive: true, force: true });
        }
      } finally {
        await watcher.close();
      }
    });

    it("stops ingesting once closed", async () => {
      const { seen, watcher } = await start();
      await watcher.close();
      writeFileSync(join(root, "raw", INBOX, "after.md"), "a");
      await new Promise((r) => setTimeout(r, 400));
      expect(seen).toHaveLength(0);
      expect(existsSync(join(root, "raw", INBOX, "after.md"))).toBe(true);
    });
  });
});
