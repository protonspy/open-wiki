import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createConnection, createServer, type Server } from "node:net";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkProject } from "./check/checks.js";
import { defaultAppDataDir } from "./config/app-dir.js";
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
 * **Both directions are authenticated, because the endpoint name is not a
 * secret.** It is a hash of a directory path — obscure, and a local process
 * guesses or enumerates it. Whoever is listening could otherwise feed the CLI
 * text that is printed as trusted wiki content into an agent's context, which
 * is the whole prize. So the server writes a random token into the
 * application's own data directory (0600, in a 0700 directory) and requires it
 * on every request, and answers with an HMAC over the client's nonce so the
 * client can tell the real application from something that squatted the name
 * first. Both reduce the reachable set to "a process already running as this
 * user with read access to their profile" — which is the boundary the project
 * directory itself sits behind.
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

/** What actually goes over the wire — the request plus what proves the peer. */
interface WireRequest extends SocketRequest {
  token: string;
  nonce: string;
}

export type SocketResponse = { ok: true; result: unknown } | { ok: false; error: string };

/** A response carries the proof the client checks; `askRunningApp` strips it. */
type WireResponse = SocketResponse & { mac?: string };

export interface SocketOptions {
  /** Overridable so a test does not write into the real profile. */
  appDataDir?: string;
}

/**
 * A line longer than this is not a request.
 *
 * Without it either side buffers whatever the peer sends until the process
 * dies — and the server side is the Electron main process, which is the window
 * the user is looking at.
 */
export const MAX_LINE_BYTES = 64 * 1024;

/** More than this many at once is not a CLI asking a question. */
const MAX_CONNECTIONS = 8;

/**
 * The identity of a project, for naming its endpoint.
 *
 * Normalised first, and that is not cosmetic: the desktop passes whatever
 * `resolveProject` produced and the CLI passes `process.cwd()`, and on Windows
 * those routinely differ in drive-letter case or by a junction for the same
 * directory. Every such difference used to hash to a different pipe, so the
 * optimisation silently did not fire and nothing said so.
 */
export function projectKey(projectRoot: string): string {
  let normalised = resolve(projectRoot);
  try {
    normalised = realpathSync(normalised);
  } catch {
    /* not there yet, or not readable — the resolved form is the best we have */
  }
  if (process.platform === "win32") normalised = normalised.toLowerCase();
  return createHash("sha256").update(normalised).digest("hex").slice(0, 16);
}

