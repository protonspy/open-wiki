import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  settingsPath,
  readSettings,
  writeSettings,
  validateSettings,
  DEFAULT_SETTINGS,
} from "../src/config/settings.js";
import {
  secretsFile,
  readSecrets,
  writeSecrets,
  type ProjectSecrets,
} from "../src/config/secrets.js";

function tempDir(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("project settings (committed, closed schema, no local path)", () => {
  let root: string;
  beforeEach(() => (root = tempDir("ow-settings-")));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("lives at <project>/ow.json, not under .state or an app dir", () => {
    expect(settingsPath(root)).toBe(join(root, "ow.json"));
  });

  it("returns defaults when no settings file exists", () => {
    expect(readSettings(root)).toEqual(DEFAULT_SETTINGS);
  });

  it("writes and reads back a settings file", () => {
    writeSettings(root, { language: "pt-BR" });
    expect(readSettings(root)).toEqual({ ...DEFAULT_SETTINGS, language: "pt-BR" });
    const onDisk = JSON.parse(readFileSync(join(root, "ow.json"), "utf8"));
    expect(onDisk.language).toBe("pt-BR");
  });

  it("refuses an unknown key", () => {
    expect(() => validateSettings({ language: "en", secretToken: "x" })).toThrow(/secretToken/);
    expect(() => writeSettings(root, { ...DEFAULT_SETTINGS, extra: 1 } as never)).toThrow();
  });

  it("cannot carry a local path — any path-shaped key is unknown and refused", () => {
    expect(() => validateSettings({ language: "en", projectPath: "C:\\dev" })).toThrow(
      /projectPath/,
    );
  });

  it("refuses an unknown content language", () => {
    expect(() => validateSettings({ language: "fr" })).toThrow(/language/);
  });
});

describe("secrets (app data dir, keyed by project path, never in the project)", () => {
  let root: string;
  let appData: string;
  beforeEach(() => {
    root = tempDir("ow-proj-");
    appData = tempDir("ow-appdata-");
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(appData, { recursive: true, force: true });
  });

  it("is never written inside the project directory", () => {
    const file = secretsFile(root, appData);
    expect(file.startsWith(root)).toBe(false);
    expect(file.startsWith(appData)).toBe(true);
  });

  it("writes and reads back a transcription credential", () => {
    const secrets: ProjectSecrets = { stt: { provider: "groq", apiKey: "gsk_123" } };
    writeSecrets(root, secrets, appData);
    expect(readSecrets(root, appData)).toEqual(secrets);
  });

  it("keys the file by the project path — two projects get two files", () => {
    const root2 = tempDir("ow-proj2-");
    try {
      const a = secretsFile(root, appData);
      const b = secretsFile(root2, appData);
      expect(a).not.toBe(b);
      writeSecrets(root, { stt: { provider: "groq", apiKey: "a" } }, appData);
      writeSecrets(root2, { stt: { provider: "groq", apiKey: "b" } }, appData);
      expect(readSecrets(root, appData)?.stt.apiKey).toBe("a");
      expect(readSecrets(root2, appData)?.stt.apiKey).toBe("b");
    } finally {
      rmSync(root2, { recursive: true, force: true });
    }
  });

  it("returns undefined when the project has no secrets yet", () => {
    expect(readSecrets(root, appData)).toBeUndefined();
  });
});
