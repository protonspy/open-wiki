import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  settingsPath,
  readSettings,
  writeSettings,
  validateSettings,
  resolveEndpoint,
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

describe("the chosen audio endpoints (specs/audio-input-selection, R1.2, R1.5)", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ow-endpoints-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("defaults to following the Windows default for both tracks", () => {
    // R1.3. A project that has never chosen carries the empty string, and
    // that is a real answer rather than a missing one.
    expect(readSettings(root).micEndpoint).toBe("");
    expect(readSettings(root).systemEndpoint).toBe("");
  });

  it("keeps the two tracks apart", () => {
    // R1.2 chooses them independently: pinning the microphone must not say
    // anything about what the system track captures.
    writeSettings(root, { micEndpoint: "{mic-headset}" });
    const settings = readSettings(root);
    expect(settings.micEndpoint).toBe("{mic-headset}");
    expect(settings.systemEndpoint).toBe("");
  });

  it("refuses an endpoint that is not a string", () => {
    expect(() => validateSettings({ micEndpoint: 7 })).toThrow(/micEndpoint/);
  });

  it("refuses an endpoint identifier of an implausible length", () => {
    // `ow.json` is committed, so it arrives from a `git clone` like any other
    // file. An endpoint id is a GUID-shaped string of about ninety characters,
    // and this value is carried into a `start` request and into manifest.json.
    expect(() => validateSettings({ micEndpoint: "x".repeat(513) })).toThrow(/micEndpoint/);
  });

  it("keeps the schema closed against a near-miss key", () => {
    expect(() => validateSettings({ micendpoint: "{mic-headset}" })).toThrow(/schema is closed/);
  });

  it("resolves a chosen endpoint that is on this machine", () => {
    const resolved = resolveEndpoint("{mic-headset}", [{ id: "{mic-headset}" }]);
    expect(resolved).toEqual({ endpoint: "{mic-headset}", unresolved: null });
  });

  it("treats an endpoint that is on no device here as a choice to re-make", () => {
    // R1.5, and the cost of `ow.json` being committed: a teammate who clones
    // gets an identifier that means nothing on their machine. Refusing to
    // record would make the committed file a liability; substituting silently
    // is what the whole spec forbids. So it falls back *and says it did*.
    const resolved = resolveEndpoint("{mic-from-another-machine}", [{ id: "{mic-headset}" }]);
    expect(resolved).toEqual({ endpoint: "", unresolved: "{mic-from-another-machine}" });
  });

  it("does not report following the default as an unresolved choice", () => {
    expect(resolveEndpoint("", [])).toEqual({ endpoint: "", unresolved: null });
  });
});

describe("an endpoint identifier is not a place to hide a control character", () => {
  it("refuses a carriage return or an ANSI escape", () => {
    // `ow.json` is committed, so this value arrives from whoever wrote the
    // repository. It is carried into a refusal message, into manifest.json,
    // and — once there is a picker — onto a screen, where a CR or an escape
    // sequence can forge or erase what a teammate reads. Same reasoning as
    // `safe()` in the check findings, applied at the point of entry.
    expect(() => validateSettings({ micEndpoint: "{mic}\r\u001b[2K" })).toThrow(/micEndpoint/);
    expect(() => validateSettings({ systemEndpoint: "{out}\n" })).toThrow(/systemEndpoint/);
  });

  it("keeps an ordinary endpoint identifier", () => {
    const id = "{0.0.1.00000000}.{a1b2c3d4-0000-1111-2222-333344445555}";
    expect(validateSettings({ micEndpoint: id }).micEndpoint).toBe(id);
  });
});
