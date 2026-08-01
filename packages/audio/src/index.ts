/**
 * `@open-wiki/audio` — everything between the recorder's WAVs and a
 * transcribable, citable recording (plan 4.6 and 4.7).
 *
 * The pure half is also reachable as `@open-wiki/audio/timemap`, which pulls in
 * no `node:child_process`. That is the entry point `@open-wiki/access` uses to
 * resolve a provenance instant, so the read surface the MCP process imports
 * (plan 9.9) never gains the ability to run a subprocess.
 */
export * from "./atomic.js";
export * from "./chunks.js";
export * from "./compress.js";
export * from "./encode.js";
export * from "./ffmpeg.js";
export * from "./preprocess.js";
export * from "./recording.js";
export * from "./silence.js";
export * from "./timemap.js";
export * from "./absolute.js";
export * from "./journal.js";
export * from "./transcribe.js";
export * from "./stt/index.js";
export * from "./finish.js";
export * from "./recording-text.js";
export * from "./seal.js";
export * from "./timeline.js";
export * from "./vtt.js";
