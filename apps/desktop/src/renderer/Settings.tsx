import { useCallback, useEffect, useState } from "react";
import type { Language } from "@open-wiki/access";
import type { CredentialState } from "../main/settings.js";
import type { AgentPrefs } from "../main/agent/agent-prefs.js";
import { bridge } from "./bridge.js";
import { LANGUAGES } from "./languages.js";

/**
 * The settings screen: the transcription credential (plan 8.3), the content
 * language (8.12), and the embedded agent's model (specs/embedded-agent, R2.5).
 *
 * **The key is write-only from here.** `credentialState` answers whether one
 * is stored, never what it is — the renderer has no business holding the
 * application's one secret, and a field pre-filled with it would put it in the
 * DOM of a window that renders markdown an agent wrote.
 *
 * The Groq key serves two purposes (R2.4): transcription and the embedded
 * agent. The model list is captured when the key is checked — the validation
 * call doubles as the `/models` fetch (5.4) — so the dropdown below is drawn
 * from what Groq actually offered for this project.
 */

export function Settings(): React.JSX.Element {
  const [credential, setCredential] = useState<CredentialState | null>(null);
  const [language, setLanguageState] = useState<Language | null>(null);
  const [provider, setProvider] = useState<"groq" | "whispercpp">("groq");
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [agent, setAgent] = useState<AgentPrefs | null>(null);

  const load = useCallback(() => {
    void bridge().credential().then(setCredential);
    void bridge().language().then(setLanguageState);
    void bridge().agentModels().then(setAgent);
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

  const pickModel = useCallback(async (model: string) => {
    try {
      const next = await bridge().selectModel(model);
      setAgent(next);
      setStatus(`The agent will use ${model}.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
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
          <>
            <input
              className="editor__source"
              type="password"
              placeholder="Groq API key"
              value={key}
              autoComplete="off"
              onChange={(event) => setKey(event.target.value)}
            />
            {/* R2.4 — the Groq key serves two purposes: transcription and the
                embedded agent. One key, one bill, said once here rather than
                discovered when the Chat pane asks for it. */}
            <p className="empty">
              The same Groq key runs transcription and the embedded agent in the Chat pane — one
              provider, one key, two jobs.
            </p>
          </>
        ) : (
          <p className="empty">
            Nothing to configure. Choosing this is how you opt out of the one place this application
            talks to a third party — you supply the binary and the model. The embedded agent needs a
            Groq key, so the Chat pane is disabled while whisper.cpp is chosen.
          </p>
        )}
        <div className="editor__bar">
          <button onClick={() => void save()} disabled={busy}>
            {busy ? "Checking…" : "Check and save"}
          </button>
        </div>
      </section>

      {/* The agent's model — drawn from the /models list captured when the key
          was checked (R2.5, 5.4). Absent until a Groq credential is saved, which
          is also when the agent can run. */}
      {credential?.provider === "groq" && agent && agent.models.length > 0 ? (
        <section>
          <h2>Chat agent model</h2>
          <p className="empty">
            The model the embedded agent runs. The list is what Groq offered for this project when
            the key was checked.
          </p>
          <div className="editor__bar">
            <select
              className="editor__source"
              value={agent.selectedModel}
              onChange={(e) => void pickModel(e.target.value)}
            >
              {agent.models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>
        </section>
      ) : null}

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
