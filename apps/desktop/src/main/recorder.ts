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

export interface RecorderStatus {
  state: string;
  recorded_ms: number;
  mic_frames: number;
  system_frames: number;
  pauses: number;
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
  const lineHandlers: Array<(line: string) => void> = [];
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
  return {
    send: (line) => child.stdin.write(`${line}\n`),
    onLine: (handler) => lineHandlers.push(handler),
    onClose: (handler) => child.on("close", handler),
    close: () => child.kill(),
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

  constructor(private readonly transport: RecorderTransport) {
    transport.onLine((line) => this.receive(line));
    transport.onClose(() => {
      this.closed = true;
      // Anything still waiting will never be answered. Rejecting is what turns
      // a sidecar that died into an error on screen rather than a button that
      // stays spinning.
      while (this.queue.length > 0) {
        this.queue.shift()?.reject(new RecorderError("the recorder stopped unexpectedly"));
      }
    });
  }

  private receive(line: string): void {
    const pending = this.queue.shift();
    if (!pending) return;
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
    if (this.closed) return Promise.reject(new RecorderError("the recorder is not running"));
    return new Promise((resolvePromise, rejectPromise) => {
      this.queue.push({ resolve: resolvePromise, reject: rejectPromise });
      this.transport.send(JSON.stringify({ method, ...params }));
    });
  }

  /** `title` is what 4.16 builds the source id from; `dir` is where it writes. */
  async start(title: string, dir: string): Promise<void> {
    await this.call("start", { title, dir });
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
    return (await this.call("status")) as unknown as RecorderStatus;
  }

  async devices(): Promise<string[]> {
    const payload = await this.call("devices");
    const devices = payload["devices"];
    if (!Array.isArray(devices)) return [];
    return devices.map((d) => String((d as { name?: unknown }).name ?? d));
  }

  dispose(): void {
    this.transport.close();
  }
}
