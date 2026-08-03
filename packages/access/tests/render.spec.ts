import { describe, expect, it } from "vitest";
import { HARNESSES, profileFor, profilesFor, type Harness } from "../src/harness.js";
import {
  GATES_INSTALLED,
  renderConvention,
  renderEntryFiles,
  renderSkills,
} from "../src/render.js";

/**
 * 2.2, written before the renderer existed and watched fail.
 *
 * The failure this guards is the one that ships quietly: a skill telling a
 * Codex user to look in `.claude/` is wrong in a way nothing errors on. Nobody
 * gets a stack trace, the file is valid markdown, and the user simply never
 * finds the convention — which is the exact bug this whole plan exists to end,
 * reproduced one level up.
 *
 * So the central assertion is negative and exhaustive: for every harness, for
 * every file rendered for it, no other harness's directory appears anywhere in
 * the bytes.
 */

/** The directory that belongs to each harness and to no other. */
const OWN: Record<Harness, string> = {
  claude: ".claude/",
  codex: ".codex/",
  opencode: ".opencode/",
};

/** Every rendered file for one harness, as `path -> content`. */
function renderedFor(h: Harness): Record<string, string> {
  return renderConvention([h]);
}

/**
 * Every non-empty combination of harnesses a project can be scaffolded for.
 *
 * The single-harness loop below is the obvious reading of "no rendered file for
 * one harness names another's directory", and it is not enough on its own:
 * `renderEntryFiles` renders a *different* file for a multi-harness set — the
 * `AGENTS.md` shared by Codex and opencode, the `CLAUDE.md` that becomes a
 * pointer — so a path that only appears in combination is never reached by it.
 * The property is about what any given harness is told, so it has to hold over
 * every set a user can actually ask for.
 */
function subsets(): Harness[][] {
  const all: Harness[][] = [];
  for (let mask = 1; mask < 1 << HARNESSES.length; mask++) {
    all.push(HARNESSES.filter((_, i) => mask & (1 << i)));
  }
  return all;
}

describe("no rendered file for one harness names another's directory (2.2)", () => {
  for (const h of HARNESSES) {
    it(`renders nothing for ${h} that names another harness's directory`, () => {
      const foreign = HARNESSES.filter((o) => o !== h).map((o) => OWN[o]);
      const files = renderedFor(h);
      expect(Object.keys(files).length).toBeGreaterThan(0);
      for (const [path, content] of Object.entries(files)) {
        for (const dir of foreign) {
          expect(path, `${h}: the path ${path} names ${dir}`).not.toContain(dir);
          expect(content, `${h}: ${path} names ${dir} in its text`).not.toContain(dir);
        }
      }
    });
  }

  it("holds for every combination a project can be scaffolded for", () => {
    // The general property, over all 7 non-empty subsets. A file rendered only
    // in combination — the shared AGENTS.md, the CLAUDE.md pointer — is never
    // reached by the single-harness loop above, and those are exactly the files
    // `adr:0024` calls the interesting case.
    for (const set of subsets()) {
      const files = renderConvention(set);
      const absent = HARNESSES.filter((h) => !set.includes(h)).map((h) => OWN[h]);
      for (const [path, content] of Object.entries(files)) {
        for (const dir of absent) {
          expect(path, `[${set.join("+")}] the path ${path} names ${dir}`).not.toContain(dir);
          expect(content, `[${set.join("+")}] ${path} names ${dir} in its text`).not.toContain(dir);
        }
      }
    }
  });

  it("names no harness's entry file but its own", () => {
    // Codex and opencode share AGENTS.md, so only Claude Code's is exclusive.
    expect(JSON.stringify(renderedFor("codex"))).not.toContain("CLAUDE.md");
    expect(JSON.stringify(renderedFor("opencode"))).not.toContain("CLAUDE.md");
  });
});

describe("renderSkills", () => {
  it("puts every skill under the harness's own skills directory", () => {
    for (const h of HARNESSES) {
      const dir = profileFor(h).skillsDir;
      const paths = Object.keys(renderSkills(profileFor(h)));
      expect(paths.length).toBeGreaterThan(0);
      for (const p of paths) {
        expect(p.startsWith(`${dir}/`), `${p} must sit under ${dir}`).toBe(true);
        expect(p.endsWith("/SKILL.md"), `${p} must be a SKILL.md`).toBe(true);
      }
    }
  });

  it("ships the same skill names to every harness", () => {
    const names = (h: Harness) =>
      Object.keys(renderSkills(profileFor(h)))
        .map((p) => p.split("/").at(-2))
        .sort();
    expect(names("codex")).toEqual(names("claude"));
    expect(names("opencode")).toEqual(names("claude"));
  });

  it("renders one template set — the skill bodies differ only where a path does", () => {
    // The whole point of `adr:0024`: one text, three renderings. If the bodies
    // diverged beyond the paths, there would be three conventions to maintain.
    const strip = (h: Harness) =>
      Object.values(renderSkills(profileFor(h)))
        .join("\n")
        .split(profileFor(h).skillsDir)
        .join("<skills>")
        .split(profileFor(h).entryFile)
        .join("<entry>");
    expect(strip("codex")).toBe(strip("claude"));
    expect(strip("opencode")).toBe(strip("claude"));
  });

  it("carries the version marker on every rendered skill", () => {
    for (const h of HARNESSES) {
      for (const body of Object.values(renderSkills(profileFor(h)))) {
        expect(body).toMatch(/^open-wiki-version:\s*\S+$/m);
      }
    }
  });
});

