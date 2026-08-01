import { createConnection, createServer, type Server } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  askRunningApp,
  handleRequest,
  isQueryVerb,
  MAX_LINE_BYTES,
  projectKey,
  serveQueries,
  socketPath,
  SOCKET_VERBS,
  tokenFile,
} from "../src/socket.js";

let root: string;
let appDataDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ow-socket-"));
  appDataDir = mkdtempSync(join(tmpdir(), "ow-appdata-"));
  for (const part of ["raw", "wiki", ".state"]) mkdirSync(join(root, part), { recursive: true });
  writeFileSync(join(root, "wiki", "index.md"), "# Index\n", "utf8");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(appDataDir, { recursive: true, force: true });
});

const opts = (): { appDataDir: string } => ({ appDataDir });

function page(slug: string, body = "body\n"): void {
  const front = [
    `id: topic:${slug}`,
    "type: topic",
    `title: ${slug}`,
    "status: active",
    "aliases: []",
    "updated: 2026-07-01",
    "sources: []",
    'superseded-by: ""',
  ].join("\n");
  writeFileSync(join(root, "wiki", `${slug}.md`), `---\n${front}\n---\n\n${body}`, "utf8");
}

describe("socketPath", () => {
  it("is per project, so two open projects do not share one", () => {
    const other = mkdtempSync(join(tmpdir(), "ow-other-"));
    try {
      expect(socketPath(root, opts())).not.toBe(socketPath(other, opts()));
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("is stable for one project", () => {
    expect(socketPath(root, opts())).toBe(socketPath(root, opts()));
  });

  it("carries no part of the path, which is somebody's username", () => {
    expect(socketPath(root, opts())).not.toContain(root.split(/[\\/]/).pop());
  });

  it("agrees for two spellings of one directory", () => {
    // The desktop passes what `resolveProject` produced and the CLI passes
    // `process.cwd()`. When those differ only in spelling — a trailing
    // separator, `.`, or drive-letter case on Windows — a socket named from
    // the unnormalised string silently never fires, and nothing says so.
    const spellings = [
      root,
      `${root}${process.platform === "win32" ? "\\" : "/"}`,
      join(root, "."),
    ];
    if (process.platform === "win32") spellings.push(root.toUpperCase());
    for (const spelling of spellings) {
      expect(projectKey(spelling)).toBe(projectKey(root));
    }
  });
});

describe("isQueryVerb (9.14)", () => {
  it("accepts the two the socket carries", () => {
    expect(SOCKET_VERBS).toEqual(["read", "validate"]);
    for (const verb of SOCKET_VERBS) expect(isQueryVerb(verb)).toBe(true);
  });

  it("refuses every verb that writes", () => {
    // The socket carries read and validate and **never** write — so the write
    // verb always pays the standalone path. A write that went over the socket
    // would be a second writer into a project the application has open, with
    // no snapshot of its own and nothing to undo.
    for (const verb of ["write", "init", "gate", "undo", "consult", "mcp", ""]) {
      expect(isQueryVerb(verb)).toBe(false);
    }
  });
});

describe("handleRequest (9.14)", () => {
  it("answers a read", () => {
    page("fenix");
    const response = handleRequest(root, { verb: "read", args: ["fenix"] });
    expect(response.ok).toBe(true);
    expect(response.ok && String(response.result)).toContain("topic:fenix");
  });

  it("answers a validate", () => {
    page("fenix");
    const response = handleRequest(root, { verb: "validate", args: [] });
    expect(response.ok).toBe(true);
  });

  it("refuses a verb that writes, rather than doing it", () => {
    const response = handleRequest(root, { verb: "write", args: ["wiki/fenix.md", "x"] });
    expect(response.ok).toBe(false);
    expect(!response.ok && response.error).toMatch(/read and validate/);
  });

  it("refuses a page that is not there rather than throwing", () => {
    const response = handleRequest(root, { verb: "read", args: ["ghost"] });
    expect(response.ok).toBe(false);
  });

  it("refuses to read a file that is in the project but not in the wiki", () => {
    // The slug arrives over a socket. Nothing outside `wiki/` is a page, and
    // confining to the project alone would make `../README` reachable.
    writeFileSync(join(root, "README.md"), "not a page\n", "utf8");
    for (const slug of ["../README", "..\\README", "../.state/log.jsonl"]) {
      const response = handleRequest(root, { verb: "read", args: [slug] });
      expect(response.ok).toBe(false);
    }
  });
});

describe("the socket end to end (9.14)", () => {
  it("answers over the wire what the standalone path answers", async () => {
    // "Both paths produce the same answer" is the requirement, and it is the
    // one that makes the optimisation safe to have at all.
    page("fenix");
    const server = serveQueries(root, opts());
    try {
      const overWire = await askRunningApp(root, { verb: "read", args: ["fenix"] }, 2000, opts());
      const standalone = handleRequest(root, { verb: "read", args: ["fenix"] });
      expect(overWire).toEqual(standalone);
    } finally {
      server.close();
    }
  }, 15_000);

  it("answers null when nothing is listening, so the caller falls back", async () => {
    // The socket is an optimisation. A CLI that failed because the application
    // was not running would be a CLI that needs the application.
    expect(await askRunningApp(root, { verb: "read", args: ["fenix"] }, 500, opts())).toBeNull();
  }, 15_000);

  it("refuses a write over the wire", async () => {
    page("fenix");
    const server = serveQueries(root, opts());
    try {
      const response = await askRunningApp(
        root,
        { verb: "write", args: ["wiki/fenix.md", "clobbered"] },
        2000,
        opts(),
      );
      expect(response?.ok).toBe(false);
    } finally {
      server.close();
    }
  }, 15_000);

  it("takes the token back when the window closes", async () => {
    page("fenix");
    const server = serveQueries(root, opts());
    expect(readFileSync(tokenFile(root, opts()), "utf8")).not.toBe("");
    await new Promise<void>((done) => server.close(() => done()));
    expect(await askRunningApp(root, { verb: "read", args: ["fenix"] }, 500, opts())).toBeNull();
  }, 15_000);
});

describe("the socket authenticates both directions (9.14)", () => {
  it("says nothing to a peer without the token", async () => {
    // The endpoint name is a hash of a directory — obscure, not secret. A
    // local process that guesses it must not be able to read the wiki, and an
    // error message back would confirm it found the right name.
    page("fenix");
    const server = serveQueries(root, opts());
    try {
      const answered = await rawRoundTrip(socketPath(root, opts()), {
        verb: "read",
        args: ["fenix"],
        token: "0".repeat(64),
        nonce: "n",
      });
      expect(answered).toBeNull();
    } finally {
      server.close();
    }
  }, 15_000);

  it("ignores an answer that cannot prove it came from the application", async () => {
    // The other direction, and the one that matters more: whatever holds the
    // endpoint decides what `ow read` prints into an agent's context.
    page("fenix");
    writeFileSync(tokenFile(root, opts()), "a-token-the-impostor-does-not-have", {
      encoding: "utf8",
      mode: 0o600,
    });
    const impostor = await listenOnce(socketPath(root, opts()), (socket) => {
      socket.write(`${JSON.stringify({ ok: true, result: "forged", mac: "beef" })}\n`);
    });
    try {
      const answered = await askRunningApp(root, { verb: "read", args: ["fenix"] }, 2000, opts());
      expect(answered).toBeNull();
    } finally {
      impostor.close();
    }
  }, 15_000);

  it("hangs up on a peer that sends a line it will never finish", async () => {
    page("fenix");
    const server = serveQueries(root, opts());
    try {
      const closed = await new Promise<boolean>((done) => {
        const socket = createConnection(socketPath(root, opts()));
        socket.on("connect", () => socket.write("x".repeat(MAX_LINE_BYTES + 1)));
        socket.on("close", () => done(true));
        socket.on("error", () => done(true));
        setTimeout(() => done(false), 3000);
      });
      expect(closed).toBe(true);
    } finally {
      server.close();
    }
  }, 15_000);
});

/** A client that skips `askRunningApp`, so a test can send something it never would. */
function rawRoundTrip(path: string, payload: unknown): Promise<unknown | null> {
  return new Promise((done) => {
    let settled = false;
    const finish = (value: unknown | null): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      done(value);
    };
    const socket = createConnection(path);
    socket.on("connect", () => socket.write(`${JSON.stringify(payload)}\n`));
    socket.on("data", (chunk: Buffer) => finish(JSON.parse(chunk.toString("utf8")) as unknown));
    socket.on("close", () => finish(null));
    socket.on("error", () => finish(null));
    setTimeout(() => finish(null), 2000);
  });
}

/** A server that is not this application, holding the endpoint name. */
function listenOnce(
  path: string,
  answer: (socket: import("node:net").Socket) => void,
): Promise<Server> {
  return new Promise((done, fail) => {
    const server = createServer((socket) => {
      socket.on("data", () => answer(socket));
      socket.on("error", () => socket.destroy());
    });
    server.on("error", fail);
    server.listen(path, () => done(server));
  });
}
