import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { defaultExportPath, exportSurvey, runExport, type SaveDialog } from "../src/main/export.js";

/**
 * The desktop's export door (`specs/wiki-export`, R4.3, task 2.2).
 *
 * The save dialog is injected, so all of this runs without a display — which is
 * the rule plan 8.2 set for the whole main process and the only reason CI can
 * check any of it.
 */

const DATE = "2026-08-02";

let root: string;
let outside: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "ow-dexp-")));
  outside = realpathSync(mkdtempSync(join(tmpdir(), "ow-dout-")));
  mkdirSync(join(root, "wiki"), { recursive: true });
  mkdirSync(join(root, "raw", "notes.md"), { recursive: true });
  writeFileSync(join(root, "wiki", "index.md"), "# Index\n", "utf8");
  writeFileSync(join(root, "raw", "notes.md", "manifest.json"), "{}", "utf8");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

/** A dialog that answers with a fixed path, and records that it was asked. */
function dialogAnswering(filePath: string | null): SaveDialog & { asked: unknown[] } {
  const asked: unknown[] = [];
  const fn = (options: Parameters<SaveDialog>[0]): ReturnType<SaveDialog> => {
    asked.push(options);
    return Promise.resolve(filePath === null ? { canceled: true } : { canceled: false, filePath });
  };
  return Object.assign(fn, { asked });
}

describe("defaultExportPath", () => {
  it("offers a name beside the project, never inside it", () => {
    // Inside is refused by the store (R3.1), so a default that landed there
    // would be a dialog whose pre-filled answer is rejected on Save.
    const path = defaultExportPath(root, DATE);
    expect(relative(root, path).startsWith("..")).toBe(true);
    expect(dirname(path)).toBe(dirname(root));
    expect(basename(path)).toBe(`${basename(root)}-wiki-${DATE}.zip`);
  });
});

describe("exportSurvey", () => {
  it("counts what an export would carry, without writing one", () => {
    const survey = exportSurvey(root);
    expect(survey.files).toBe(2);
    expect(survey.path).toBeUndefined();
  });
});

describe("runExport", () => {
  it("asks where to put it, with the default name and a zip filter", async () => {
    const dialog = dialogAnswering(join(outside, "chosen.zip"));
    await runExport(root, DATE, dialog);
    expect(dialog.asked).toHaveLength(1);
    const options = dialog.asked[0] as {
      defaultPath: string;
      filters: Array<{ extensions: string[] }>;
    };
    expect(options.defaultPath).toBe(defaultExportPath(root, DATE));
    expect(options.filters[0]?.extensions).toEqual(["zip"]);
  });

  it("writes the archive where the dialog said, and reports it", async () => {
    const chosen = join(outside, "chosen.zip");
    const outcome = await runExport(root, DATE, dialogAnswering(chosen));
    expect(outcome).toMatchObject({ ok: true, canceled: false, files: 2, path: chosen });
    expect(existsSync(chosen)).toBe(true);
  });

  it("treats a cancelled dialog as success, not as an error", async () => {
    // Closing a save dialog is the feature working. A renderer that had to tell
    // "cancelled" from "failed" by reading a message would get it wrong.
    const outcome = await runExport(root, DATE, dialogAnswering(null));
    expect(outcome).toEqual({ ok: true, canceled: true });
  });

  it("writes nothing when the dialog was cancelled", async () => {
    await runExport(root, DATE, dialogAnswering(null));
    expect(existsSync(join(outside, "chosen.zip"))).toBe(false);
  });

  it("returns the store's refusal verbatim rather than inventing one", async () => {
    // 9.13 — the message has to read the same wherever it surfaced.
    const outcome = await runExport(root, DATE, dialogAnswering(join(root, "wiki", "self.zip")));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.reason).toContain("inside the project");
  });

  it("refuses to overwrite a file the dialog named, rather than replacing it", async () => {
    // The system dialog asks its own "replace?" question, but the answer it
    // collects never reaches the store — so the store's refusal is what stands,
    // and it must not be the thing that silently destroys a file.
    const chosen = join(outside, "chosen.zip");
    writeFileSync(chosen, "something else entirely", "utf8");
    const outcome = await runExport(root, DATE, dialogAnswering(chosen));
    expect(outcome.ok).toBe(false);
  });
});
