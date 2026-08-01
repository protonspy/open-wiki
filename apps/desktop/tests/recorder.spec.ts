import { describe, expect, it } from "vitest";
import { RecorderError, RecorderSession, type RecorderTransport } from "../src/main/recorder.js";

/** A transport that records what was sent and lets a test answer it. */
function fakeTransport() {
  const sent: string[] = [];
  let onLine: ((line: string) => void) | null = null;
  let onClose: (() => void) | null = null;
  const transport: RecorderTransport = {
    send: (line) => sent.push(line),
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

  it("refuses a new call once the sidecar has gone", async () => {
    const fake = fakeTransport();
    const session = new RecorderSession(fake.transport);
    fake.die();
    await expect(session.status()).rejects.toThrow(/not running/);
  });

  it("reports a line that is not JSON rather than throwing out of the handler", async () => {
    const fake = fakeTransport();
    const session = new RecorderSession(fake.transport);
    const status = session.status();
    fake.raw("panicked at src/main.rs:1");
    await expect(status).rejects.toThrow(/not JSON/);
  });

  it("ignores an unsolicited line rather than resolving the next request with it", () => {
    const fake = fakeTransport();
    new RecorderSession(fake.transport);
    expect(() => fake.answer({ ok: true })).not.toThrow();
  });
});
