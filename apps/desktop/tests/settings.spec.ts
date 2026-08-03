import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSecrets } from "@open-wiki/access/secrets";
import { readSettings as currentSettings } from "@open-wiki/access";
import { createApi, NoProjectError } from "../src/main/ipc.js";
import type { FetchLike } from "@open-wiki/audio";
import {
  checkCredential,
  createProject,
  credentialState,
  currentLanguage,
  forgetProject,
  knownProjects,
  InvalidProjectNameError,
  parseCredentialInput,
  ProjectNameTakenError,
  RelativeProjectPathError,
  saveCredential,
  setDeleteWav,
  setLanguage,
  settingsView,
  agentModels,
  selectAgentModel,
} from "../src/main/settings.js";
import { readAgentPrefs, DEFAULT_MODEL } from "../src/main/agent/agent-prefs.js";

let root: string;
let appData: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ow-settings-"));
  appData = mkdtempSync(join(tmpdir(), "ow-appdata-"));
  for (const part of ["raw", "wiki", ".state"]) mkdirSync(join(root, part), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(appData, { recursive: true, force: true });
});

/** A `fetch` that answers with one status and records what it was sent. */
function fakeFetch(status: number) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const doFetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(status === 200 ? "{}" : "no", { status });
  };
  return { doFetch, calls };
}

/** A `fetch` that answers 200 with a Groq `/models` body, so the list is captured. */
function fakeModelsFetch(models: string[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const body = JSON.stringify({ data: models.map((id) => ({ id })) });
  const doFetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(body, { status: 200 });
  };
  return { doFetch, calls };
}

