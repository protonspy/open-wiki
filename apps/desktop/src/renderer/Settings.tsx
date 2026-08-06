import type { Language } from "@open-wiki/access";
import { CircleCheck } from "lucide-react";
import clsx from "clsx";
import { useCallback, useEffect, useState } from "react";
import type { AgentPrefs } from "../main/agent/agent-prefs.js";
import type { CredentialState, SettingsView } from "../main/settings.js";
import { bridge } from "./bridge.js";
import { railMove } from "./keyboard.js";
import { LANGUAGES } from "./languages.js";
import { PaneBar } from "./PaneBar.js";
import { agentSection, SETTINGS_SECTIONS, type SettingsSectionId } from "./settings-sections.js";
import { Button } from "./ui/Button.js";
import { ICON_SM } from "./ui/icons.js";
import { Input } from "./ui/Input.js";
import { Segmented } from "./ui/Segmented.js";
import { Select } from "./ui/Select.js";
import { Switch } from "./ui/Switch.js";

/**
 * The settings pane (plan 8.3, 8.12, `specs/embedded-agent` R2.5, desktop-ui
 * 6.1, then `plans/settings-pane-and-export`): the transcription credential, the
 * content language, the agent's model, what happens to the WAV — and the two
 * files all of it lives in.
 *
 * **A pane, not a sheet.** A modal is right for something you glance at and
 * dismiss; this is where somebody goes to work on the setup — paste a key, wait
 * for it to be checked, read where the file is, come back to it — and a window
 * balanced on top of the application is the wrong shape for that. It is a
 * location now, so Back returns to it and the Chat pane's empty state can send
 * you here as a destination rather than as a popup.
 *
 * **The key is write-only from here.** `credentialState` answers whether one is
 * stored, never what it is: the renderer has no business holding the
 * application's one secret, and a field pre-filled with it would put it in the
 * DOM of a window that renders markdown an agent wrote. The same rule is why
 * the credential file below is shown as a *path* and its contents are not.
 *
 * **The export left.** It was the last block on this page and it is not a
 * setting: it acts on the wiki, like creating a page or deleting one, and every
 * other act on the wiki is in the wiki pane's bar. That is where it went.
 */
