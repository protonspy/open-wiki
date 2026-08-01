import { describe, expect, it } from "vitest";
import { RecorderError, RecorderSession, type RecorderTransport } from "../src/main/recorder.js";

/** A transport that records what was sent and lets a test answer it. */
function fakeTransport() {
  const sent: string[] = [];
  let onLine: ((line: string) => void) | null = null;
  let onClose: (() => void) | null = null;
  let refuse = false;
  const transport: RecorderTransport = {
    send: (line) => {
      if (refuse) {
        refuse = false;
        throw new Error("EPIPE: the pipe is closed");
      }
      sent.push(line);
    },
    onLine: (handler) => (onLine = handler),
    onClose: (handler) => (onClose = handler),
    close: () => onClose?.(),
  };
  return {
    transport,
    sent,
    answer: (payload: unknown) => onLine?.(JSON.stringify(payload)),
    raw: (line: string) => onLine?.(line),
    die: () => onClose?.(),
    refuseNextSend: () => (refuse = true),
  };
}

describe("RecorderSession (8.2, over the contract 4.5 defines)", () => {
  it("sends one JSON object per line", async () => {
    const fake = fakeTransport();
    const session = new RecorderSession(fake.transport);
    const started = session.start("Fenix weekly", "C:/p/raw/weekly");
    fake.answer({ ok: true, done: true });
    await started;
    expect(JSON.parse(fake.sent[0]!)).toEqual({
      method: "start",
      title: "Fenix weekly",
      dir: "C:/p/raw/weekly",
    });
  });

  it("carries each of the six methods", async () => {
    const fake = fakeTransport();
    const session = new RecorderSession(fake.transport);
    for (const call of [
      session.pause(),
      session.resume(),
      session.stop(),
      session.status(),
      session.devices(),
    ]) {
      fake.answer({ ok: true, state: "idle", recorded_ms: 0, devices: [] });
      await call;
    }
    expect(fake.sent.map((line) => JSON.parse(line).method)).toEqual([
      "pause",
      "resume",
      "stop",
      "status",
      "devices",
    ]);
  });

  it("answers requests in the order they were sent", async () => {
    // The sidecar has six methods and no notion of concurrency; inventing
    // correlation here would imply one.
    const fake = fakeTransport();
    const session = new RecorderSession(fake.transport);
    const first = session.status();
    const second = session.status();
    fake.answer({ ok: true, state: "recording", recorded_ms: 1 });
    fake.answer({ ok: true, state: "paused", recorded_ms: 2 });
    expect((await first).state).toBe("recording");
    expect((await second).state).toBe("paused");
  });

  it("turns a refusal into an error carrying the reason", async () => {
    const fake = fakeTransport();
    const session = new RecorderSession(fake.transport);
    const stopping = session.stop();
    fake.answer({ ok: false, error: "not recording" });
    await expect(stopping).rejects.toThrow(/not recording/);
  });

  it("reads a status payload", async () => {
    const fake = fakeTransport();
    const session = new RecorderSession(fake.transport);
    const status = session.status();
    fake.answer({
      ok: true,
      state: "recording",
      recorded_ms: 4200,
      mic_frames: 1,
      system_frames: 2,
      pauses: 0,
    });
    expect(await status).toMatchObject({ state: "recording", recorded_ms: 4200 });
  });

  it("reads the device list", async () => {
    const fake = fakeTransport();
    const session = new RecorderSession(fake.transport);
    const devices = session.devices();
    fake.answer({ ok: true, devices: [{ name: "Headset" }, { name: "Speakers" }] });
    expect(await devices).toEqual(["Headset", "Speakers"]);
  });

  it("rejects what is waiting when the sidecar dies", async () => {
    // Otherwise the button stays spinning and nothing on screen says why.
    const fake = fakeTransport();
    const session = new RecorderSession(fake.transport);
    const stopping = session.stop();
    fake.die();
    await expect(stopping).rejects.toThrow(RecorderError);
  });

  it("refuses a new call once the sidecar has gone, saying why it went", async () => {
    const fake = fakeTransport();
    const session = new RecorderSession(fake.transport);
    fake.die();
    await expect(session.status()).rejects.toThrow(/stopped/);
  });

  it("reports a line that is not JSON rather than throwing out of the handler", async () => {
    const fake = fakeTransport();
    const session = new RecorderSession(fake.transport);
    const status = session.status();
    fake.raw("panicked at src/main.rs:1");
    await expect(status).rejects.toThrow(/not JSON/);
  });

  it("does not answer a pending request with a line that arrived before it", async () => {
    // The queue is FIFO with no correlation, so a line delivered while nothing
    // is waiting must not be held and applied to whatever asks next.
    const fake = fakeTransport();
    const session = new RecorderSession(fake.transport);
    fake.answer({ ok: true, state: "recording", recorded_ms: 999 });

    const status = session.status();
    let settled = false;
    void status.then(
      () => (settled = true),
      () => (settled = true),
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    fake.answer({ ok: true, state: "idle", recorded_ms: 0 });
    expect((await status).state).toBe("idle");
  });

  it("keeps what the sidecar said on its way out, and says it", async () => {
    // `recorder.exe` writes a device-open failure and exits before it reads
    // anything. Dropping that line leaves the user with "stopped unexpectedly"
    // instead of "microphone: …".
    const fake = fakeTransport();
    const session = new RecorderSession(fake.transport);
    fake.answer({ ok: false, error: "microphone: no capture device" });
    fake.die();
    await expect(session.status()).rejects.toThrow(/no capture device/);
  });

  it("does not desynchronise when the transport refuses to send", async () => {
    // An entry left in the queue would be resolved by the *next* response, and
    // every call after it answered by the one before — undetectable downstream.
    const fake = fakeTransport();
    const session = new RecorderSession(fake.transport);
    fake.refuseNextSend();
    await expect(session.pause()).rejects.toThrow(/pipe/);

    const status = session.status();
    fake.answer({ ok: true, state: "recording", recorded_ms: 7 });
    expect((await status).recorded_ms).toBe(7);
  });

  it("refuses a call made after it was disposed", async () => {
    // `close()` on a transport that has already exited may never fire another
    // event, and a session that still thinks it is live queues into a dead pipe.
    const fake = fakeTransport();
    const session = new RecorderSession(fake.transport);
    session.dispose();
    expect(session.isClosed).toBe(true);
    await expect(session.status()).rejects.toThrow(RecorderError);
  });
});
