import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectVocabulary, rankNames } from "../src/sources/vocabulary.js";
import { transcriptionInputs } from "../src/sources/transcription.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ow-vocab-"));
  mkdirSync(join(root, "wiki"), { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function page(slug: string, front: Record<string, unknown>): void {
  const yaml = Object.entries(front)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  writeFileSync(join(root, "wiki", `${slug}.md`), `---\n${yaml}\n---\n\nbody\n`, "utf8");
}

describe("projectVocabulary (4.10)", () => {
  it("collects the titles already in the wiki", () => {
    // The names are the whole point: a speech model has never heard "Fenix"
    // and writes "Phoenix", every time, on every chunk.
    page("fenix", { title: "Fenix", aliases: [] });
    page("mateus", { title: "Mateus Andrade", aliases: [] });
    expect(projectVocabulary(root)).toContain("Fenix");
    expect(projectVocabulary(root)).toContain("Mateus Andrade");
  });

  it("collects the aliases each page lists, which is where the variants live", () => {
    page("fenix", { title: "Fenix", aliases: ["Projeto Fenix", "FNX"] });
    const vocabulary = projectVocabulary(root);
    expect(vocabulary).toContain("Projeto Fenix");
    expect(vocabulary).toContain("FNX");
  });

  it("is empty for a project with no pages yet", () => {
    expect(projectVocabulary(root)).toEqual([]);
  });

  it("skips a page whose frontmatter will not parse", () => {
    writeFileSync(join(root, "wiki", "broken.md"), "no frontmatter here\n", "utf8");
    page("fenix", { title: "Fenix", aliases: [] });
    expect(projectVocabulary(root)).toEqual(["Fenix"]);
  });

  it("bounds the list, because the prompt window holds only so much", () => {
    for (let i = 0; i < 50; i++) page(`p${i}`, { title: `Name${i}`, aliases: [] });
    expect(projectVocabulary(root, 10)).toHaveLength(10);
  });
});

describe("transcriptionInputs (4.15)", () => {
  it("takes the language from the project's settings, not from detection", () => {
    writeFileSync(
      join(root, "ow.json"),
      JSON.stringify({ language: "pt-BR", deleteWavAfterTranscription: true }),
      "utf8",
    );
    expect(transcriptionInputs(root).language).toBe("pt-BR");
  });

  it("defaults to English, which is what an unconfigured project produces", () => {
    expect(transcriptionInputs(root).language).toBe("en");
  });

  it("carries the project's names alongside it", () => {
    page("fenix", { title: "Fenix", aliases: [] });
    expect(transcriptionInputs(root).vocabulary).toEqual(["Fenix"]);
  });

  it("carries no credential — the CLI and the hooks must never read one", () => {
    // `config/secrets.ts`: their stderr is consumed by an agent and travels to
    // a model provider. Only the desktop application reads the key.
    expect(Object.keys(transcriptionInputs(root))).toEqual(["language", "vocabulary"]);
  });
});

describe("rankNames", () => {
  it("removes duplicates however they were cased", () => {
    expect(rankNames(["Fenix", "fenix", "FENIX"])).toEqual(["Fenix"]);
  });

  it("puts the single unusual words first, which are what a model gets wrong", () => {
    expect(rankNames(["Mateus Andrade", "Fenix"])).toEqual(["Fenix", "Mateus Andrade"]);
  });

  it("drops a title that is a sentence rather than a name", () => {
    // Four words is a page describing something. It costs as much prompt as
    // four names and helps with none of them.
    expect(rankNames(["How the dispatcher routes requests"])).toEqual([]);
  });

  it("drops words a model already knows", () => {
    expect(rankNames(["index", "Changelog", "Fenix"])).toEqual(["Fenix"]);
  });

  it("collapses the whitespace inside a name", () => {
    expect(rankNames(["  Mateus   Andrade  "])).toEqual(["Mateus Andrade"]);
  });

  it("drops an empty name", () => {
    expect(rankNames(["", "   "])).toEqual([]);
  });

  it("is stable, so two runs seed the same prompt", () => {
    const names = ["Zeta", "Alpha", "Beta Gamma"];
    expect(rankNames(names)).toEqual(rankNames([...names].reverse()));
  });
});
