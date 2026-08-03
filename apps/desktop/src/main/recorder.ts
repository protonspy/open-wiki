import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Driving `recorder.exe` (plan 8.2, over the contract 4.5 defines).
 *
 * One JSON object per line in each direction — a framing a test can drive with
 * a string and a person can drive by typing
 * (`adr:0005-wasapi-capture-in-a-minimal-sidecar`). Requests are answered in
 * order, so this keeps one queue and resolves the head on each line rather
 * than correlating by id: the sidecar has six methods and no notion of
 * concurrency, and inventing correlation here would imply one.
 */

export type RecorderMethod = "start" | "pause" | "resume" | "stop" | "status" | "devices";

/** One endpoint the machine offers (R1.1). */
export interface RecorderDevice {
  /** The endpoint's own identifier — stable, and meaningless off this machine. */
  id: string;
  /** For a person to read. Not stable: Windows renames endpoints on a driver update. */
  name: string;
  /** `capture` for a microphone, `loopback` for what the machine is playing. */
  kind: "capture" | "loopback";
  /** Whether Windows currently prefers it for that direction. */
  default: boolean;
}

/** What one track is hearing right now (R4.1). */
export interface TrackLevel {
  peak: number;
  rms: number;
  /** Literal silence, not a threshold — a quiet room is not a dead microphone. */
  silent: boolean;
}

export interface RecorderStatus {
  state: string;
  recorded_ms: number;
  mic_frames: number;
  system_frames: number;
  pauses: number;
  /**
   * Tracks whose chosen endpoint went away with nothing put in its place
   * (R2.3). A track named here is recording manufactured silence.
   */
  lost_tracks: string[];
  mic_level: TrackLevel;
  system_level: TrackLevel;
}

/** Which endpoint each track should capture, where somebody chose (R1.2). */
export interface ChosenEndpoints {
  mic?: string | undefined;
  system?: string | undefined;
}

const NO_LEVEL: TrackLevel = { peak: 0, rms: 0, silent: true };

/**
 * A status reply, with anything the sidecar did not send filled in.
 *
 * `recorder.exe` is a separate binary that ships with the installer, so one
 * older than this window is an ordinary state rather than an error. A missing
 * level has to read as *no signal* — never as `undefined` reaching a meter,
 * and never as `false` for `silent`, which would claim a dead track is fine.
 */
export function statusFrom(payload: Record<string, unknown>): RecorderStatus {
  const level = (raw: unknown): TrackLevel => {
    if (typeof raw !== "object" || raw === null) return NO_LEVEL;
    const it = raw as Record<string, unknown>;
    return {
      peak: typeof it["peak"] === "number" ? it["peak"] : 0,
      rms: typeof it["rms"] === "number" ? it["rms"] : 0,
      silent: typeof it["silent"] === "boolean" ? it["silent"] : true,
    };
  };
  const lost = payload["lost_tracks"];
  return {
    state: String(payload["state"] ?? "idle"),
    recorded_ms: Number(payload["recorded_ms"] ?? 0),
    mic_frames: Number(payload["mic_frames"] ?? 0),
    system_frames: Number(payload["system_frames"] ?? 0),
    pauses: Number(payload["pauses"] ?? 0),
    lost_tracks: Array.isArray(lost) ? lost.map(String) : [],
    mic_level: level(payload["mic_level"]),
    system_level: level(payload["system_level"]),
  };
}

/**
 * The endpoints in a `devices` reply, as objects (R1.1).
 *
 * This used to flatten each entry to its `name`, which is why nothing above it
 * could offer a choice: a name is not what an endpoint is opened by, and
 * Windows renames them on a driver update.
 */
export function devicesFrom(payload: Record<string, unknown>): RecorderDevice[] {
  const raw = payload["devices"];
  if (!Array.isArray(raw)) return [];
  const out: RecorderDevice[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const it = item as Record<string, unknown>;
    const id = it["id"];
    const kind = it["kind"];
    // An endpoint with no identifier cannot be chosen, and one of an unknown
    // direction cannot be offered for either track. Dropping it beats
    // presenting something nothing can act on.
    if (typeof id !== "string" || id === "") continue;
    if (kind !== "capture" && kind !== "loopback") continue;
    out.push({
      id,
      name: typeof it["name"] === "string" && it["name"] !== "" ? it["name"] : id,
      kind,
      default: it["default"] === true,
    });
  }
  return out;
}

export class RecorderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecorderError";
  }
}

/** The transport, so a test drives the protocol without a Windows binary. */
export interface RecorderTransport {
  send(line: string): void;
  onLine(handler: (line: string) => void): void;
  onClose(handler: () => void): void;
  close(): void;
  /** Whatever the sidecar said on the way out, for the message. */
  stderr?(): string;
}

