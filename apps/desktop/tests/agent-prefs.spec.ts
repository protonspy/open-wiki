import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { secretsFile } from "@open-wiki/access/secrets";
import {
  agentPrefsFile,
  DEFAULT_MODEL,
  parseModelList,
  readAgentPrefs,
  resolveModel,
  writeAgentPrefs,
} from "../src/main/agent/agent-prefs.js";

/**
 * The agent's per-project model prefs (group 5). Pure: the file is read and
 * written, and the default-selection rule is decided, without Electron or
 * langchain — which is the reason the module exists apart from `agent.ts`.
 */

let root: string;
let appData: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ow-prefs-root-"));
  appData = mkdtempSync(join(tmpdir(), "ow-prefs-appdata-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(appData, { recursive: true, force: true });
});

describe("agentPrefsFile (5.4)", () => {
  it("is a sibling of the secrets file, not the secrets file", () => {
    expect(agentPrefsFile(root, appData)).not.toBe(secretsFile(root, appData));
    expect(agentPrefsFile(root, appData).replace(/\.agent\.json$/, ".json")).toBe(
      secretsFile(root, appData),
    );
  });
});

describe("writeAgentPrefs / readAgentPrefs", () => {
  it("round-trips the list and selection", () => {
    writeAgentPrefs(
      root,
      { models: ["openai/gpt-oss-120b", "llama-3.3-70b"], selectedModel: "llama-3.3-70b" },
      appData,
    );
    expect(readAgentPrefs(root, appData)).toEqual({
      models: ["openai/gpt-oss-120b", "llama-3.3-70b"],
      selectedModel: "llama-3.3-70b",
    });
  });

  it("returns undefined before anything is written", () => {
    expect(readAgentPrefs(root, appData)).toBeUndefined();
  });

  it("coerces a malformed file on disk back to a valid shape", () => {
    // A file edited by hand, or written by an older shape, must not crash the
    // agent — the selection falls back to the default-selection rule.
    const file = agentPrefsFile(root, appData);
    writeAgentPrefs(
      root,
      { models: ["openai/gpt-oss-120b"], selectedModel: "openai/gpt-oss-120b" },
      appData,
    );
    // Overwrite with junk that is still valid JSON but the wrong shape.
    writeFileSync(file, JSON.stringify({ models: "not-a-list", selectedModel: 7 }), "utf8");
    expect(readAgentPrefs(root, appData)).toEqual({ models: [], selectedModel: DEFAULT_MODEL });
  });
});

describe("resolveModel (R2.5)", () => {
  it("keeps the selected model when it is in the list", () => {
    expect(resolveModel({ models: ["a", "b"], selectedModel: "b" })).toBe("b");
  });

  it("falls back to the default when the selection is gone from the list", () => {
    expect(resolveModel({ models: ["a", "openai/gpt-oss-120b"], selectedModel: "gone" })).toBe(
      "openai/gpt-oss-120b",
    );
  });

  it("falls back to the first model when the default is not in the list either", () => {
    expect(resolveModel({ models: ["llama-3.3-70b", "mixtral-8x7b"], selectedModel: "gone" })).toBe(
      "llama-3.3-70b",
    );
  });

  it("falls back to the default alone when the list is empty", () => {
    expect(resolveModel(undefined)).toBe(DEFAULT_MODEL);
    expect(resolveModel({ models: [], selectedModel: "" })).toBe(DEFAULT_MODEL);
  });
});

describe("parseModelList", () => {
  it("reads the ids out of an OpenAI-shaped /models body", () => {
    expect(parseModelList({ data: [{ id: "a" }, { id: "b" }] })).toEqual(["a", "b"]);
  });

  it("returns an empty list for a body that is not the expected shape", () => {
    expect(parseModelList({})).toEqual([]);
    expect(parseModelList(null)).toEqual([]);
    expect(parseModelList({ data: "no" })).toEqual([]);
    expect(parseModelList({ data: [{ id: 7 }, { other: "x" }] })).toEqual([]);
  });
});

describe("the prefs file is not a secret", () => {
  it("is written without restrictive file mode", () => {
    // The model list is public; it does not carry the secrets file's 0600.
    writeAgentPrefs(root, { models: ["a"], selectedModel: "a" }, appData);
    expect(existsSync(agentPrefsFile(root, appData))).toBe(true);
    // The secrets file would be a sibling; neither contains the other.
    const body = readFileSync(agentPrefsFile(root, appData), "utf8");
    expect(body).toContain('"models"');
  });
});
