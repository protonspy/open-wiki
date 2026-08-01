import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  CHECK_FAILED_TO_RUN,
  CHECK_FOUND,
  CHECK_OK,
  parseCheckArgs,
  runCheck,
} from "../src/commands/check.js";
import { main } from "../src/main.js";

function tempProject(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ow-cli-check-")));
  mkdirSync(join(root, "wiki"), { recursive: true });
  mkdirSync(join(root, "raw"), { recursive: true });
  writeFileSync(join(root, "wiki", "index.md"), "# Index\n", "utf8");
  writeFileSync(join(root, "wiki", "changelog.md"), "# Changelog\n", "utf8");
  return root;
}

function page(root: string, relPath: string, body = ""): void {
  const slug = relPath.split("/").pop()!.replace(/\.md$/, "");
  const file = join(root, "wiki", relPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `---\nid: topic:${slug}\ntype: topic\ntitle: ${slug}\nstatus: active\naliases: []\n` +
      `updated: 2026-08-01\nsources: []\nsuperseded-by: ""\n---\n${body}`,
    "utf8",
  );
}

function clean(root: string): void {
  page(root, "fenix.md");
  writeFileSync(join(root, "wiki", "index.md"), "# Index\n\n- [[fenix]]\n", "utf8");
  writeFileSync(
    join(root, "wiki", "changelog.md"),
    "# Changelog\n\n## 2026-08-01\n\n- Created [[fenix]].\n",
    "utf8",
  );
}

describe("ow check (7.7)", () => {
  let root: string;
  beforeEach(() => (root = tempProject()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  describe("parseCheckArgs", () => {
    it("reports warnings by default", () => {
      // A source nobody cites is precisely the thing that disappears on its
      // own; hiding it behind a flag would defeat the check.
      expect(parseCheckArgs([])).toEqual({ json: false, warnings: true });
    });

    it("takes --json and --errors-only", () => {
      expect(parseCheckArgs(["--json"]).json).toBe(true);
      expect(parseCheckArgs(["--errors-only"]).warnings).toBe(false);
    });
  });

  describe("runCheck", () => {
    it("exits 0 and says so when there is nothing wrong", () => {
      clean(root);
      const { stdout, code } = runCheck(root, { json: false, warnings: true });
      expect(code).toBe(CHECK_OK);
      expect(stdout).toContain("no findings");
    });

    it("exits 2 when it found an error", () => {
      page(root, "fenix.md", "See [[nowhere]].");
      const { stdout, code } = runCheck(root, { json: false, warnings: true });
      expect(code).toBe(CHECK_FOUND);
      expect(stdout).toContain("wikilink.broken");
    });

    it("prints the correction path for every finding", () => {
      page(root, "fenix.md", "See [[nowhere]].");
      const { stdout } = runCheck(root, { json: false, warnings: true });
      // A refusal a reader cannot act on becomes an attempt they repeat.
      expect(stdout).toContain("fix:");
    });

    it("stays green on warnings alone, so an unused source does not fail CI", () => {
      clean(root);
      const dir = join(root, "raw", "unused.md");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "manifest.json"),
        JSON.stringify({ id: "unused.md", title: "Unused", kind: "file", original: "unused.md" }),
        "utf8",
      );

      const { stdout, code } = runCheck(root, { json: false, warnings: true });
      expect(stdout).toContain("source.uncited");
      expect(code).toBe(CHECK_OK);
    });

    it("drops warnings under --errors-only", () => {
      clean(root);
      const dir = join(root, "raw", "unused.md");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "manifest.json"),
        JSON.stringify({ id: "unused.md", title: "Unused", kind: "file", original: "unused.md" }),
        "utf8",
      );

      const { stdout } = runCheck(root, { json: false, warnings: false });
      expect(stdout).not.toContain("source.uncited");
    });

    it("prints JSON a harness can read", () => {
      page(root, "fenix.md", "See [[nowhere]].");
      const { stdout } = runCheck(root, { json: true, warnings: true });
      const parsed = JSON.parse(stdout);
      expect(Array.isArray(parsed.findings)).toBe(true);
      expect(parsed.findings[0]).toHaveProperty("code");
      expect(parsed.findings[0]).toHaveProperty("fix");
      expect(parsed.pages).toBe(1);
    });
  });

  describe("through the dispatch", () => {
    it("runs as `ow check` and returns its exit code", async () => {
      const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      try {
        page(root, "fenix.md", "See [[nowhere]].");
        expect(await main(["check"], root)).toBe(CHECK_FOUND);
        expect(write.mock.calls.join("")).toContain("wikilink.broken");
      } finally {
        write.mockRestore();
      }
    });

    it("returns 0 on a clean project", async () => {
      const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      try {
        clean(root);
        expect(await main(["check"], root)).toBe(CHECK_OK);
      } finally {
        write.mockRestore();
      }
    });

    it("returns 1, not 2, when the check could not run at all", async () => {
      // A CI job acts on the difference: 2 is "fix your wiki", 1 is "the check
      // itself is broken". Collapsing them sends people to the wrong place.
      const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      try {
        // `wiki/` replaced by a file: the walk cannot run.
        rmSync(join(root, "wiki"), { recursive: true, force: true });
        writeFileSync(join(root, "wiki"), "not a directory", "utf8");

        expect(await main(["check"], root)).toBe(CHECK_FAILED_TO_RUN);
        expect(err.mock.calls.join("")).toContain("could not run");
      } finally {
        write.mockRestore();
        err.mockRestore();
      }
    });

    it("is listed in the usage text", async () => {
      const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      try {
        await main(["help"], root);
        expect(write.mock.calls.join("")).toContain("ow check");
      } finally {
        write.mockRestore();
      }
    });
  });
});
