import { useCallback, useEffect, useState } from "react";
import type { Language } from "@open-wiki/access";
import type { KnownProject } from "../main/settings.js";
import { bridge } from "./bridge.js";
import { DEFAULT_LANGUAGE, LANGUAGES } from "./languages.js";

/**
 * The launcher (plan 8.4) — what `ow` run outside a project opens instead of
 * guessing.
 *
 * A project whose directory moved is **shown, not hidden**. The registry is a
 * cache and never truth (2.2), so it degrades to a refusal; hiding the entry
 * would leave the user wondering where their project went, and showing it says
 * what happened.
 */
export function Launcher(): React.JSX.Element {
  const [projects, setProjects] = useState<KnownProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    void bridge()
      .knownProjects()
      .then(setProjects)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(load, [load]);

  const forget = useCallback(
    async (name: string) => {
      // Only the entry. The directory is the user's.
      await bridge().forgetProject(name);
      load();
    },
    [load],
  );

  return (
    <div className="launcher">
      <h2>Projects on this machine</h2>
      {error ? <p className="error">{error}</p> : null}
      {projects && projects.length > 0 ? (
        <ul className="list">
          {projects.map((project) => (
            <li key={project.name} className="operation">
              <strong>{project.name}</strong>
              <code className="source__id">{project.path || "— moved or deleted"}</code>
              {!project.present ? (
                <span className="badge badge--failed">not where it was</span>
              ) : null}
              <span className="chrome__spacer" />
              <button onClick={() => void forget(project.name)}>Forget</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">Nothing here yet.</p>
      )}

      {creating ? (
        <NewProject
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setError(null);
            load();
          }}
          onError={setError}
        />
      ) : (
        <div className="editor__bar">
          <button onClick={() => setCreating(true)}>New project</button>
        </div>
      )}

      <p className="empty">
        Opening a project is <code>ow</code> inside its directory — the same way <code>code .</code>{" "}
        works. This list is a convenience, and it is a cache rather than the truth: a project that
        moved is shown here so you can see that it did.
      </p>
    </div>
  );
}

/**
 * Creating a project (plan 8.4), and the one moment 8.12 asks the content
 * language.
 *
 * **A form rather than a chain of `prompt()` calls.** Two of those reasons are
 * worth stating: Electron does not implement `window.prompt`, so the chain that
 * stood here answered nothing at all in the packaged application; and the
 * language is a choice with three named options, which a text box cannot offer
 * and a user cannot guess the spelling of.
 *
 * The default is English, per `adr:0008` — chosen here rather than assumed, so
 * the setting a project is born with is one somebody looked at. It is not a
 * decision to agonise over either: the settings screen changes it afterwards
 * and regenerates `CLAUDE.md` when it does.
 */
function NewProject({
  onCancel,
  onCreated,
  onError,
}: {
  onCancel: () => void;
  onCreated: () => void;
  onError: (message: string) => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");
  const [language, setLanguage] = useState<Language>(DEFAULT_LANGUAGE);
  const [busy, setBusy] = useState(false);

  const create = useCallback(async () => {
    const trimmedName = name.trim();
    const trimmedDirectory = directory.trim();
    if (!trimmedName || !trimmedDirectory) {
      onError("a project needs a name and a directory");
      return;
    }
    setBusy(true);
    try {
      // Through the scaffolder of 2.1, the same one `ow init` and the first run
      // use — so a project is the same project whichever door it came through.
      await bridge().createProject(trimmedName, trimmedDirectory, language);
      onCreated();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [name, directory, language, onCreated, onError]);

  return (
    <section className="launcher__new">
      <h3>New project</h3>
      <label>
        Name
        <input
          className="editor__source"
          value={name}
          placeholder="fenix"
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Directory
        <input
          className="editor__source"
          value={directory}
          placeholder="C:\projects\fenix"
          onChange={(event) => setDirectory(event.target.value)}
        />
      </label>
      <fieldset className="launcher__languages">
        <legend>Content language</legend>
        <p className="empty">
          What transcription is told to expect, and what the generated CLAUDE.md tells the agent to
          write pages in. The schema itself stays English, and this is changeable later.
        </p>
        <div className="editor__bar">
          {LANGUAGES.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="language"
                checked={language === option.value}
                onChange={() => setLanguage(option.value)}
              />{" "}
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="editor__bar">
        <button onClick={() => void create()} disabled={busy}>
          {busy ? "Creating…" : "Create"}
        </button>
        <button onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </section>
  );
}