describe("checkCredential (8.3)", () => {
  it("accepts a key Groq accepts", async () => {
    const { doFetch } = fakeFetch(200);
    await expect(
      checkCredential({ provider: "groq", apiKey: "gsk_good" }, { fetch: doFetch }),
    ).resolves.toEqual({ ok: true, models: [] });
  });

  it("checks it on the spot, without sending audio", async () => {
    // The point of "validated on the spot": a wrong key is discovered now,
    // not an hour later when a meeting has been recorded and every chunk
    // fails.
    const { doFetch, calls } = fakeFetch(200);
    await checkCredential({ provider: "groq", apiKey: "gsk_good" }, { fetch: doFetch });
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[0]!.url).toContain("/models");
  });

  it("sends the key in a header and nowhere else", async () => {
    const { doFetch, calls } = fakeFetch(200);
    await checkCredential({ provider: "groq", apiKey: "gsk_secret" }, { fetch: doFetch });
    expect((calls[0]!.init.headers as Record<string, string>)["authorization"]).toBe(
      "Bearer gsk_secret",
    );
    expect(calls[0]!.url).not.toContain("gsk_secret");
  });

  it("captures the model list the validation call doubles as (5.4)", async () => {
    // The same `GET /models` that proves the key returns the catalogue, so the
    // settings dropdown is what Groq actually offered rather than a guess.
    const { doFetch } = fakeModelsFetch(["openai/gpt-oss-120b", "llama-3.3-70b"]);
    const result = await checkCredential(
      { provider: "groq", apiKey: "gsk_good" },
      { fetch: doFetch },
    );
    expect(result).toEqual({ ok: true, models: ["openai/gpt-oss-120b", "llama-3.3-70b"] });
  });

  it("says a rejected key was rejected", async () => {
    const { doFetch } = fakeFetch(401);
    const result = await checkCredential(
      { provider: "groq", apiKey: "gsk_bad" },
      { fetch: doFetch },
    );
    expect(result).toEqual({ ok: false, reason: "Groq did not accept that key" });
  });

  it("tells a key it could not check apart from a key that is wrong", async () => {
    // Refusing to store a key because the user is on a train would be this
    // screen inventing a policy nobody asked for.
    const doFetch: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    const result = await checkCredential(
      { provider: "groq", apiKey: "gsk_good" },
      { fetch: doFetch },
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/could not reach/);
  });

  it("does not promise whisper.cpp will work when nothing points at it", async () => {
    // No *credential* is not the same as nothing to check. The binary and the
    // model are not bundled, and `createProvider` refuses without both — so
    // accepting the choice here and failing an hour later, after a meeting has
    // been recorded, is a promise this screen has no business making.
    const result = await checkCredential({ provider: "whispercpp" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/binary and a model/);
  });

  it("refuses input that is not a provider at all", () => {
    // The one channel that used to cast rather than coerce.
    for (const bad of [null, "groq", 7, {}, { provider: "bogus" }, { provider: "groq" }]) {
      expect(parseCredentialInput(bad)).toBeNull();
    }
    expect(parseCredentialInput({ provider: "groq", apiKey: "k" })).toEqual({
      provider: "groq",
      apiKey: "k",
    });
  });

  it("drops a key sent alongside whisper.cpp rather than storing it", () => {
    expect(parseCredentialInput({ provider: "whispercpp", apiKey: "gsk_x" })).toEqual({
      provider: "whispercpp",
    });
  });

  it("refuses Groq with no key, and names the alternative", async () => {
    const result = await checkCredential({ provider: "groq" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/whisper\.cpp/);
  });
});

describe("saveCredential (8.3, 2.7)", () => {
  it("stores a key that checked out", async () => {
    const { doFetch } = fakeFetch(200);
    await saveCredential(
      root,
      { provider: "groq", apiKey: "gsk_good" },
      { fetch: doFetch, appDataDir: appData },
    );
    expect(readSecrets(root, appData)?.stt.apiKey).toBe("gsk_good");
  });

  it("stores nothing when the key did not check out", async () => {
    const { doFetch } = fakeFetch(401);
    await saveCredential(
      root,
      { provider: "groq", apiKey: "bad" },
      { fetch: doFetch, appDataDir: appData },
    );
    expect(readSecrets(root, appData)).toBeUndefined();
  });

  it("never writes the key into the project directory", async () => {
    // Unconditionally, because `git init` a week later turns a conditional
    // rule into a leak (2.7, `adr:0007`).
    const { doFetch } = fakeFetch(200);
    await saveCredential(
      root,
      { provider: "groq", apiKey: "gsk_secret" },
      { fetch: doFetch, appDataDir: appData },
    );
    const settings = existsSync(join(root, "ow.json"))
      ? readFileSync(join(root, "ow.json"), "utf8")
      : "";
    expect(settings).not.toContain("gsk_secret");
    expect(existsSync(join(root, ".state", "secrets.json"))).toBe(false);
  });
});

describe("credentialState (8.3)", () => {
  it("says whether there is a key, and never what it is", async () => {
    const { doFetch } = fakeFetch(200);
    await saveCredential(
      root,
      { provider: "groq", apiKey: "gsk_secret" },
      { fetch: doFetch, appDataDir: appData },
    );
    const state = credentialState(root, appData);
    expect(state).toEqual({ provider: "groq", hasKey: true });
    expect(JSON.stringify(state)).not.toContain("gsk_secret");
  });

  it("says there is none when there is none", () => {
    expect(credentialState(root, appData)).toEqual({ provider: null, hasKey: false });
  });
});

describe("agent model list + selection (5.4, R2.5)", () => {
  it("persists the captured model list beside the secrets file when a key checks out", async () => {
    // The validation call is the model-list fetch: the catalogue Groq returned
    // is written to its own file, separate from the secrets file (5.4).
    const { doFetch } = fakeModelsFetch(["openai/gpt-oss-120b", "llama-3.3-70b"]);
    await saveCredential(
      root,
      { provider: "groq", apiKey: "gsk_good" },
      {
        fetch: doFetch,
        appDataDir: appData,
      },
    );
    const prefs = readAgentPrefs(root, appData);
    expect(prefs?.models).toEqual(["openai/gpt-oss-120b", "llama-3.3-70b"]);
    // The default is selected when it is in the list.
    expect(prefs?.selectedModel).toBe("openai/gpt-oss-120b");
  });

  it("falls back to the first model when the default is not in the list", async () => {
    const { doFetch } = fakeModelsFetch(["llama-3.3-70b", "mixtral-8x7b"]);
    await saveCredential(
      root,
      { provider: "groq", apiKey: "gsk_good" },
      {
        fetch: doFetch,
        appDataDir: appData,
      },
    );
    expect(readAgentPrefs(root, appData)?.selectedModel).toBe("llama-3.3-70b");
  });

  it("does not write agent prefs for whisper.cpp — the agent does not run for it", async () => {
    // whisper.cpp needs no credential and offers no model list; the Chat pane is
    // disabled while it is chosen (R2.4, 5.3), so no prefs file is written.
    await saveCredential(root, { provider: "whispercpp" }, { appDataDir: appData });
    expect(readAgentPrefs(root, appData)).toBeUndefined();
  });

  it("does not put the model list in the secrets file", async () => {
    // The list is not a secret; it lives in a sibling file, so the secrets file
    // stays exactly the credential and nothing else.
    const { doFetch } = fakeModelsFetch(["openai/gpt-oss-120b"]);
    await saveCredential(
      root,
      { provider: "groq", apiKey: "gsk_secret" },
      {
        fetch: doFetch,
        appDataDir: appData,
      },
    );
    const secrets = readSecrets(root, appData);
    expect(JSON.stringify(secrets)).not.toContain("openai/gpt-oss-120b");
  });

  it("agentModels reports the list and selection, or the empty default", async () => {
    // Before a key is saved, there is nothing to pick.
    expect(agentModels(root, appData)).toEqual({ models: [], selectedModel: DEFAULT_MODEL });
    const { doFetch } = fakeModelsFetch(["openai/gpt-oss-120b", "llama-3.3-70b"]);
    await saveCredential(
      root,
      { provider: "groq", apiKey: "gsk_good" },
      {
        fetch: doFetch,
        appDataDir: appData,
      },
    );
    expect(agentModels(root, appData).models).toEqual(["openai/gpt-oss-120b", "llama-3.3-70b"]);
  });

  it("selectAgentModel records the user's pick, and refuses a model the list never offered", async () => {
    const { doFetch } = fakeModelsFetch(["openai/gpt-oss-120b", "llama-3.3-70b"]);
    await saveCredential(
      root,
      { provider: "groq", apiKey: "gsk_good" },
      {
        fetch: doFetch,
        appDataDir: appData,
      },
    );
    const next = selectAgentModel(root, "llama-3.3-70b", appData);
    expect(next.selectedModel).toBe("llama-3.3-70b");
    expect(readAgentPrefs(root, appData)?.selectedModel).toBe("llama-3.3-70b");
    // A model Groq never offered — a stale dropdown, a hand-edited value — must
    // not become the agent's model.
    expect(() => selectAgentModel(root, "gpt-4", appData)).toThrow(/not one of the models/);
  });
});

describe("setLanguage (8.12)", () => {
  it("changes the setting", () => {
    expect(setLanguage(root, "pt-BR")).toBe("pt-BR");
    expect(currentLanguage(root)).toBe("pt-BR");
  });

  it("regenerates CLAUDE.md, which is generated and carries the language", () => {
    // `adr:0008` — it reaches exactly two places, and this is the one that has
    // to be rewritten. The skills are not generated and are left alone.
    setLanguage(root, "es");
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toContain("Spanish");
    setLanguage(root, "pt-BR");
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toContain("Brazilian Portuguese");
  });

  it("refuses a language that is not offered", () => {
    expect(() => setLanguage(root, "fr" as never)).toThrow(/unknown language/);
  });

  it("defaults to English, which is what an unconfigured project produces", () => {
    expect(currentLanguage(root)).toBe("en");
  });
});

describe("the launcher (8.4)", () => {
  it("validates the name before it scaffolds anything", () => {
    // The registry validated inside `register`, the last statement — so a name
    // with a space, which is an ordinary thing to type, created the whole tree
    // and then threw, leaving an orphan nothing knew about.
    const dir = join(root, "orphan");
    expect(() => createProject("My Project", dir, "en", appData)).toThrow(InvalidProjectNameError);
    expect(existsSync(dir)).toBe(false);
  });

  it("lists nothing on a machine that knows no projects", () => {
    expect(knownProjects(appData)).toEqual([]);
  });

  it("creates a project through the scaffolder of 2.1", () => {
    // A project is the same project whichever door it came through — that is
    // 2.1's whole sentence, and a launcher making its own directories would
    // be a fourth door that disagreed.
    const dir = join(root, "novo");
    const created = createProject("novo", dir, "pt-BR", appData);
    expect(created).toMatchObject({ name: "novo", present: true });
    for (const part of ["raw", "wiki", ".state"]) {
      expect(existsSync(join(dir, part))).toBe(true);
    }
    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "skills"))).toBe(true);
  });

  it("carries the chosen language into the new project", () => {
    const dir = join(root, "novo");
    createProject("novo", dir, "es", appData);
    expect(currentLanguage(dir)).toBe("es");
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toContain("Spanish");
  });

  it("remembers it, so the launcher can open it again", () => {
    createProject("novo", join(root, "novo"), "en", appData);
    expect(knownProjects(appData).map((p) => p.name)).toEqual(["novo"]);
  });

  it("refuses a name this machine already knows", () => {
    createProject("novo", join(root, "a"), "en", appData);
    expect(() => createProject("novo", join(root, "b"), "en", appData)).toThrow(
      ProjectNameTakenError,
    );
  });

  it("shows a project whose directory moved, rather than hiding it", () => {
    // The registry is a cache, never truth (2.2). Hiding it would leave the
    // user wondering where their project went; showing it says what happened.
    const dir = join(root, "novo");
    createProject("novo", dir, "en", appData);
    rmSync(dir, { recursive: true, force: true });
    expect(knownProjects(appData)).toEqual([{ name: "novo", path: "", present: false }]);
  });

  it("forgets only the entry, never the directory", () => {
    // A launcher that deleted a wiki because somebody tidied a list would be
    // unforgivable.
    const dir = join(root, "novo");
    createProject("novo", dir, "en", appData);
    writeFileSync(join(dir, "wiki", "fenix.md"), "the only copy\n", "utf8");
    forgetProject("novo", appData);
    expect(knownProjects(appData)).toEqual([]);
    expect(readFileSync(join(dir, "wiki", "fenix.md"), "utf8")).toBe("the only copy\n");
  });
});