describe("renderEntryFiles", () => {
  it("writes one entry file per harness when they are alone", () => {
    expect(Object.keys(renderEntryFiles(profilesFor(["claude"]), "en"))).toEqual(["CLAUDE.md"]);
    expect(Object.keys(renderEntryFiles(profilesFor(["codex"]), "en"))).toEqual(["AGENTS.md"]);
    expect(Object.keys(renderEntryFiles(profilesFor(["opencode"]), "en"))).toEqual(["AGENTS.md"]);
  });

  it("writes one AGENTS.md for Codex and opencode together, not two", () => {
    const files = renderEntryFiles(profilesFor(["codex", "opencode"]), "en");
    expect(Object.keys(files)).toEqual(["AGENTS.md"]);
  });

  it("makes CLAUDE.md import AGENTS.md rather than repeat it", () => {
    // opencode reads CLAUDE.md as well as AGENTS.md, so two full copies would
    // load the convention twice in one session. Claude Code's own reference
    // gives the import as the answer for a repository that already has an
    // AGENTS.md, so this is read from the source rather than invented.
    const files = renderEntryFiles(profilesFor(HARNESSES), "en");
    expect(Object.keys(files).sort()).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(files["CLAUDE.md"]).toContain("@AGENTS.md");
    // The pointer is short: the convention itself lives in one file.
    expect(files["CLAUDE.md"]!.length).toBeLessThan(files["AGENTS.md"]!.length);
  });

  it("does not import a file it did not write", () => {
    const alone = renderEntryFiles(profilesFor(["claude"]), "en");
    expect(alone["CLAUDE.md"]).not.toContain("@AGENTS.md");
  });

  it("states which gate regime the project is under", () => {
    for (const h of HARNESSES) {
      const body = Object.values(renderEntryFiles(profilesFor([h]), "en")).join("\n");
      expect(body, `${h}'s entry file must name its regime`).toMatch(
        /refuses a bad page|no gate is installed yet|no interception is scaffolded/,
      );
      // `ow write` is the documented path in every regime, per adr:0024.
      expect(body).toContain("ow write");
    }
  });

  it("does not claim a gate this build has not installed", () => {
    // The requirement, from `adr:0024` and task 3.2: a user who believes they
    // are protected and is not is worse off than one who knows they are not.
    //
    // Asserted against **what is installed** rather than against what
    // `gateParagraph` happens to emit. The first version compared the text to
    // itself and locked in a claim that was false for two harnesses for a whole
    // group; this one goes red the moment a profile gains a gate nothing writes.
    for (const h of HARNESSES) {
      const body = Object.values(renderEntryFiles(profilesFor([h]), "en")).join("\n");
      if (GATES_INSTALLED.includes(h)) {
        expect(body, `${h}'s gate is installed and must be described`).not.toContain(
          "no gate is installed yet",
        );
        expect(body).toContain("refuses a bad page");
      } else {
        expect(body, `${h} has no gate installed and must say so`).toContain(
          "no gate is installed yet",
        );
      }
    }
  });

  it("says which gates complete a page and which only refuse one", () => {
    // The asymmetry a Codex or opencode user actually feels. Nothing
    // unvalidated reaches `wiki/` under any harness, but under two of them
    // `ow write` is how a page lands rather than one way among several — a
    // convention leaving that to be discovered from a denial would be
    // technically true and practically a trap.
    for (const h of HARNESSES) {
      const gate = profileFor(h).gate;
      if (!gate || !GATES_INSTALLED.includes(h)) continue;
      const body = Object.values(renderEntryFiles(profilesFor([h]), "en")).join("\n");
      if (gate.completes) {
        expect(body, `${h} completes a page`).toContain("is completed");
        expect(body).not.toContain("It refuses; it does not complete");
      } else {
        expect(body, `${h} only refuses`).toContain("It refuses; it does not complete");
      }
    }
  });

  it("tells a multi-harness project the regime of each of its harnesses", () => {
    // The dangerous case: one file serving two harnesses whose regimes differ.
    // A single sentence for both would be wrong about exactly one of them.
    const body = renderEntryFiles(profilesFor(["claude", "codex"]), "en")["AGENTS.md"]!;
    expect(body).toContain("Codex");
    expect(body).toContain("It refuses; it does not complete");
  });

  it("carries the configured content language", () => {
    const en = renderEntryFiles(profilesFor(["claude"]), "en")["CLAUDE.md"]!;
    const pt = renderEntryFiles(profilesFor(["claude"]), "pt-BR")["CLAUDE.md"]!;
    expect(en).toContain("English");
    expect(pt).toContain("Brazilian Portuguese");
  });

  it("names no entry file for no harnesses", () => {
    expect(renderEntryFiles([], "en")).toEqual({});
  });
});

describe("renderConvention", () => {
  it("is the skills and the entry files together", () => {
    const files = renderConvention(["claude"]);
    expect(Object.keys(files)).toContain("CLAUDE.md");
    expect(Object.keys(files).some((p) => p.startsWith(".claude/skills/"))).toBe(true);
  });

  it("renders every harness's skills when a project carries several", () => {
    const files = renderConvention(["claude", "codex"]);
    expect(Object.keys(files).some((p) => p.startsWith(".claude/skills/"))).toBe(true);
    expect(Object.keys(files).some((p) => p.startsWith(".codex/skills/"))).toBe(true);
    expect(Object.keys(files).sort()).toContain("AGENTS.md");
    expect(Object.keys(files).sort()).toContain("CLAUDE.md");
  });

  it("renders nothing at all for no harnesses", () => {
    expect(renderConvention([])).toEqual({});
  });
});
