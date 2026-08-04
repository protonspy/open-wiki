import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STEPS, stepClass, stepNumber } from "../src/renderer/first-run.js";
import { relocateProject, type RelocateBridge } from "../src/renderer/open-existing.js";

/**
 * Empty states, and the space around them (`plans/desktop-ui-uxpass.md`,
 * group 8).
 *
 * Every empty state in the application was one grey sentence pinned to the
 * top-left of an otherwise empty pane, and the two screens somebody meets first
 * put a ~500px column against the top of a 1280×800 window and left 380px below
 * it.
 */

function source(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/renderer/${name}`, import.meta.url)), "utf8");
}

const css = source("globals.css").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the empty states (8.1)", () => {
  it("are one block, built once", () => {
    // Three panes said three unrelated grey sentences. `ui/Empty` is the shape
    // `EmptyWiki`'s doorway already proved on the one screen somebody bothered.
    for (const [file, marker] of [
      ["App.tsx", 'title="Nothing open"'],
      ["Chat.tsx", 'title="The agent, in this window"'],
      ["ChecksPane.tsx", 'title="Nothing to fix"'],
    ] as const) {
      expect({ file, has: source(file).includes(marker) }).toEqual({ file, has: true });
    }
  });

  it("say what the pane is for, rather than reporting the state", () => {
    expect(source("App.tsx")).toContain("This is the wiki");
    expect(source("Chat.tsx")).toContain("pausing for your approval on every write");
    expect(source("ChecksPane.tsx")).toContain("passed on this project");
  });

  it("offer the first thing to do", () => {
    // The wiki's is a page; the chat pane's is what asking actually looks like,
    // which is worth more than a button that focuses a box already in reach.
    expect(source("App.tsx")).toMatch(/<Empty[\s\S]*?action=\{[\s\S]*?New page/);
    expect(source("Chat.tsx")).toContain("empty-state__examples");
  });

  it("are centred in the pane, and left-aligned inside themselves", () => {
    // Centred prose is harder to read at every line length, and this is prose.
    const rule = /\.empty-state\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/align-content:\s*safe center/);
    expect(rule).toMatch(/justify-items:\s*start/);
    expect(rule).toMatch(/max-width:\s*\d+ch/);
  });

  it("start at the top when they are taller than the pane", () => {
    // `safe`, or the first line of a long block is pushed off the edge on a
    // short window — which is the 480px the application permits.
    expect(css).toMatch(/\.empty-state\s*\{[^}]*align-content:\s*safe center/);
  });
});

describe("the launcher and the first run, in the window (8.2)", () => {
  it("are centred rather than pinned to the top", () => {
    for (const selector of ["\\.launcher", "\\.first-run"]) {
      const rule = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
      expect({ selector, rule }).toMatchObject({
        rule: expect.stringMatching(/align-content:\s*safe center/) as unknown as string,
      });
      expect(rule).toMatch(/min-height:\s*100%/);
    }
  });

  it("give the first run the width its longest value needs", () => {
    // It holds an absolute path (8.6), and 62ch wrapped it.
    expect(css).toMatch(/\.first-run\s*\{[^}]*max-width:\s*72ch/);
  });
});

describe("the launcher's cache note (8.3)", () => {
  const launcher = source("Launcher.tsx");

  it("is shown only where there is a list to explain", () => {
    // It appeared on the empty screen too, explaining the behaviour of rows
    // that could not exist.
    expect(launcher).toMatch(
      /\{projects && projects\.length > 0 \? \(\s*<p className="launcher__foot">\s*This list is a cache/,
    );
  });

  it("keeps the sentence that is true either way", () => {
    expect(launcher).toContain("Running <code>ow</code> inside a project opens it too");
  });
});

describe("relocateProject (8.4)", () => {
  /** A bridge that records what it was asked, in order. */
  function bridge(chosen: string | null, project: boolean): RelocateBridge & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      chooseDirectory: () => {
        calls.push("choose");
        return Promise.resolve(chosen);
      },
      forgetProject: (name) => {
        calls.push(`forget ${name}`);
        return Promise.resolve();
      },
      openDirectory: (directory) => {
        calls.push(`open ${directory}`);
        return Promise.resolve(
          project
            ? {
                kind: "adopted" as const,
                project: { name: "fenix", path: directory, present: true },
              }
            : { kind: "not-a-project" as const, directory },
        );
      },
    };
  }

  it("points the registry at where the project actually is", () => {
    return expect(relocateProject(bridge("D:/moved/fenix", true), "fenix")).resolves.toEqual({
      kind: "relocated",
      name: "fenix",
    });
  });

  it("drops the stale entry before taking the directory on", async () => {
    // `adoptProject` derives a *free* name, and the entry that moved is holding
    // the one this project is called: adopting first registers it as `fenix-2`
    // beside a `fenix` that points at nothing.
    const ow = bridge("D:/moved/fenix", true);
    await relocateProject(ow, "fenix");
    expect(ow.calls).toEqual(["choose", "forget fenix", "open D:/moved/fenix"]);
  });

  it("forgets nothing when the chooser is dismissed", async () => {
    // The most ordinary thing anybody does with a chooser.
    const ow = bridge(null, true);
    await expect(relocateProject(ow, "fenix")).resolves.toEqual({ kind: "cancelled" });
    expect(ow.calls).toEqual(["choose"]);
  });

  it("offers to make one there when the directory is not a project", () => {
    // The same second answer **Open project…** gives, because it is the same
    // act seen from the other end.
    return expect(relocateProject(bridge("D:/empty", false), "fenix")).resolves.toEqual({
      kind: "not-a-project",
      directory: "D:/empty",
    });
  });

  it("is what the row offers in place of Open", () => {
    const launcher = source("Launcher.tsx");
    expect(launcher).toContain("Locate…");
    expect(launcher).toMatch(/project\.present \? \([\s\S]{0,200}Open/);
  });
});

describe("a code span and the punctuation after it (8.5)", () => {
  it("does not put a space where the type does not", () => {
    // 4px of tint on each side reads as a space: *"the same way `code` ."*
    const rule = /\.page code\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/margin:\s*0 -0\.\d+em/);
    expect(rule).toMatch(/box-decoration-break:\s*clone/);
  });

  it("no longer doubles the ellipsis in the first run's help", () => {
    // It ended *"…or use Choose…."* — the label's own ellipsis and a full stop.
    const firstRun = source("FirstRun.tsx");
    expect(firstRun).not.toContain("Choose….");
    expect(firstRun).toContain("or pick one with the Choose button");
  });
});

describe("stepClass — the first run's stepper (8.6)", () => {
  it("marks what is behind, what is here, and what is left", () => {
    expect(stepClass(0, 2)).toBe("stepper__step stepper__step--done");
    expect(stepClass(2, 2)).toBe("stepper__step stepper__step--here");
    expect(stepClass(3, 2)).toBe("stepper__step");
  });

  it("has a short name for every step", () => {
    // On the step rather than in a lookup beside the component, so a step added
    // later cannot arrive without one.
    for (const step of STEPS) {
      expect({ id: step.id, short: step.short }).toMatchObject({
        short: expect.stringMatching(/^\S/) as unknown as string,
      });
      expect(step.short.length).toBeLessThan(15);
    }
  });

  it("is drawn as an ordered list, with the current step named as one", () => {
    const firstRun = source("FirstRun.tsx");
    expect(firstRun).toContain('<ol className="stepper">');
    expect(firstRun).toContain('aria-current={entry.id === step ? "step" : undefined}');
    expect(firstRun).toContain("className={stepClass(i, stepNumber(step) - 1)}");
  });

  it("still agrees with `stepNumber`, which is 1-based for a reader", () => {
    expect(stepClass(stepNumber("project") - 1, stepNumber("project") - 1)).toContain("--here");
    expect(stepClass(stepNumber("project") - 1, stepNumber("language") - 1)).toContain("--done");
  });

  it("does not carry the state in colour alone", () => {
    expect(css).toMatch(/\.stepper__step--here\s*\{[^}]*font-weight:\s*600/);
    expect(css).toMatch(/\.stepper__step--done \.stepper__dot\s*\{[^}]*background:/);
  });

  it("gives the directory field the room the path needs", () => {
    // The box was sized by the browser's default and held an absolute path.
    expect(css).toMatch(/\.field__row \.input\s*\{[^}]*flex:\s*1/);
  });
});