describe("createProject refuses a relative directory", () => {
  it("says where the project should live rather than guessing", () => {
    // A relative path resolves against whatever the Electron process has as
    // its working directory, which is not a place the user chose. Left
    // unchecked it scaffolded a stray `y/` inside the application's own source
    // tree, from a test that called every channel with arbitrary arguments.
    expect(() => createProject("novo", "y", "en", appData)).toThrow(RelativeProjectPathError);
    expect(existsSync(join(process.cwd(), "y"))).toBe(false);
  });
});

describe("a window with no project (8.4)", () => {
  it("answers null for the project rather than inventing one", () => {
    const api = createApi({ projectRoot: null });
    expect(api.project()).toBeNull();
  });

  it("still lists and creates projects, which is all a launcher does", () => {
    const api = createApi({ projectRoot: null });
    expect(api.knownProjects()).toBeInstanceOf(Array);
  });

  it("refuses every channel that needs a project, rather than guessing at one", () => {
    const api = createApi({ projectRoot: null });
    expect(() => api.index()).toThrow(NoProjectError);
    expect(() => api.page("fenix")).toThrow(NoProjectError);
    expect(() => api.sources()).toThrow(NoProjectError);
    expect(() => api.findings()).toThrow(NoProjectError);
    expect(() => api.credential()).toThrow(NoProjectError);
  });
});

