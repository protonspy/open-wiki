import { createHash } from "node:crypto";
import { createConnection, createServer, type Server } from "node:net";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { checkProject } from "./check/checks.js";
import { assertWithin } from "./paths.js";
import { listPages } from "./store/index.js";

/**
 * Talking to the running application (plan 9.14, second half).
 *
 * The first half is the bundle: an unbundled CLI pays Node's module resolution
 * on every invocation, and a `PreToolUse` hook fires it on *every page write*.
 * This is the rest — when the desktop application already has the project
 * open, it has the answer in memory, and a query can be a round trip on a
 * named pipe instead of a process start.
 *
 * **It carries read and validate and never write.** That is not a scope
 * decision, it is the safety of the whole idea: a write over the socket would
 * be a second writer into a project the application has open, with no snapshot
 * of its own, and the operation log would record it as something the
 * application did rather than something an agent did. So the write verb always
 * pays the standalone path, and both paths produce the same answer — which is
 * the property that makes an optimisation safe to have at all.
 *
 * **It is an optimisation, so absence is not failure.** `askRunningApp`
 * answers `null` when nothing is listening, and the caller runs standalone. A
 * CLI that failed because the application was not running would be a CLI that
 * needs the application, and `adr:0013-the-project-directory-is-the-unit` says
 * the opposite.
 *
 * Reached as `@open-wiki/access/socket`, not from the barrel: this module
 * opens a listening socket, and the MCP process's read surface has no business
 * being able to.
 */

export const SOCKET_VERBS = ["read", "validate"] as const;
export type SocketVerb = (typeof SOCKET_VERBS)[number];

export interface SocketRequest {
  verb: string;
  args: string[];
}

export type SocketResponse = { ok: true; result: unknown } | { ok: false; error: string };

/**
 * The pipe a project's application listens on.
 *
 * A hash of the path rather than the path itself, for the reason `secrets.ts`
 * hashes it too: a pipe name is visible to every process on the machine, and
 * the path carries somebody's username and the name of what they are working
 * on. Windows named pipes are the only form that works on the platform this
 * product supports; the same name is a filesystem socket elsewhere, which is
 * what makes this testable off Windows.
 */
export function socketPath(projectRoot: string): string {
  const id = createHash("sha256").update(projectRoot).digest("hex").slice(0, 16);
  return process.platform === "win32"
    ? `\\\\.\\pipe\\open-wiki-${id}`
    : join(process.env["TMPDIR"] ?? "/tmp", `open-wiki-${id}.sock`);
}

/** Whether a verb is one the socket may answer. Everything else writes. */
export function isQueryVerb(verb: string): verb is SocketVerb {
  return (SOCKET_VERBS as readonly string[]).includes(verb);
}

/**
 * Answer one request.
 *
 * The same functions the standalone path calls, so "both paths produce the
 * same answer" is true by construction rather than by two implementations
 * agreeing.
 */
export function handleRequest(projectRoot: string, request: SocketRequest): SocketResponse {
  if (!isQueryVerb(request.verb)) {
    return {
      ok: false,
      error: `the socket carries read and validate and never write — "${request.verb}" runs standalone`,
    };
  }
  try {
    if (request.verb === "validate") {
      return { ok: true, result: checkProject(projectRoot) };
    }
    const slug = request.args[0] ?? "";
    // Resolved through the index, never by joining the slug onto a path: a
    // slug arrives over a socket, which is the least trusted place it comes
    // from (`adr:0016` makes the index the only thing that knows where a page
    // sits, so the correct implementation is also the confined one).
    const ref = listPages(projectRoot).find((p) => p.slug === slug);
    if (!ref) return { ok: false, error: `no page "${slug}" in this wiki` };
    const file = assertWithin(projectRoot, join(projectRoot, ref.path));
    if (!existsSync(file)) return { ok: false, error: `no page "${slug}" in this wiki` };
    return { ok: true, result: readFileSync(file, "utf8") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** One JSON object per line, in and out — the framing the recorder uses too. */
function encode(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

/**
 * Listen for queries about this project. Returns something the window closes
 * when it does — a server left behind answers about a project nobody has open.
 */
export function serveQueries(projectRoot: string): Server {
  const server = createServer((socket) => {
    let buffered = "";
    socket.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      let newline = buffered.indexOf("\n");
      while (newline >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (line.trim()) {
          let response: SocketResponse;
          try {
            response = handleRequest(projectRoot, JSON.parse(line) as SocketRequest);
          } catch {
            response = { ok: false, error: "that is not a request" };
          }
          socket.write(encode(response));
        }
        newline = buffered.indexOf("\n");
      }
    });
    // A client that vanished mid-request is ordinary, not an error worth
    // taking the main process down for.
    socket.on("error", () => socket.destroy());
  });
  server.on("error", () => {});
  const path = socketPath(projectRoot);
  // A stale socket file from a process that was killed would otherwise make
  // every later listen fail with EADDRINUSE.
  if (process.platform !== "win32" && existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      /* nothing listening and nothing to remove */
    }
  }
  server.listen(path);
  return server;
}

/**
 * Ask the running application, or answer `null` when there is none.
 *
 * Every failure — nothing listening, a stale pipe, a timeout, a response that
 * is not JSON — reads as "no application", because the caller's fallback is
 * correct in all of them and slower in none that matter.
 */
export function askRunningApp(
  projectRoot: string,
  request: SocketRequest,
  timeoutMs = 300,
): Promise<SocketResponse | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: SocketResponse | null): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    const socket = createConnection(socketPath(projectRoot));
    // Short: the whole point is to be faster than starting a process, so a
    // socket that is slow to answer has already lost its reason to exist.
    socket.setTimeout(timeoutMs, () => done(null));
    socket.on("error", () => done(null));
    socket.on("connect", () => socket.write(encode(request)));

    let buffered = "";
    socket.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const newline = buffered.indexOf("\n");
      if (newline < 0) return;
      try {
        done(JSON.parse(buffered.slice(0, newline)) as SocketResponse);
      } catch {
        done(null);
      }
    });
  });
}