export function Settings({
  onProjectChanged,
}: {
  /**
   * Fired after the content language is written, so the rail's language chip
   * and the document's `lang` stop showing the value that was just replaced.
   * The mount effect in `App` loads the project once and nothing else re-loads
   * it; without this, a language change in this pane did not reach the rail
   * until the window was reopened.
   */
  onProjectChanged?: () => void | Promise<void>;
}): React.JSX.Element {
  const [credential, setCredential] = useState<CredentialState | null>(null);
  const [view, setView] = useState<SettingsView | null>(null);
  const [provider, setProvider] = useState<"groq" | "whispercpp">("groq");
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [agent, setAgent] = useState<AgentPrefs | null>(null);
  const [section, setSection] = useState<SettingsSectionId>("project");

  const load = useCallback(() => {
    void bridge().credential().then(setCredential);
    void bridge()
      .settingsView()
      .then(setView)
      .catch(() => setView(null));
    // A rejected call leaves `agent` null, which the agent section reads as
    // "nothing to choose from" and says so. An unhandled rejection here would
    // surface as a console error the user can do nothing about.
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
    // The rail's language chip and the document's `lang` read the project, not
    // this view — re-load the project so they reflect what was just chosen.
    await onProjectChanged?.();
  }, [onProjectChanged]);

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

  const at = Math.max(
    0,
    SETTINGS_SECTIONS.findIndex((entry) => entry.id === section),
  );

  /**
   * The arrows move between the tabs, as they do in the rail (uxpass 4.5).
   *
   * `railMove` is the tablist pattern rather than anything about the rail —
   * wrapping, both axes, Home and End — and this is a tablist too. Choosing
   * shows, because all four sections are cheap and arriving somewhere and
   * showing it are one act.
   */
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    const to = railMove(event, at, SETTINGS_SECTIONS.length);
    if (to === null) return;
    const next = SETTINGS_SECTIONS[to];
    if (!next) return;
    event.preventDefault();
    setSection(next.id);
    event.currentTarget.querySelector<HTMLElement>(`#settings-tab-${next.id}`)?.focus();
  };

  return (
    <section className="settings-pane" aria-label="Settings">
      <PaneBar
        title="Settings"
        detail={<span className="pane-bar__note">this project, and this machine — two files</span>}
      />

      <div className="settings-body">
        <div
          className="settings-tabs"
          role="tablist"
          aria-label="Settings sections"
          onKeyDown={onTabKeyDown}
        >
          {SETTINGS_SECTIONS.map(({ id, label }) => (
            <button
              key={id}
              id={`settings-tab-${id}`}
              type="button"
              role="tab"
              className={clsx("settings-tab", id === section && "settings-tab--on")}
              // One tab stop for the group, as the pattern asks. Never none, or
              // Tab would skip the whole page's navigation.
              tabIndex={id === section ? 0 : -1}
              aria-selected={id === section}
              aria-controls="settings-section"
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div
          className="settings"
          id="settings-section"
          role="tabpanel"
          aria-labelledby={`settings-tab-${section}`}
          tabIndex={-1}
        >
          {/* Above the sections rather than inside one: a language change is
              reported while you are reading it, and switching tab afterwards
              must not take the sentence away before it has been read. */}
          {status ? <p className="empty settings__status">{status}</p> : null}

          {section === "project" ? (
            <Project
              view={view}
              onLanguage={(next) => void changeLanguage(next)}
              onDeleteWav={(on) => void changeDeleteWav(on)}
            />
          ) : null}

          {section === "transcription" ? (
            <Transcription
              credential={credential}
              provider={provider}
              onProvider={(next) => {
                setProvider(next);
                setChecked(false);
              }}
              value={key}
              onKey={setKey}
              onSave={() => void save()}
              busy={busy}
              checked={checked}
            />
          ) : null}

          {section === "agent" ? (
            <AgentModel
              credential={credential}
              agent={agent}
              onPick={(model) => void pickModel(model)}
              onGoToTranscription={() => setSection("transcription")}
            />
          ) : null}

          {section === "files" ? <Files view={view} /> : null}
        </div>
      </div>
    </section>
  );
}

/** What this project is set to — both settings that live in `ow.json`. */
function Project({
  view,
  onLanguage,
  onDeleteWav,
}: {
  view: SettingsView | null;
  onLanguage: (next: Language) => void;
  onDeleteWav: (on: boolean) => void;
}): React.JSX.Element {
  return (
    <>
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
          onChange={onLanguage}
        />
      </section>

      {/* uxpass 7.4 — the heading, the label and the switch now say the same
          thing. The section read *Keep the WAV after transcribing* over a
          control reading *Delete it once transcription succeeds*, so ON meant
          delete under a heading that said keep: the two halves of one setting
          stating opposite polarities, with nothing to tell a reader which of
          them the switch was about. */}
      <section className="setting">
        <h4>Delete the WAV after transcribing</h4>
        <p>
          An hour of raw audio is about 690&nbsp;MB. The Opus copy is what citations point at and it
          is kept either way — the WAV buys nothing once the text exists. On, the WAV is deleted as
          soon as a transcription succeeds; off, it stays in <code>raw/</code>.
        </p>
        <div className="setting__row">
          <span>Delete the WAV once transcription succeeds</span>
          <span className="pane-bar__spacer" />
          <Switch
            label="Delete the WAV once transcription succeeds"
            checked={view?.settings.deleteWavAfterTranscription ?? true}
            disabled={view === null}
            onChange={onDeleteWav}
          />
        </div>
      </section>
    </>
  );
}

/** The one credential this application holds, and the choice not to have one. */
function Transcription({
  credential,
  provider,
  onProvider,
  value,
  onKey,
  onSave,
  busy,
  checked,
}: {
  credential: CredentialState | null;
  provider: "groq" | "whispercpp";
  onProvider: (next: "groq" | "whispercpp") => void;
  value: string;
  onKey: (next: string) => void;
  onSave: () => void;
  busy: boolean;
  checked: boolean;
}): React.JSX.Element {
  return (
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
        onChange={onProvider}
      />

      {provider === "groq" ? (
        <>
          <div className="key-row">
            <label className="field">
              API key
              <Input
                type="password"
                placeholder={
                  credential?.hasKey ? "A key is stored — type a new one to replace it" : "gsk_…"
                }
                value={value}
                autoComplete="off"
                onChange={(event) => onKey(event.target.value)}
              />
            </label>
            <Button onClick={onSave} disabled={busy || value === ""}>
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
            Nothing to configure. Choosing this is how you opt out of the one place this application
            talks to a third party — you supply the binary and the model.
          </p>
          <p>
            The embedded agent needs a Groq key, so the Chat pane is disabled while whisper.cpp is
            chosen.
          </p>
          <div className="key-row">
            <Button onClick={onSave} disabled={busy}>
              {busy ? "Checking…" : "Use whisper.cpp"}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * The agent's model — drawn from the /models list captured when the key was
 * checked (R2.5, 5.4).
 *
 * It used to be absent until a Groq credential was saved. A section in a scroll
 * can be absent; a tab cannot, so this says which of the three reasons it has
 * nothing to offer and where to go about it — see `agentSection`.
 */
function AgentModel({
  credential,
  agent,
  onPick,
  onGoToTranscription,
}: {
  credential: CredentialState | null;
  agent: AgentPrefs | null;
  onPick: (model: string) => void;
  onGoToTranscription: () => void;
}): React.JSX.Element {
  const state = agentSection(credential, agent);
  return (
    <section className="setting">
      <h4>Chat agent model</h4>
      <p>
        The model the embedded agent runs. The list is what Groq offered for this project when the
        key was checked.
      </p>

      {state.state === "ready" ? (
        /* uxpass 7.1 — `Select` rather than a bare `<select>`. `Segmented` is
           still the rule where the options are few and named; this list is
           whatever Groq offered, which is not knowable here. */
        <Select
          label="Chat agent model"
          value={state.selected}
          options={state.models.map((model) => ({ value: model, label: model }))}
          onChange={onPick}
        />
      ) : (
        <>
          <p className="empty">
            {state.state === "no-credential"
              ? "No credential is stored yet, so nothing has been offered. Save a Groq key and the list fills in."
              : state.state === "not-groq"
                ? "whisper.cpp is chosen, and it runs transcription only — the embedded agent needs a Groq key, so the Chat pane is disabled while it is."
                : "A Groq credential is stored and no models came back with it. Check the key again to ask Groq for the list."}
          </p>
          <div className="key-row">
            <Button onClick={onGoToTranscription}>Go to Transcription</Button>
          </div>
        </>
      )}
    </section>
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
function Files({ view }: { view: SettingsView | null }): React.JSX.Element {
  if (!view) {
    return (
      <section className="setting">
        <h4>Where this is kept</h4>
        <p className="empty">Reading where the settings are&hellip;</p>
      </section>
    );
  }
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
