import {
  defaultExportPath,
  exportProject,
  surveyProject,
  type ExportResult,
} from "@open-wiki/access";

export { defaultExportPath };

/**
 * Exporting the project as one zip, from the window — `specs/wiki-export`, R4.3.
 *
 * The archive itself is `@open-wiki/access`'s, unchanged; this is the save
 * dialog around it and nothing more. One implementation, two doors (R4.1), the
 * same shape `ow export` uses on the other side.
 *
 * **The dialog is injected.** CI has no display, so a module that reached for
 * Electron's `dialog` directly could not be tested at all — which is the rule
 * plan task 8.2 set for this whole process: "each is a module beside it that a
 * test calls without starting a window."
 */

/** What Electron's `dialog.showSaveDialog` gives back, narrowed to what is used. */
export interface SaveDialog {
  (options: {
    title: string;
    defaultPath: string;
    filters: Array<{ name: string; extensions: string[] }>;
  }): Promise<{ canceled: boolean; filePath?: string }>;
}

export type ExportOutcome =
  | { ok: true; canceled: true }
  | { ok: true; canceled: false; files: number; bytes: number; path: string }
  | { ok: false; reason: string };

/** What an export would carry, for the sentence shown before one is offered. */
export function exportSurvey(projectRoot: string): ExportResult {
  return surveyProject(projectRoot);
}

/**
 * Ask where to put it, then write it.
 *
 * A cancelled dialog is `ok: true, canceled: true` rather than an error: the
 * user closing a save dialog is the feature working, and a renderer that had to
 * tell "cancelled" apart from "failed" by reading a message would eventually
 * get it wrong.
 */
export async function runExport(
  projectRoot: string,
  today: string,
  showSaveDialog: SaveDialog,
): Promise<ExportOutcome> {
  const chosen = await showSaveDialog({
    title: "Export the wiki and its sources",
    defaultPath: defaultExportPath(projectRoot, today),
    filters: [{ name: "Zip archive", extensions: ["zip"] }],
  });
  if (chosen.canceled || !chosen.filePath) return { ok: true, canceled: true };

  try {
    const written = await exportProject(projectRoot, chosen.filePath);
    return {
      ok: true,
      canceled: false,
      files: written.files,
      bytes: written.bytes,
      path: written.path!,
    };
  } catch (err) {
    // The store's refusals already say what to do about themselves, and 9.13
    // says the message has to read the same wherever it surfaced. So it is
    // shown verbatim rather than replaced with something this window invented.
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