/**
 * The settings sheet's subject (plan desktop-ui 6.1): the values, and the two
 * files they live in.
 */
describe("settingsView (6.1)", () => {
  it("answers the settings and where they are kept", () => {
    const view = settingsView(root, appData);
    expect(view.settings).toEqual({
      language: "en",
      deleteWavAfterTranscription: true,
      harnesses: [],
      // Empty is "follow the Windows default" (R1.3), and is what a project
      // that has never chosen an endpoint carries.
      micEndpoint: "",
      systemEndpoint: "",
    });
    expect(view.settingsFile).toBe(join(root, "ow.json"));
    expect(view.secretsFile.startsWith(appData)).toBe(true);
  });

  it("shows the file as it is on disk, not a copy of what was parsed", () => {
    // The point of showing the file is that it *is* the file. A pretty-printed
    // re-serialisation would hide exactly the malformed thing somebody opened
    // the sheet to understand.
    const raw = '{\n  "language": "pt-BR",\n   "deleteWavAfterTranscription": false\n}\n';
    writeFileSync(join(root, "ow.json"), raw, "utf8");
    expect(settingsView(root, appData).settingsText).toBe(raw);
  });

  it("says the file is not written yet rather than inventing one", () => {
    expect(settingsView(root, appData).settingsText).toBeNull();
  });

  it("never carries the credential across the bridge", async () => {
    // 2.7 and `adr:0007`: the secret lives in the application's data directory,
    // and `credentialState` already refuses to send it. This view names the
    // file so a person can find it — putting its contents on a screen that
    // renders markdown an agent wrote would be the same leak with a frame.
    await saveCredential(
      root,
      { provider: "groq", apiKey: "gsk_super_secret" },
      {
        appDataDir: appData,
        fetch: fakeFetch(200).doFetch,
      },
    );
    const view = settingsView(root, appData);
    expect(JSON.stringify(view)).not.toContain("gsk_super_secret");
    expect(view.settingsText ?? "").not.toContain("gsk_");
  });
});

describe("setDeleteWav (6.1)", () => {
  it("writes the choice where `transcribe-run` reads it", () => {
    expect(setDeleteWav(root, false).deleteWavAfterTranscription).toBe(false);
    expect(currentSettings(root).deleteWavAfterTranscription).toBe(false);
    expect(setDeleteWav(root, true).deleteWavAfterTranscription).toBe(true);
  });

  it("leaves the language alone", () => {
    setLanguage(root, "pt-BR");
    setDeleteWav(root, false);
    expect(currentLanguage(root)).toBe("pt-BR");
  });
});
