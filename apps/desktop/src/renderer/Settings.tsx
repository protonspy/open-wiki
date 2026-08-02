import type { Language } from "@open-wiki/access";
import { CircleCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AgentPrefs } from "../main/agent/agent-prefs.js";
import type { CredentialState, SettingsView } from "../main/settings.js";
import { bridge } from "./bridge.js";
import { LANGUAGES } from "./languages.js";
import { Button } from "./ui/Button.js";
import { ICON_SM } from "./ui/icons.js";
import { Segmented } from "./ui/Segmented.js";
import { Switch } from "./ui/Switch.js";

/**
 * The settings sheet (plan 8.3, 8.12, `specs/embedded-agent` R2.5, then
 * desktop-ui 6.1): the transcription credential, the content language, the
 * agent's model, what happens to the WAV — and the two files all of it lives in.
 *
 * **The key is write-only from here.** `credentialState` answers whether one is
 * stored, never what it is: the renderer has no business holding the
 * application's one secret, and a field pre-filled with it would put it in the
 * DOM of a window that renders markdown an agent wrote. The same rule is why
 * the credential file below is shown as a *path* and its contents are not.
 *
 * **Showing the files is the draft's idea, and it is truer here than there.**
 * There is no backend to ask, so support for this application is somebody
 * opening their own configuration. It is two files rather than the draft's one
 * because 2.7 split them: the project's settings are committed and carry no
 * secret, and every secret lives in the application's data directory.
 */
