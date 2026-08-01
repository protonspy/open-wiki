import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createGroqProvider,
  createProvider,
  createWhisperCppProvider,
  FLAC_16K,
  GROQ_MODEL,
  InsecureEndpointError,
  MAX_PROMPT_CHARS,
  MissingCredentialError,
  MissingWhisperPathError,
  parseVerboseJson,
  parseWhisperJson,
  SttError,
  toIso639,
  vocabularyPrompt,
  WAV_16K,
  WhisperCppMissingError,
  type FetchLike,
  type SpawnLike,
  type SttProvider,
} from "../src/stt/index.js";

const SECOND = 1_000_000_000;

/** A `fetch` that answers with the given JSON and records what it was sent. */
function fakeFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const doFetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { doFetch, calls };
}

function formOf(init: RequestInit): FormData {
  return init.body as FormData;
}

describe("vocabularyPrompt (4.10)", () => {
  it("joins the names into one prompt both providers can take", () => {
    expect(vocabularyPrompt(["Fenix", "Mateus"])).toBe("Mateus, Fenix");
  });

  it("is empty when the project has no names yet", () => {
    expect(vocabularyPrompt([])).toBe("");
    expect(vocabularyPrompt(["  "])).toBe("");
  });
  it("puts the best names last, because the window keeps the end", () => {
    // Whisper reads only its last 224 tokens. A list ordered best-first puts
    // the name that matters exactly where it is dropped.
    expect(vocabularyPrompt(["Fenix", "Mateus Andrade"])).toBe("Mateus Andrade, Fenix");
  });

  it("spends the character budget on the best names", () => {
    const prompt = vocabularyPrompt(["Fenix", "Mateus Andrade", "Someone Else"], 20);
    expect(prompt).toContain("Fenix");
    expect(prompt.length).toBeLessThanOrEqual(20);
  });

  it("bounds one absurd name rather than sending it whole", () => {
    // A page in a project that arrived by clone. Unbounded, it is a megabyte
    // of form field on the upload and past Windows' argv limit locally.
    const prompt = vocabularyPrompt(["x".repeat(100_000), "Fenix"]);
    expect(prompt.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    expect(prompt).toContain("Fenix");
  });

  it("bounds the whole prompt", () => {
    const many = Array.from({ length: 5000 }, (_, i) => `name${i}`);
    expect(vocabularyPrompt(many).length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
  });
});

describe("toIso639", () => {
  it("drops the region, which Whisper's language field does not take", () => {
    expect(toIso639("pt-BR")).toBe("pt");
    expect(toIso639("en")).toBe("en");
    expect(toIso639("ES")).toBe("es");
  });
});

describe("the Groq provider (4.8, 4.15)", () => {
  const body = {
    text: "bom dia",
    segments: [{ start: 1.5, end: 2.25, text: " bom dia " }],
  };

  async function transcribeWith(provider: SttProvider, vocabulary: string[] = []) {
    return provider.transcribe({
      audio: new Uint8Array([1, 2, 3]),
      filename: "chunk-0.flac",
      language: "pt-BR",
      vocabulary,
    });
  }

  it("sends the configured language rather than leaving it to detection", async () => {
    // `adr:0008`. A provider guessing from thirty seconds of a Portuguese
    // meeting that opened in English gets it wrong for the whole chunk, and
    // nothing downstream can tell.
    const { doFetch, calls } = fakeFetch(body);
    await transcribeWith(createGroqProvider({ apiKey: "k", fetch: doFetch }));
    expect(formOf(calls[0]!.init).get("language")).toBe("pt");
  });

  it("sends the project's names as the prompt", async () => {
    const { doFetch, calls } = fakeFetch(body);
    await transcribeWith(createGroqProvider({ apiKey: "k", fetch: doFetch }), ["Fenix"]);
    expect(formOf(calls[0]!.init).get("prompt")).toBe("Fenix");
  });

  it("omits the prompt entirely when there are no names", async () => {
    const { doFetch, calls } = fakeFetch(body);
    await transcribeWith(createGroqProvider({ apiKey: "k", fetch: doFetch }));
    expect(formOf(calls[0]!.init).get("prompt")).toBeNull();
  });

  it("puts the key in a header, never in the body or the URL", async () => {
    const { doFetch, calls } = fakeFetch(body);
    await transcribeWith(createGroqProvider({ apiKey: "sk-secret", fetch: doFetch }));
    expect((calls[0]!.init.headers as Record<string, string>)["authorization"]).toBe(
      "Bearer sk-secret",
    );
    expect(calls[0]!.url).not.toContain("sk-secret");
    expect(formOf(calls[0]!.init).get("prompt")).not.toBe("sk-secret");
  });

  it("asks for the verbose format, which is the one with timings in it", async () => {
    const { doFetch, calls } = fakeFetch(body);
    await transcribeWith(createGroqProvider({ apiKey: "k", fetch: doFetch }));
    expect(formOf(calls[0]!.init).get("response_format")).toBe("verbose_json");
    expect(formOf(calls[0]!.init).get("model")).toBe(GROQ_MODEL);
  });

  it("wants FLAC, because 15 minutes of PCM does not fit under the upload cap", () => {
    expect(createGroqProvider({ apiKey: "k" }).audioFormat).toBe(FLAC_16K);
  });

  it("retries a rate limit and then succeeds", async () => {
    let attempt = 0;
    const doFetch: FetchLike = async () => {
      attempt += 1;
      if (attempt === 1) return new Response("slow down", { status: 429 });
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const provider = createGroqProvider({ apiKey: "k", fetch: doFetch, sleep: async () => {} });
    await expect(transcribeWith(provider)).resolves.toMatchObject({ text: "bom dia" });
    expect(attempt).toBe(2);
  });

  it("does not retry a rejected credential, which would fail identically three times", async () => {
    let attempt = 0;
    const doFetch: FetchLike = async () => {
      attempt += 1;
      return new Response("bad key", { status: 401 });
    };
    const provider = createGroqProvider({ apiKey: "k", fetch: doFetch, sleep: async () => {} });
    await expect(transcribeWith(provider)).rejects.toThrow(SttError);
    expect(attempt).toBe(1);
  });

  it("retries a network failure, which is the one adr:0012 names", async () => {
    // A `fetch` that rejects — DNS, ECONNRESET, TLS, a timeout — throws a
    // TypeError, not an SttError. Retrying only on errors this module raised
    // itself gave a 503 three attempts and the most common failure one.
    let attempt = 0;
    const doFetch: FetchLike = async () => {
      attempt += 1;
      if (attempt === 1) throw new TypeError("fetch failed");
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const provider = createGroqProvider({ apiKey: "k", fetch: doFetch, sleep: async () => {} });
    await expect(transcribeWith(provider)).resolves.toMatchObject({ text: "bom dia" });
    expect(attempt).toBe(2);
  });

  it("bounds how long one attempt may take", async () => {
    let signal: AbortSignal | undefined;
    const doFetch: FetchLike = async (_url, init) => {
      signal = init.signal ?? undefined;
      return new Response(JSON.stringify(body), { status: 200 });
    };
    await transcribeWith(createGroqProvider({ apiKey: "k", fetch: doFetch }));
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("does not follow a redirect, whatever fetch would have done with the header", async () => {
    let init: RequestInit | undefined;
    const doFetch: FetchLike = async (_url, i) => {
      init = i;
      return new Response(JSON.stringify(body), { status: 200 });
    };
    await transcribeWith(createGroqProvider({ apiKey: "k", fetch: doFetch }));
    expect(init?.redirect).toBe("error");
  });

  it("refuses to send the credential over plain http", () => {
    expect(() => createGroqProvider({ apiKey: "k", baseUrl: "http://example.test/v1" })).toThrow(
      InsecureEndpointError,
    );
  });

  it("gives up after the configured number of attempts", async () => {
    let attempt = 0;
    const doFetch: FetchLike = async () => {
      attempt += 1;
      return new Response("busy", { status: 503 });
    };
    const provider = createGroqProvider({
      apiKey: "k",
      fetch: doFetch,
      attempts: 2,
      sleep: async () => {},
    });
    await expect(transcribeWith(provider)).rejects.toThrow(/503/);
    expect(attempt).toBe(2);
  });
});

describe("parseVerboseJson", () => {
  it("turns the provider's seconds into this package's nanoseconds", () => {
    const result = parseVerboseJson({
      text: "hi",
      segments: [{ start: 1.5, end: 2.25, text: "hi" }],
    });
    expect(result.segments).toEqual([{ startNs: 1.5 * SECOND, endNs: 2.25 * SECOND, text: "hi" }]);
  });

  it("trims the padding Whisper puts around every segment", () => {
    const result = parseVerboseJson({ segments: [{ start: 0, end: 1, text: "  spaced  " }] });
    expect(result.segments[0]!.text).toBe("spaced");
  });

  it("drops a segment with no words in it", () => {
    const result = parseVerboseJson({ text: "", segments: [{ start: 0, end: 1, text: "  " }] });
    expect(result.segments).toEqual([]);
  });

  it("builds the whole text from the segments when the provider gave none", () => {
    const result = parseVerboseJson({
      segments: [
        { start: 0, end: 1, text: "one" },
        { start: 1, end: 2, text: "two" },
      ],
    });
    expect(result.text).toBe("one two");
  });

  it("survives an answer with nothing in it", () => {
    expect(parseVerboseJson({})).toEqual({ segments: [], text: "" });
  });
});

describe("parseWhisperJson", () => {
  it("reads whisper.cpp's millisecond offsets", () => {
    const result = parseWhisperJson({
      transcription: [{ offsets: { from: 1500, to: 2250 }, text: " bom dia " }],
    });
    expect(result.segments).toEqual([
      { startNs: 1.5 * SECOND, endNs: 2.25 * SECOND, text: "bom dia" },
    ]);
  });

  it("survives an answer with nothing in it", () => {
    expect(parseWhisperJson({})).toEqual({ segments: [], text: "" });
  });
});

describe("createWhisperCppProvider", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ow-whisper-test-"));
    writeFileSync(join(dir, "whisper-cli.exe"), "");
    writeFileSync(join(dir, "ggml-large-v3-turbo.bin"), "");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** whisper.cpp writing its `-oj` output where it was told to. */
  function localRun(json: unknown, code = 0): SpawnLike {
    return async (_exe, args) => {
      const stem = args[args.indexOf("-of") + 1]!;
      if (code === 0) writeFileSync(`${stem}.json`, JSON.stringify(json), "utf8");
      return { code, stderr: code === 0 ? "" : "whisper: failed" };
    };
  }

  function local(run: SpawnLike) {
    return createWhisperCppProvider({
      exe: join(dir, "whisper-cli.exe"),
      modelPath: join(dir, "ggml-large-v3-turbo.bin"),
      run,
    });
  }

  const request = {
    audio: new Uint8Array([1, 2, 3]),
    filename: "chunk-0.wav",
    language: "pt-BR",
    vocabulary: ["Fenix"],
  };

  it("refuses clearly when the binary is not installed", () => {
    expect(() =>
      createWhisperCppProvider({
        exe: "C:/nowhere/whisper-cli.exe",
        modelPath: "C:/nowhere/model.bin",
        run: async () => ({ code: 0, stderr: "" }),
      }),
    ).toThrow(WhisperCppMissingError);
  });

  it("refuses clearly when the model is not there", () => {
    expect(() =>
      createWhisperCppProvider({
        exe: join(dir, "whisper-cli.exe"),
        modelPath: "C:/nowhere/model.bin",
        run: async () => ({ code: 0, stderr: "" }),
      }),
    ).toThrow(/model/);
  });

  it("wants WAV, which is what it reads natively", () => {
    expect(WAV_16K.extension).toBe("wav");
    expect(WAV_16K.ffmpegArgs).toContain("pcm_s16le");
  });

  it("reports the model file's name, not its path", () => {
    // The path is somebody's home directory. The name is what 4.17 compares to
    // decide whether a resume is the same work.
    expect(local(localRun({})).model).toBe("ggml-large-v3-turbo.bin");
  });

  it("reads back what whisper.cpp wrote", async () => {
    const result = await local(
      localRun({ transcription: [{ offsets: { from: 1500, to: 2250 }, text: " bom dia " }] }),
    ).transcribe(request);
    expect(result.segments).toEqual([
      { startNs: 1.5 * SECOND, endNs: 2.25 * SECOND, text: "bom dia" },
    ]);
  });

  it("sends the configured language and the project's names", async () => {
    let args: readonly string[] = [];
    const run: SpawnLike = async (_exe, a) => {
      args = a;
      writeFileSync(`${a[a.indexOf("-of") + 1]!}.json`, "{}", "utf8");
      return { code: 0, stderr: "" };
    };
    await local(run).transcribe(request);
    expect(args[args.indexOf("-l") + 1]).toBe("pt");
    expect(args[args.indexOf("--prompt") + 1]).toBe("Fenix");
  });

  it("omits the prompt when the project has no names yet", async () => {
    let args: readonly string[] = [];
    const run: SpawnLike = async (_exe, a) => {
      args = a;
      writeFileSync(`${a[a.indexOf("-of") + 1]!}.json`, "{}", "utf8");
      return { code: 0, stderr: "" };
    };
    await local(run).transcribe({ ...request, vocabulary: [] });
    expect(args).not.toContain("--prompt");
  });

  it("reports a non-zero exit as an error that will not be retried", async () => {
    // A local run that failed will fail again on the same input, so the journal
    // should record it rather than the pipeline spinning on it.
    await expect(local(localRun({}, 2)).transcribe(request)).rejects.toThrow(SttError);
    await expect(local(localRun({}, 2)).transcribe(request)).rejects.toThrow(/exited 2/);
  });

  it("reports a run that wrote nothing", async () => {
    const run: SpawnLike = async () => ({ code: 0, stderr: "" });
    await expect(local(run).transcribe(request)).rejects.toThrow(/no transcription/);
  });

  it("leaves no audio behind on the machine it was keeping it on", async () => {
    let workDir = "";
    const run: SpawnLike = async (_exe, a) => {
      const stem = a[a.indexOf("-of") + 1]!;
      workDir = stem.slice(0, stem.lastIndexOf(sep));
      writeFileSync(`${stem}.json`, "{}", "utf8");
      return { code: 0, stderr: "" };
    };
    await local(run).transcribe(request);
    expect(existsSync(workDir)).toBe(false);
  });
});

describe("createProvider (4.8)", () => {
  const stub: SttProvider = {
    name: "groq",
    model: "m",
    audioFormat: FLAC_16K,
    transcribe: async () => ({ segments: [], text: "" }),
  };

  it("picks Groq from configuration", () => {
    const provider = createProvider({ provider: "groq", apiKey: "k" }, { groq: () => stub });
    expect(provider).toBe(stub);
  });

  it("picks whisper.cpp from configuration", () => {
    const local = { ...stub, name: "whispercpp" as const };
    const provider = createProvider(
      { provider: "whispercpp", whisperExe: "w.exe", whisperModel: "m.bin" },
      { whispercpp: () => local, run: async () => ({ code: 0, stderr: "" }) },
    );
    expect(provider.name).toBe("whispercpp");
  });

  it("refuses Groq with no credential, and says the local provider needs none", () => {
    expect(() => createProvider({ provider: "groq" })).toThrow(MissingCredentialError);
    expect(() => createProvider({ provider: "groq" })).toThrow(/whisper\.cpp/);
  });

  it("refuses whisper.cpp with no paths, because neither is bundled", () => {
    expect(() => createProvider({ provider: "whispercpp" })).toThrow(MissingWhisperPathError);
  });

  it("passes a configured model through", () => {
    let seen = "";
    createProvider(
      { provider: "groq", apiKey: "k", model: "whisper-large-v3" },
      {
        groq: (o) => {
          seen = o.model ?? "";
          return stub;
        },
      },
    );
    expect(seen).toBe("whisper-large-v3");
  });
});
