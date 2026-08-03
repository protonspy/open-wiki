import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeSettings } from "@open-wiki/access";
import { NoSuchPageError, projectInfo, readPage, wikiIndex } from "../src/main/api.js";
import { CHANNELS, createApi, dispatch } from "../src/main/ipc.js";
import { looksLikeProject, resolveProject } from "../src/main/project.js";
import { areaOf, describeChange, isOpenPage, toProjectPath } from "../src/main/watcher.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ow-shell-"));
  for (const part of ["raw", "wiki", ".state"]) mkdirSync(join(root, part), { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function page(slug: string, front: Record<string, unknown>, body = "body\n"): void {
  const yaml = Object.entries(front)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  writeFileSync(join(root, "wiki", `${slug}.md`), `---\n${yaml}\n---\n\n${body}`, "utf8");
}

describe("looksLikeProject (8.2)", () => {
  it("is true for a directory the scaffolder made", () => {
    expect(looksLikeProject(root)).toBe(true);
  });

  it("is false for a directory that merely exists", () => {
    const other = mkdtempSync(join(tmpdir(), "ow-not-"));
    try {
      expect(looksLikeProject(other)).toBe(false);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("is false when one of the three is a file rather than a directory", () => {
    rmSync(join(root, ".state"), { recursive: true, force: true });
    writeFileSync(join(root, ".state"), "");
    expect(looksLikeProject(root)).toBe(false);
  });
});

describe("resolveProject (8.2)", () => {
  it("takes the directory --project names", () => {
    expect(resolveProject({ argv: ["electron", ".", "--project", root], cwd: "/" })).toBe(root);
  });

  it("resolves a relative --project against the working directory", () => {
    const parent = join(root, "..");
    const name = root.split(/[\\/]/).pop()!;
    expect(resolveProject({ argv: ["--project", name], cwd: parent })).toBe(root);
  });

  it("falls back to the working directory when it already looks like a project", () => {
    expect(resolveProject({ argv: ["electron", "."], cwd: root })).toBe(root);
  });

  it("answers null rather than opening a directory that is not a project", () => {
    // The launcher of 8.4 is what happens next. Guessing here would open the
    // user's home folder as though it were a wiki.
    expect(resolveProject({ argv: ["electron"], cwd: tmpdir() })).toBeNull();
  });

  it("answers null for a --project that is not there", () => {
    expect(resolveProject({ argv: ["--project", join(root, "gone")], cwd: root })).toBeNull();
  });

  it("does not read a Chromium switch as a project", () => {
    // Electron's argv carries the executable, sometimes a script path, and any
    // number of switches. Reading a positional out of that is how `--inspect`
    // becomes a project name.
    expect(resolveProject({ argv: ["--project", "--inspect"], cwd: tmpdir() })).toBeNull();
  });
});

describe("wikiIndex and readPage (8.5)", () => {
  it("lists every page with its slug", () => {
    page("fenix", { id: "fenix", title: "Fenix" });
    page("mateus", { id: "mateus", title: "Mateus" });
    expect(wikiIndex(root).slugs.sort()).toEqual(["fenix", "mateus"]);
  });

  it("finds a page that sits in a subfolder", () => {
    // `adr:0016-a-page-is-its-slug-wherever-it-sits`.
    mkdirSync(join(root, "wiki", "projects"), { recursive: true });
    writeFileSync(
      join(root, "wiki", "projects", "fenix.md"),
      `---\nid: "fenix"\n---\n\nbody\n`,
      "utf8",
    );
    expect(readPage(root, "fenix").slug).toBe("fenix");
  });

  it("returns the body without the frontmatter block", () => {
    page("fenix", { id: "fenix", title: "Fenix" }, "the body\n");
    expect(readPage(root, "fenix").body.trim()).toBe("the body");
  });

  it("returns the frontmatter as a mapping", () => {
    page("fenix", { id: "fenix", title: "Fenix" });
    expect(readPage(root, "fenix").frontmatter).toMatchObject({ title: "Fenix" });
  });

  it("says so rather than throwing an unrelated error when the block will not parse", () => {
    writeFileSync(join(root, "wiki", "broken.md"), "---\n: :\n---\n\nbody\n", "utf8");
    const view = readPage(root, "broken");
    expect(view.frontmatterBroken).toBe(true);
    expect(view.body.trim()).toBe("body");
  });

  it("refuses a slug that names no page", () => {
    expect(() => readPage(root, "ghost")).toThrow(NoSuchPageError);
  });

  it("refuses a slug that is a path, rather than resolving it", () => {
    // A slug reaches here out of a wikilink in someone else's prose. It is
    // resolved through the index, so a traversal names no page rather than
    // naming a file.
    page("fenix", { id: "fenix" });
    for (const slug of ["../../etc/hosts", "..\\..\\secrets", "wiki/fenix"]) {
      expect(() => readPage(root, slug)).toThrow(NoSuchPageError);
    }
  });
});

describe("projectInfo (8.2)", () => {
  it("names the project by its directory", () => {
    expect(projectInfo(root).name).toBe(root.split(/[\\/]/).pop());
  });

  it("carries the content language the project is configured for", () => {
    writeFileSync(
      join(root, "ow.json"),
      JSON.stringify({ language: "pt-BR", deleteWavAfterTranscription: true }),
      "utf8",
    );
    expect(projectInfo(root).language).toBe("pt-BR");
  });
});

describe("the IPC surface (8.2)", () => {
  it("binds the project root, so the renderer never names one", () => {
    page("fenix", { id: "fenix", title: "Fenix" });
    const api = createApi({ projectRoot: root });
    expect(api.index().slugs).toEqual(["fenix"]);
  });

  it("routes each channel to its handler", async () => {
    page("fenix", { id: "fenix", title: "Fenix" });
    const api = createApi({ projectRoot: root });
    expect(await dispatch(api, CHANNELS.index, [])).toMatchObject({ slugs: ["fenix"] });
    expect(await dispatch(api, CHANNELS.page, ["fenix"])).toMatchObject({ slug: "fenix" });
    expect(await dispatch(api, CHANNELS.project, [])).toMatchObject({ root });
  });

  it("refuses an unknown channel rather than never settling", async () => {
    const api = createApi({ projectRoot: root });
    await expect(dispatch(api, "wiki:delete-everything", [])).rejects.toThrow(/unknown channel/);
  });

  it("says recording is unavailable rather than throwing something unreadable", async () => {
    const api = createApi({ projectRoot: root });
    await expect(dispatch(api, CHANNELS.recordStart, ["t"])).rejects.toThrow(
      /recording is not available/,
    );
  });
});

describe("recording over IPC (8.2)", () => {
  /** A recorder control that records whether it was asked to start one. */
  function control() {
    const calls: string[] = [];
    let session: { start: unknown; status: unknown } | null = null;
    const fake = {
      start: (title: string, dir: string, endpoints?: unknown) => {
        calls.push(`start ${title} ${dir}`);
        calls.push(`endpoints ${JSON.stringify(endpoints ?? {})}`);
        return Promise.resolve();
      },
      pause: () => Promise.resolve(),
      resume: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      status: () => Promise.resolve({ state: "recording", recorded_ms: 12 }),
      devices: () => {
        calls.push("devices");
        return Promise.resolve([
          { id: "{mic-headset}", name: "Headset", kind: "capture", default: false },
          { id: "{out-speakers}", name: "Speakers", kind: "loopback", default: true },
        ]);
      },
    };
    return {
      calls,
      spawned: () => session !== null,
      control: {
        ensure: () => {
          calls.push("ensure");
          session ??= fake as never;
          return fake as never;
        },
        peek: () => session as never,
      },
    };
  }

  it("never starts the sidecar to answer a status poll", async () => {
    // `recorder.exe` opens both WASAPI devices the moment it launches. A poll
    // that constructed a session would hold the microphone from the moment the
    // window opened, with the chrome saying nothing was being recorded.
    const r = control();
    const api = createApi({ projectRoot: root, recorder: r.control });
    const status = await api.recordStatus();
    expect(r.spawned()).toBe(false);
    expect(r.calls).not.toContain("ensure");
    expect(status.state).toBe("idle");
  });

  it("reports idle rather than failing when nothing is recording", async () => {
    const api = createApi({ projectRoot: root });
    await expect(api.recordStatus()).resolves.toMatchObject({ state: "idle" });
  });

  it("never starts the sidecar to answer a device list (R1.1)", async () => {
    // The same rule the status poll lives under, and the reason `peek` and
    // `ensure` are two methods. Opening a picker must not be what puts the
    // microphone into Windows' in-use state while the chrome says nothing is
    // being recorded.
    const r = control();
    const api = createApi({ projectRoot: root, recorder: r.control });

    const devices = await api.recordDevices();

    expect(r.spawned()).toBe(false);
    expect(r.calls).not.toContain("ensure");
    expect(devices).toEqual([]);
  });

  it("lists the endpoints once a recording has made a sidecar to ask", async () => {
    const r = control();
    const api = createApi({ projectRoot: root, recorder: r.control });
    await api.recordStart("Fenix weekly");

    const devices = await api.recordDevices();

    expect(devices.map((d) => d.id)).toEqual(["{mic-headset}", "{out-speakers}"]);
  });

  it("records with the endpoints the project chose (R1.2)", async () => {
    writeSettings(root, { micEndpoint: "{mic-headset}" });
    const r = control();
    const api = createApi({ projectRoot: root, recorder: r.control });

    const started = await api.recordStart("Fenix weekly");

    expect(r.calls).toContain('endpoints {"mic":"{mic-headset}","system":""}');
    expect(started.unresolved).toEqual([]);
  });

  it("records on the default and says so when the chosen endpoint is not here (R1.5)", async () => {
    // `ow.json` is committed and an endpoint identifier is machine-local, so
    // this is the ordinary outcome of a `git clone`. Refusing would make the
    // committed file a liability; substituting in silence is what the spec
    // forbids. It falls back *and reports which choice was dropped*.
    writeSettings(root, { micEndpoint: "{mic-from-another-machine}" });
    const r = control();
    const api = createApi({ projectRoot: root, recorder: r.control });

    const started = await api.recordStart("Fenix weekly");

    expect(r.calls).toContain('endpoints {"mic":"","system":""}');
    expect(started.unresolved).toEqual([
      { track: "mic", endpoint: "{mic-from-another-machine}" },
    ]);
  });

  it("starts the sidecar only when asked to record", async () => {
    const r = control();
    const api = createApi({ projectRoot: root, recorder: r.control });
    await api.recordStart("Fenix weekly");
    expect(r.spawned()).toBe(true);
  });

  it("derives the directory from the project, never from the renderer", async () => {
    // Every other handler binds the project root rather than accepting a path.
    // This one used to be the exception, which is a compromised renderer
    // choosing anywhere the user can write.
    const r = control();
    const api = createApi({
      projectRoot: root,
      recorder: r.control,
      now: () => new Date(2026, 6, 31, 14, 2, 11),
    });
    const started = await api.recordStart("Fenix weekly");
    expect(started.id).toBe("fenix-weekly-2026-07-31");
    expect(started.dir).toBe(join(root, "raw", "fenix-weekly-2026-07-31"));
  });

  it("cannot be steered out of the project by the occasion", async () => {
    const r = control();
    const api = createApi({
      projectRoot: root,
      recorder: r.control,
      now: () => new Date(2026, 6, 31, 14, 2, 11),
    });
    const started = await api.recordStart("../../../../Windows/Startup");
    expect(started.dir.startsWith(join(root, "raw"))).toBe(true);
    expect(started.id).not.toContain("..");
  });

  it("takes an occasion and nothing else over the wire", async () => {
    const r = control();
    const api = createApi({ projectRoot: root, recorder: r.control });
    // A second argument is simply not read.
    await dispatch(api, CHANNELS.recordStart, ["Fenix weekly", "C:/Windows/Startup"]);
    expect(r.calls.join(" ")).not.toContain("C:/Windows");
  });

  it("refuses pause and stop when nothing is recording", async () => {
    const r = control();
    const api = createApi({ projectRoot: root, recorder: r.control });
    await expect(api.recordPause()).rejects.toThrow(/nothing is being recorded/);
    await expect(api.recordStop()).rejects.toThrow(/nothing is being recorded/);
    expect(r.spawned()).toBe(false);
  });
});

describe("the watcher's vocabulary (8.10)", () => {
  it("describes a change as a project-relative path", () => {
    const change = describeChange(root, "changed", join(root, "wiki", "fenix.md"));
    expect(change).toEqual({ kind: "changed", path: "wiki/fenix.md", area: "wiki" });
  });

  it("uses forward slashes, whatever the platform separator is", () => {
    expect(toProjectPath(root, join(root, "wiki", "projects", "fenix.md"))).toBe(
      "wiki/projects/fenix.md",
    );
  });

  it("ignores a change outside the project", () => {
    expect(describeChange(root, "changed", join(root, "..", "elsewhere.md"))).toBeNull();
  });

  it("ignores the project root itself", () => {
    expect(toProjectPath(root, root)).toBeNull();
  });

  it("tells the two content areas apart", () => {
    expect(areaOf("wiki/fenix.md")).toBe("wiki");
    expect(areaOf("raw/weekly/text.md")).toBe("raw");
    expect(areaOf(".state/log.json")).toBe("other");
  });

  it("does not mistake a top-level name beginning with dots for an escape", () => {
    expect(toProjectPath(root, join(root, "..foo.md"))).toBe("..foo.md");
  });
});

describe("isOpenPage (8.10)", () => {
  const change = (path: string) => ({ kind: "changed" as const, path, area: "wiki" as const });

  it("is true when the page on screen is the one that moved", () => {
    expect(isOpenPage(change("wiki/fenix.md"), "fenix")).toBe(true);
  });

  it("is true wherever that page sits", () => {
    // `adr:0016-a-page-is-its-slug-wherever-it-sits`.
    expect(isOpenPage(change("wiki/projects/fenix.md"), "fenix")).toBe(true);
  });

  it("is false for a page whose name merely ends the same way", () => {
    // A suffix match on `/fenix.md` would also fire for `not-fenix.md` on a
    // project where somebody named a page that way.
    expect(isOpenPage(change("wiki/not-fenix.md"), "fenix")).toBe(false);
  });

  it("is false when no page is open, and for a change outside the wiki", () => {
    expect(isOpenPage(change("wiki/fenix.md"), undefined)).toBe(false);
    expect(isOpenPage({ kind: "added", path: "raw/x/text.md", area: "raw" }, "fenix")).toBe(false);
  });
});