export function Settings(): React.JSX.Element {
  const [credential, setCredential] = useState<CredentialState | null>(null);
  const [view, setView] = useState<SettingsView | null>(null);
  const [provider, setProvider] = useState<"groq" | "whispercpp">("groq");
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [agent, setAgent] = useState<AgentPrefs | null>(null);

  const load = useCallback(() => {
    void bridge().credential().then(setCredential);
    void bridge()
      .settingsView()
      .then(setView)
      .catch(() => setView(null));
    // A rejected call leaves `agent` null, which hides the model section — the
    // same as having no prefs yet. An unhandled rejection here would surface as
    // a console error the user can do nothing about.
    void bridge()
      .agentModels()
      .then(setAgent)
      .catch(() => setAgent(null));
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
      setChecked(result.ok);
      setStatus(result.ok ? null : result.reason);
      if (result.ok) load();
    } finally {
      setBusy(false);
    }
  }, [key, load, provider]);

  const changeLanguage = useCallback(async (next: Language) => {
    await bridge().setLanguage(next);
    // 8.12 regenerates CLAUDE.md, which is what tells the agent what to write
    // in. Saying so is the difference between a setting and a surprise.
    setStatus("Language changed. The project's CLAUDE.md was regenerated.");
    setView(await bridge().settingsView());
  }, []);

  const changeDeleteWav = useCallback(async (on: boolean) => {
    await bridge().setDeleteWav(on);
    setView(await bridge().settingsView());
  }, []);

  const pickModel = useCallback(async (model: string) => {
    try {
      setAgent(await bridge().selectModel(model));
      setStatus(`The agent will use ${model}.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <div className="settings">
      <section className="setting">
        <h4>Content language</h4>
        <p>
          The transcription hint, and what your agent is told to write in. The page schema stays
          English either way.
        </p>
        <Segmented
          label="Content language"
          options={LANGUAGES.map((l) => ({ value: l.value, label: l.label }))}
          value={view?.settings.language ?? null}
          onChange={(next) => void changeLanguage(next)}
        />
      </section>

      <section className="setting">
        <h4>Transcription</h4>
        <p>
          The only credential this application holds. Stored in plain text — any program running as
          you can read it.
        </p>
        <Segmented
          label="Transcription provider"
          options={[
            { value: "groq", label: "Groq" },
            { value: "whispercpp", label: "whisper.cpp, on this machine" },
          ]}
          value={provider}
          onChange={(next) => {
            setProvider(next);
            setChecked(false);
          }}
        />

        {provider === "groq" ? (
          <>
            <div className="key-row">
              <label className="field">
                API key
                <input
                  type="password"
                  placeholder={
                    credential?.hasKey ? "A key is stored — type a new one to replace it" : "gsk_…"
                  }
                  value={key}
                  autoComplete="off"
                  onChange={(event) => setKey(event.target.value)}
                />
              </label>
              <Button onClick={() => void save()} disabled={busy || key === ""}>
                {busy ? "Checking…" : "Check it"}
              </Button>
            </div>
            {checked ? (
              <span className="validated">
                <CircleCheck size={ICON_SM} aria-hidden /> Checked just now — the key works
              </span>
            ) : credential?.hasKey ? (
              <span className="empty">A Groq credential is stored for this project.</span>
            ) : null}
            {/* R2.4 — one key, one bill, two jobs. Said here rather than
                discovered when the Chat pane asks for it. */}
            <p>
              The same Groq key runs transcription and the embedded agent in the Chat pane — one
              provider, one key, two jobs.
            </p>
          </>
        ) : (
          <>
            <p>
              Nothing to configure. Choosing this is how you opt out of the one place this
              application talks to a third party — you supply the binary and the model.
            </p>
            <p>
              The embedded agent needs a Groq key, so the Chat pane is disabled while whisper.cpp is
              chosen.
            </p>
            <div className="key-row">
              <Button onClick={() => void save()} disabled={busy}>
                {busy ? "Checking…" : "Use whisper.cpp"}
              </Button>
            </div>
          </>
        )}
      </section>

      {/* The agent's model — drawn from the /models list captured when the key
          was checked (R2.5, 5.4). Absent until a Groq credential is saved,
          which is also when the agent can run. */}
      {credential?.provider === "groq" && agent && agent.models.length > 0 ? (
        <section className="setting">
          <h4>Chat agent model</h4>
          <p>
            The model the embedded agent runs. The list is what Groq offered for this project when
            the key was checked.
          </p>
          <select
            className="setting__select"
            aria-label="Chat agent model"
            value={agent.selectedModel}
            onChange={(e) => void pickModel(e.target.value)}
          >
            {agent.models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </section>
      ) : null}

      <section className="setting">
        <h4>Keep the WAV after transcribing</h4>
        <p>
          An hour of raw audio is about 690&nbsp;MB. The Opus copy is what citations point at and it
          is kept either way — the WAV buys nothing once the text exists.
        </p>
        <div className="setting__row">
          <span>Delete it once transcription succeeds</span>
          <span className="pane-bar__spacer" />
          <Switch
            label="Delete the WAV once transcription succeeds"
            checked={view?.settings.deleteWavAfterTranscription ?? true}
            disabled={view === null}
            onChange={(on) => void changeDeleteWav(on)}
          />
        </div>
      </section>

      {status ? <p className="empty">{status}</p> : null}

      {view ? <Files view={view} /> : null}
    </div>
  );
}

/**
 * The two files everything above is stored in (6.1).
 *
 * `ow.json` is shown **as it is on disk**: it is committed with the project,
 * its schema is closed, and 2.7 guarantees it holds no secret and no local path
 * — so there is nothing in it to redact and every reason to show it whole.
 *
 * The credential file is shown as a **path only**. Its contents are the one
 * secret this application has, and `credentialState` already refuses to send
 * them over the bridge; printing them here would be the same leak with a nicer
 * frame.
 */
function Files({ view }: { view: SettingsView }): React.JSX.Element {
  return (
    <section className="setting">
      <h4>Where this is kept</h4>
      <p>
        Two files, and the split is deliberate: the project&rsquo;s settings are committed with the
        project, and the credential never goes near it — <code>git init</code> a week later would
        turn that into a leak.
      </p>
      <p className="setting__file">{view.settingsFile}</p>
      <pre className="setting__code">
        {view.settingsText ?? "// not written yet — the defaults are in force"}
      </pre>
      <p className="setting__file">{view.secretsFile}</p>
      <p className="empty">
        The credential, outside the project. Not shown here, and not sent to this window at all.
      </p>
    </section>
  );
}