export function resolveRecorder(repoRoot = defaultRepoRoot()): string {
  const override = process.env["OPEN_WIKI_RECORDER"];
  if (override && existsSync(override)) return override;
  // Beside the application when packaged; in `target/release` in a checkout.
  for (const candidate of [
    join(repoRoot, "recorder.exe"),
    join(repoRoot, "target", "release", "recorder.exe"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new RecorderError(
    "recorder.exe was not found. It ships with the installer; in a checkout run " +
      "`cargo build --release`.",
  );
}

function defaultRepoRoot(): string {
  return resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");
}

/**
 * `args` exists so a test can stand another executable in for the sidecar and
 * drive the framing — which is the half of this module that has nothing to do
 * with audio. The recorder itself takes none.
 */
export function spawnTransport(exe: string, args: readonly string[] = []): RecorderTransport {
  const child: ChildProcessWithoutNullStreams = spawn(exe, [...args], { windowsHide: true });
  let buffered = "";
  let stderr = "";
  const lineHandlers: Array<(line: string) => void> = [];
  const closeHandlers: Array<() => void> = [];

  child.stdout.on("data", (chunk: Buffer) => {
    buffered += chunk.toString("utf8");
    let newline = buffered.indexOf("\n");
    while (newline >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (line) for (const handler of lineHandlers) handler(line);
      newline = buffered.indexOf("\n");
    }
  });

  // Drained and bounded. A pipe nobody reads blocks the child once the OS
  // buffer fills, which is how a sidecar that panicked hangs instead of
  // exiting — and the panic message is the only thing that says why.
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-8192);
  });

  // Both of these are unhandled-error crashes in the Electron **main**
  // process, which takes the whole application down. `error` fires when the
  // binary could not be started at all — a path that went stale between the
  // `existsSync` above and here. `EPIPE` fires on writing to a child that has
  // already gone, which is what the next call after a crash does.
  const die = (): void => {
    for (const handler of closeHandlers) handler();
    closeHandlers.length = 0;
  };
  child.on("error", die);
  child.stdin.on("error", () => {});
  child.on("close", die);

  return {
    send: (line) => child.stdin.write(`${line}\n`),
    onLine: (handler) => lineHandlers.push(handler),
    onClose: (handler) => closeHandlers.push(handler),
    close: () => child.kill(),
    stderr: () => stderr,
  };
}

interface Pending {
  resolve: (payload: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

/**
 * A live recording session. One per window: two would fight over the
 * microphone, and the second would silently get nothing.
 */
export class RecorderSession {
  private readonly queue: Pending[] = [];
  private closed = false;

  /**
   * The last thing the sidecar said before any request. `recorder.exe` writes
   * a device-open failure and exits before it reads anything, so that one line
   * is the whole explanation — and dropping it leaves the user with "the
   * recorder stopped unexpectedly" instead of "microphone: …".
   */
  private unsolicited: string | null = null;

  constructor(private readonly transport: RecorderTransport) {
    transport.onLine((line) => this.receive(line));
    transport.onClose(() => {
      this.closed = true;
      // Anything still waiting will never be answered. Rejecting is what turns
      // a sidecar that died into an error on screen rather than a button that
      // stays spinning.
      const why = this.reasonItDied();
      while (this.queue.length > 0) {
        this.queue.shift()?.reject(new RecorderError(why));
      }
    });
  }

  private reasonItDied(): string {
    const said = this.unsolicited ?? this.transport.stderr?.().trim();
    return said ? `the recorder stopped: ${said}` : "the recorder stopped unexpectedly";
  }

  private receive(line: string): void {
    const pending = this.queue.shift();
    if (!pending) {
      // Not an answer to anything. Kept rather than dropped, because it is
      // usually the reason the next call is about to fail.
      this.unsolicited = errorIn(line) ?? line;
      return;
    }
    let parsed: { ok?: boolean; error?: string } & Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as typeof parsed;
    } catch {
      pending.reject(new RecorderError(`the recorder answered with something that is not JSON`));
      return;
    }
    if (parsed.ok === false) {
      pending.reject(new RecorderError(parsed.error ?? "the recorder refused"));
      return;
    }
    pending.resolve(parsed);
  }

  call(
    method: RecorderMethod,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new RecorderError(this.reasonItDied()));
    return new Promise((resolvePromise, rejectPromise) => {
      const pending: Pending = { resolve: resolvePromise, reject: rejectPromise };
      this.queue.push(pending);
      try {
        this.transport.send(JSON.stringify({ method, ...params }));
      } catch (e) {
        // The entry has to come back out. Left in, it would be resolved by the
        // *next* response, and every call after this one would be answered by
        // the one before it — a desynchronisation nothing downstream could
        // detect.
        const at = this.queue.indexOf(pending);
        if (at >= 0) this.queue.splice(at, 1);
        rejectPromise(e instanceof Error ? e : new RecorderError(String(e)));
      }
    });
  }

  /**
   * `title` is what 4.16 builds the source id from; `dir` is where it writes.
   *
   * `endpoints` names which endpoint each track captures (R1.2). Omitting
   * either follows the Windows default (R1.3) — and a chosen endpoint that is
   * not on this machine refuses the recording by name (R2.4) rather than
   * quietly recording the default in its place.
   */
  async start(title: string, dir: string, endpoints: ChosenEndpoints = {}): Promise<void> {
    const params: Record<string, unknown> = { title, dir };
    if (endpoints.mic) params["mic"] = endpoints.mic;
    if (endpoints.system) params["system"] = endpoints.system;
    await this.call("start", params);
  }

  async pause(): Promise<void> {
    await this.call("pause");
  }

  async resume(): Promise<void> {
    await this.call("resume");
  }

  async stop(): Promise<void> {
    await this.call("stop");
  }

  async status(): Promise<RecorderStatus> {
    return statusFrom(await this.call("status"));
  }

  /** Every endpoint the machine offers, as objects rather than names (R1.1). */
  async devices(): Promise<RecorderDevice[]> {
    return devicesFrom(await this.call("devices"));
  }

  /** True once the sidecar has gone, so a window can drop its reference. */
  get isClosed(): boolean {
    return this.closed;
  }

  dispose(): void {
    // Set before closing, not after: `close()` on a transport that has already
    // exited may never fire another event, and a session that still thinks it
    // is live queues calls into a dead pipe.
    this.closed = true;
    this.transport.close();
  }
}

/** The `error` field of an `{"ok":false}` line, if that is what it is. */
function errorIn(line: string): string | null {
  try {
    const parsed = JSON.parse(line) as { ok?: boolean; error?: unknown };
    if (parsed.ok === false && typeof parsed.error === "string") return parsed.error;
  } catch {
    // Not JSON at all — a panic, say. The whole line is the explanation.
  }
  return null;
}
