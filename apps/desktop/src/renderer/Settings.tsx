import { useCallback, useEffect, useState } from "react";
import type { Language } from "@open-wiki/access";
import type { CredentialState } from "../main/settings.js";
import { bridge } from "./bridge.js";
import { LANGUAGES } from "./languages.js";

/**
 * The settings screen: the transcription credential (plan 8.3) and the content
 * language (8.12).
 *
 * **The key is write-only from here.** `credentialState` answers whether one
 * is stored, never what it is — the renderer has no business holding the
 * application's one secret, and a field pre-filled with it would put it in the
 * DOM of a window that renders markdown an agent wrote.
 */

export function Settings(): React.JSX.Element {
  const [credential, setCredential] = useState<CredentialState | null>(null);
  const [language, setLanguageState] = useState<Language | null>(null);
  const [provider, setProvider] = useState<"groq" | "whispercpp">("groq");
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void bridge().credential().then(setCredential);
    void bridge().language().then(setLanguageState);
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    if (credential?.provider) setProvider(credential.provider);
  }, [credential?.provider]);

  const save = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await bridge().saveCredential({
        provider,
        ...(provider === "groq" ? { apiKey: key } : {}),
      });
      // The key never comes back and is not kept here either.
      setKey("");
      setStatus(result.ok ? "Saved." : result.reason);
      if (result.ok) load();
    } finally {
      setBusy(false);
    }
  }, [key, load, provider]);

  const changeLanguage = useCallback(async (next: Language) => {
    setLanguageState(await bridge().setLanguage(next));
    // 8.12 regenerates CLAUDE.md, which is what tells the agent what to write
    // in. Saying so is the difference between a setting and a surprise.
    setStatus("Language changed. The project's CLAUDE.md was regenerated.");
  }, []);

  return (
    <div className="settings">
      <section>
        <h2>Transcription</h2>
        <p className="empty">
          {credential?.hasKey
            ? `A ${credential.provider} credential is stored for this project.`
            : credential?.provider === "whispercpp"
              ? "Using whisper.cpp — the audio never leaves this machine."
              : "No provider configured yet."}
        </p>
        <div className="editor__bar">
          <label>
            <input
              type="radio"
              name="provider"
              checked={provider === "groq"}
              onChange={() => setProvider("groq")}
            />{" "}
            Groq
          </label>
          <label>
            <input
              type="radio"
              name="provider"
              checked={provider === "whispercpp"}
              onChange={() => setProvider("whispercpp")}
            />{" "}
            whisper.cpp (local, no credential)
          </label>
        </div>
        {provider === "groq" ? (
          <input
            className="editor__source"
            type="password"
            placeholder="Groq API key"
            value={key}
            autoComplete="off"
            onChange={(event) => setKey(event.target.value)}
          />
        ) : (
          <p className="empty">
            Nothing to configure. Choosing this is how you opt out of the one place this application
            talks to a third party — you supply the binary and the model.
          </p>
        )}
        <div className="editor__bar">
          <button onClick={() => void save()} disabled={busy}>
            {busy ? "Checking…" : "Check and save"}
          </button>
        </div>
      </section>

      <section>
        <h2>Content language</h2>
        <p className="empty">
          What transcription is told to expect, and what the generated CLAUDE.md tells the agent to
          write pages in. The schema itself stays English.
        </p>
        <div className="editor__bar">
          {LANGUAGES.map((option) => (
            <button
              key={option.value}
              aria-current={language === option.value}
              onClick={() => void changeLanguage(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      {status ? <p className="empty">{status}</p> : null}
    </div>
  );
}
