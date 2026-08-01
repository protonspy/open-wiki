import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  askRunningApp,
  handleRequest,
  isQueryVerb,
  serveQueries,
  socketPath,
  SOCKET_VERBS,
} from "../src/socket.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ow-socket-"));
  for (const part of ["raw", "wiki", ".state"]) mkdirSync(join(root, part), { recursive: true });
  writeFileSync(join(root, "wiki", "index.md"), "# Index\n", "utf8");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

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
      expect(socketPath(root)).not.toBe(socketPath(other));
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("is stable for one project", () => {
    expect(socketPath(root)).toBe(socketPath(root));
  });

  it("carries no part of the path, which is somebody's username", () => {
    expect(socketPath(root)).not.toContain(root.split(/[\\/]/).pop());
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
});

describe("the socket end to end (9.14)", () => {
  it("answers over the wire what the standalone path answers", async () => {
    // "Both paths produce the same answer" is the requirement, and it is the
    // one that makes the optimisation safe to have at all.
    page("fenix");
    const server = serveQueries(root);
    try {
      const overWire = await askRunningApp(root, { verb: "read", args: ["fenix"] });
      const standalone = handleRequest(root, { verb: "read", args: ["fenix"] });
      expect(overWire).toEqual(standalone);
    } finally {
      server.close();
    }
  }, 15_000);

  it("answers null when nothing is listening, so the caller falls back", async () => {
    // The socket is an optimisation. A CLI that failed because the application
    // was not running would be a CLI that needs the application.
    expect(await askRunningApp(root, { verb: "read", args: ["fenix"] }, 500)).toBeNull();
  }, 15_000);

  it("refuses a write over the wire", async () => {
    page("fenix");
    const server = serveQueries(root);
    try {
      const response = await askRunningApp(root, {
        verb: "write",
        args: ["wiki/fenix.md", "clobbered"],
      });
      expect(response?.ok).toBe(false);
    } finally {
      server.close();
    }
  }, 15_000);
});
