import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSecrets } from "@open-wiki/access/secrets";
import type { FetchLike } from "@open-wiki/audio";
import {
  checkCredential,
  createProject,
  credentialState,
  currentLanguage,
  forgetProject,
  knownProjects,
  ProjectNameTakenError,
  RelativeProjectPathError,
  saveCredential,
  setLanguage,
} from "../src/main/settings.js";

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

describe("checkCredential (8.3)", () => {
  it("accepts a key Groq accepts", async () => {
    const { doFetch } = fakeFetch(200);
    await expect(
      checkCredential({ provider: "groq", apiKey: "gsk_good" }, { fetch: doFetch }),
    ).resolves.toEqual({ ok: true });
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

  it("needs no credential at all for whisper.cpp", async () => {
    // Choosing it is how a user opts out of the one place this product talks
    // to a third party.
    await expect(checkCredential({ provider: "whispercpp" })).resolves.toEqual({ ok: true });
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
