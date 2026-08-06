import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PANES } from "../src/renderer/Rail.js";
import {
  agentSection,
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "../src/renderer/settings-sections.js";

/**
 * The settings as a pane, in tabbed sections
 * (`plans/settings-pane-and-export`, group 1).
 *
 * There is no DOM in this suite by design — every decision a component would
 * otherwise bury is a function, which is the shape `wiki-pane.spec.ts` and
 * `ui.spec.ts` already use. What cannot be a function is the wiring, and that is
 * asserted against the source as it ships, the way `design-system.spec.ts` does.
 */

const RENDERER = new URL("../src/renderer/", import.meta.url);

/** A screen with its prose removed — a comment naming a thing is not the thing. */
function source(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, RENDERER)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("SETTINGS_SECTIONS (1.3)", () => {
  it("divides the page into the four questions somebody arrives with", () => {
    expect(SETTINGS_SECTIONS.map((entry) => entry.id)).toEqual([
      "project",
      "transcription",
      "agent",
      "files",
    ]);
  });

  it("gives every section a distinct id, because the id is the tab's element id", () => {
    const ids = SETTINGS_SECTIONS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("labels every one of them, since the tab strip is nothing but labels", () => {
    for (const entry of SETTINGS_SECTIONS) expect(entry.label.trim()).not.toBe("");
  });

  it("opens on the project's own settings rather than on the credential", () => {
    // What the page is *about* is this project. The key is the thing you come
    // back to occasionally, and it is one tab away.
    expect(SETTINGS_SECTIONS[0]?.id).toBe("project" satisfies SettingsSectionId);
  });
});

/**
 * The agent section could be absent and cannot now.
 *
 * Inside the sheet it was `credential?.provider === "groq" && agent &&
 * agent.models.length > 0 ? … : null` — a missing block in a scroll, which reads
 * as "nothing to configure here". A tab that appears once a key is saved is a
 * tab nobody knows to wait for; one that disappears is a control somebody
 * remembers using and cannot find.
 */
describe("agentSection (1.3)", () => {
  it("says there is no credential when none is stored", () => {
    expect(agentSection({ provider: null, hasKey: false }, null)).toEqual({
      state: "no-credential",
    });
  });

  it("reads a missing answer the same way, because it is the same sentence", () => {
    // `credential` is null until the bridge answers. Both lead to *save a Groq
    // key and this fills in*, so inventing a fourth state would say nothing new.
    expect(agentSection(null, { models: ["a"], selectedModel: "a" })).toEqual({
      state: "no-credential",
    });
  });

  it("says whisper.cpp runs no agent, rather than showing an empty list", () => {
    // R2.4 — one key, two jobs. Opting out of the third party opts out of both,
    // and the Chat pane is disabled while it is chosen.
    expect(agentSection({ provider: "whispercpp", hasKey: false }, null)).toEqual({
      state: "not-groq",
    });
  });

  it("tells a stored key with no models apart from no key at all", () => {
    // Different problem, different fix: this one is *check the key again*, and
    // reporting it as "no credential" would send somebody to paste a key they
    // have already pasted.
    expect(
      agentSection({ provider: "groq", hasKey: true }, { models: [], selectedModel: "" }),
    ).toEqual({ state: "no-models" });
    expect(agentSection({ provider: "groq", hasKey: true }, null)).toEqual({ state: "no-models" });
  });

  it("hands over the list and the choice when there is one", () => {
    expect(
      agentSection({ provider: "groq", hasKey: true }, { models: ["a", "b"], selectedModel: "b" }),
    ).toEqual({ state: "ready", models: ["a", "b"], selected: "b" });
  });
});

describe("the settings as they ship (1.1, 1.2, 1.3)", () => {
  it("is a pane in the rail, and the last one", () => {
    expect(PANES.map((entry) => entry.pane)).toContain("settings");
    expect(PANES[PANES.length - 1]?.pane).toBe("settings");
  });

  it("draws that pane at the foot, apart from the four about the project", () => {
    // The separation every rail makes: what the project holds, and how the
    // application is set up. It is still a tab, so the arrows still reach it.
    expect(PANES.find((entry) => entry.pane === "settings")?.foot).toBe(true);
    expect(PANES.filter((entry) => entry.foot).map((entry) => entry.pane)).toEqual(["settings"]);
  });

  it("is not an overlay any more — nothing opens it as a sheet", () => {
    // The failure this catches: the pane lands, the sheet is left behind it, and
    // two settings screens exist with one of them unreachable except by a gear
    // nobody rewired.
    const app = source("App.tsx");
    expect(app).not.toContain('kind: "settings"');
    expect(app).not.toContain('<Sheet title="Settings"');
    expect(app).toContain('location.pane === "settings"');
  });

  it("took the sheet primitive with it, since the settings were the only sheet", () => {
    // uxpass 7.6's rule, applied to the component this change orphaned: a
    // primitive nothing renders is one nobody maintains and everybody reads
    // past — and a 560px width that nothing is ever that wide is the same drift
    // in the stylesheet.
    expect(existsSync(fileURLToPath(new URL("ui/Sheet.tsx", RENDERER)))).toBe(false);
    const css = readFileSync(fileURLToPath(new URL("globals.css", RENDERER)), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(css).not.toMatch(/^\.sheet\b/m);
  });

  it("frames itself like every other pane, with a bar over a body", () => {
    // A window whose panes are 38px in four places and something else in the
    // fifth is a window that stops reading as one window.
    const settings = source("Settings.tsx");
    expect(settings).toContain("<PaneBar");
    expect(source("App.tsx")).toContain('"settings",');
  });

  it("switches sections with a real tablist rather than four headings", () => {
    const settings = source("Settings.tsx");
    expect(settings).toContain('role="tablist"');
    expect(settings).toContain('role="tab"');
    expect(settings).toContain('role="tabpanel"');
    // The roving stop: one tab stop for the strip, arrows within it.
    expect(settings).toContain("tabIndex={id === section ? 0 : -1}");
  });

  it("keeps the key write-only, which is the rule the move must not have cost", () => {
    // The renderer has no business holding the application's one secret, and a
    // field pre-filled with it would put it in the DOM of a window that renders
    // markdown an agent wrote.
    expect(source("Settings.tsx")).toContain('type="password"');
    expect(source("Settings.tsx")).toContain('setKey("")');
  });
});

describe("the export, where it went (2.2)", () => {
  it("is gone from the settings page", () => {
    // It is not a setting: it acts on the wiki, like creating a page. Leaving a
    // copy here would be two buttons for one act, which is how one of them goes
    // stale.
    const settings = source("Settings.tsx");
    expect(settings).not.toContain("exportSurvey");
    expect(settings).not.toContain("exportRun");
  });

  it("sits in the wiki pane's bar, beside New page", () => {
    const pane = source("WikiPane.tsx");
    expect(pane).toContain("onExport");
    // Beside it, not instead of it — and quieter, because a pane gets one
    // primary action and writing a page is it.
    expect(pane).toContain("New page");
    expect(pane).toMatch(/onClick=\{onExport\}[\s\S]{0,80}variant="ghost"/);
  });

  it("is disabled while the editor is open, as the page actions are", () => {
    // The archive is written from what is on disk, which is not what is on
    // screen while there is an unsaved buffer.
    expect(source("WikiPane.tsx")).toMatch(/onClick=\{onExport\}[\s\S]{0,120}disabled=\{editing\}/);
  });
});

describe("the rail's language chip after a language change", () => {
  // No DOM in this suite, so the wiring is asserted against the source. The bug
  // was that the chip reads `project.language`, the project is loaded once on
  // mount, and `changeLanguage` refreshed only the settings view — so the chip
  // (and the document's `lang`) kept the old language until the window reopened.
  it("App re-loads the project and hands it to Settings", () => {
    const app = source("App.tsx");
    // A callback that re-fetches the project, not just the settings view.
    expect(app).toContain("const refreshProject = useCallback(async () => {");
    expect(app).toContain("setProject(await bridge().project())");
    // Passed to the settings pane, which fires it after a change.
    expect(app).toContain("<Settings onProjectChanged={refreshProject} />");
  });

  it("Settings fires the callback after writing the new language", () => {
    const settings = source("Settings.tsx");
    expect(settings).toContain("onProjectChanged");
    // `setLanguage` before `onProjectChanged`, inside `changeLanguage` — the
    // project is re-loaded only after the new value has been written.
    expect(settings).toMatch(/bridge\(\)\.setLanguage[\s\S]*?onProjectChanged\?\.\(\)/);
  });
});