/** Where the token and (off Windows) the socket file live. 0700, always. */
function endpointDir(options: SocketOptions = {}): string {
  const dir = join(options.appDataDir ?? defaultAppDataDir(), "sockets");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * The pipe a project's application listens on.
 *
 * A hash of the path rather than the path itself, for the reason `secrets.ts`
 * hashes it too: a pipe name is visible to every process on the machine, and
 * the path carries somebody's username and the name of what they are working
 * on. Windows named pipes are the only form that works on the platform this
 * product supports; elsewhere it is a filesystem socket, which is what makes
 * this testable off Windows — and it goes in the application's own 0700
 * directory rather than `/tmp`, which is world-writable and therefore
 * squattable by any local account.
 */
export function socketPath(projectRoot: string, options: SocketOptions = {}): string {
  const id = projectKey(projectRoot);
  return process.platform === "win32"
    ? `\\\\.\\pipe\\open-wiki-${id}`
    : join(endpointDir(options), `${id}.sock`);
}

/** The file the server leaves its token in, for a client running as the same user. */
export function tokenFile(projectRoot: string, options: SocketOptions = {}): string {
  return join(endpointDir(options), `${projectKey(projectRoot)}.token`);
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
    // Confined to `wiki/`, not to the project — the same check and the same
    // reason as `packages/mcp/src/tools.ts`: a path that is inside the project
    // but outside the wiki is not a page, and the weaker of two checks in one
    // codebase is the one that is eventually wrong.
    const file = assertWithin(join(projectRoot, "wiki"), join(projectRoot, ref.path));
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

/** Constant time, and false rather than throwing when the lengths differ. */
function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

function macOf(token: string, nonce: string): string {
  return createHmac("sha256", token).update(nonce).digest("hex");
}

/**
 * Listen for queries about this project. Returns something the window closes
 * when it does — a server left behind answers about a project nobody has open.
 *
 * `onError` is called rather than swallowed. A failed bind means either a
 * second window on the same project or something that took the name first, and
 * both are worth saying out loud: the CLI would otherwise be talking to
 * whatever that is, with nothing anywhere indicating this window is not the
 * one answering.
 */
export function serveQueries(
  projectRoot: string,
  options: SocketOptions & { onError?: (error: Error) => void } = {},
): Server {
  const token = randomBytes(32).toString("hex");
  const server = createServer((socket) => {
    let buffered = "";
    socket.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      if (buffered.length > MAX_LINE_BYTES) {
        socket.destroy();
        return;
      }
      let newline = buffered.indexOf("\n");
      while (newline >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (line.trim()) {
          let response: WireResponse;
          try {
            const wire = JSON.parse(line) as WireRequest;
            // Unauthenticated peers get nothing at all — not an error message,
            // which would confirm the endpoint is the real one.
            if (typeof wire.token !== "string" || !sameSecret(wire.token, token)) {
              socket.destroy();
              return;
            }
            response = {
              ...handleRequest(projectRoot, { verb: wire.verb, args: wire.args ?? [] }),
              mac: macOf(token, String(wire.nonce ?? "")),
            };
          } catch {
            socket.destroy();
            return;
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
  server.maxConnections = MAX_CONNECTIONS;

  const onError =
    options.onError ?? ((error: Error) => console.error(`open-wiki: ${error.message}`));
  const file = tokenFile(projectRoot, options);
  server.on("error", (error: Error) => {
    // Whatever the reason, this window is not the one answering. Take the
    // token back so a client reads nothing rather than the wrong thing.
    rmSync(file, { force: true });
    onError(error);
  });
  server.on("close", () => rmSync(file, { force: true }));

  // A live socket at the path is another window's, and removing it would steal
  // its clients; a leftover from a process that was killed makes `listen` fail
  // with EADDRINUSE. Both are reported rather than guessed at — the product is
  // Windows-only, where a named pipe has neither problem, and a silent unlink
  // of a path in a shared directory is how a socket becomes a delete.
  writeFileSync(file, token, { encoding: "utf8", mode: 0o600 });
  server.listen(socketPath(projectRoot, options));
  return server;
}

/**
 * Ask the running application, or answer `null` when there is none.
 *
 * Every failure — no token, nothing listening, a stale pipe, a timeout, a
 * response that is not JSON or does not prove it came from the application —
 * reads as "no application", because the caller's fallback is correct in all of
 * them and slower in none that matter.
 */
export function askRunningApp(
  projectRoot: string,
  request: SocketRequest,
  timeoutMs = 300,
  options: SocketOptions = {},
): Promise<SocketResponse | null> {
  let token: string;
  let path: string;
  try {
    token = readFileSync(tokenFile(projectRoot, options), "utf8").trim();
    path = socketPath(projectRoot, options);
  } catch {
    return Promise.resolve(null); // no application has this project open
  }
  if (!token) return Promise.resolve(null);
  const nonce = randomBytes(16).toString("hex");

  return new Promise((resolve) => {
    let settled = false;
    const done = (value: SocketResponse | null): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    const socket = createConnection(path);
    // Short: the whole point is to be faster than starting a process, so a
    // socket that is slow to answer has already lost its reason to exist.
    socket.setTimeout(timeoutMs, () => done(null));
    socket.on("error", () => done(null));
    socket.on("connect", () => socket.write(encode({ ...request, token, nonce })));

    let buffered = "";
    socket.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      // A peer that answers with megabytes and no newline is not the
      // application, and holding it all first is how it wins anyway.
      if (buffered.length > MAX_LINE_BYTES) {
        done(null);
        return;
      }
      const newline = buffered.indexOf("\n");
      if (newline < 0) return;
      try {
        const { mac, ...response } = JSON.parse(buffered.slice(0, newline)) as WireResponse;
        // Whoever answered has to hold the token too. Without this the CLI
        // prints whatever squatted the endpoint name as wiki content.
        if (typeof mac !== "string" || !sameSecret(mac, macOf(token, nonce))) {
          done(null);
          return;
        }
        done(response as SocketResponse);
      } catch {
        done(null);
      }
    });
  });
}
