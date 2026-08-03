import { useCallback, useEffect, useState } from "react";
import type { Harness, Language } from "@open-wiki/access";
import { HARNESS_CHOICES, toggleHarness } from "./harnesses.js";
import type { KnownProject } from "../main/settings.js";
import { bridge } from "./bridge.js";
import { FirstRun } from "./FirstRun.js";
import { DEFAULT_LANGUAGE, LANGUAGES } from "./languages.js";
import {
  creationScreenFor,
  directoryAfterChoosing,
  directoryFor,
  openExisting,
  type CreationScreen,
} from "./open-existing.js";

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
  /** Which way a project is being made right now, if one is (R2.7). */
  const [creating, setCreating] = useState<CreationScreen | "none">("none");
  /**
   * The directory the create form opens on
   * (`specs/opening-an-existing-project`, R2.4).
   *
   * A directory that turned out not to be a project is carried into the form
   * rather than dropped. The user already said where; asking again, right after
   * being told it was not a project, is the moment this would read as a refusal
   * instead of a step forward.
   */
  const [creatingAt, setCreatingAt] = useState("");
  const [busy, setBusy] = useState(false);

  /**
   * The list, with whatever is already sitting in the default location taken on
   * first (R2.6).
   *
   * `discoverProjects` rather than `knownProjects`: a project restored from a
   * backup or cloned straight into `WikiProjects` is on disk and unknown, and
   * making somebody point at it through **Open project…** is asking them to
   * tell the application something it is standing on top of. The registry is
   * still what this renders — the folder is read to fill it, never to answer
   * from.
   */
  const load = useCallback(() => {
    void bridge()
      .discoverProjects()
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

  const open = useCallback(async (name: string) => {
    try {
      await bridge().openProject(name);
    } catch (e) {
      // `resolve` refuses an unknown name and a directory that moved (2.2), and
      // the refusal says which — better than a window opening on nothing.
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /**
   * Open a project this machine has never been told about (R2.1, R2.2, R2.4).
   *
   * The list above can only open what the registry already holds, and a project
   * that was cloned, restored, or made before this application was on the
   * machine is in none of them.
   */
  const openExistingProject = useCallback(async () => {
    setBusy(true);
    try {
      const attempt = await openExisting(bridge());
      if (attempt.kind === "cancelled") return;
      if (attempt.kind === "opened") {
        // Registered on the way through (R2.3), so the list is stale the moment
        // the window opens.
        setError(null);
        load();
        return;
      }
      setError(`${attempt.directory} is not a project yet — name it and it will be one.`);
      setCreatingAt(attempt.directory);
      // The compact form, whatever the registry holds: this path already has a
      // directory, and the guided run's first step is the one asking for one.
      setCreating("form");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [load]);

  // R2.7 — the guided first run, reached from **New project** while nothing is
  // known, rather than *instead of* this screen.
  //
  // It replaced the launcher outright until now, which put the two doors on a
  // screen the one person who needed them never saw (R2.1's second modification
  // says the rest). What it keeps is the credential step: the compact form does
  // not ask for one, and a first project created without ever being offered
  // transcription is a worse trade than one extra screen.
  if (creating === "first-run") {
    return (
      <FirstRun
        onDone={() => {
          setCreating("none");
          load();
        }}
      />
    );
  }

  return (
    <div className="launcher">
      <h2>Projects on this machine</h2>
      {error ? <p className="error">{error}</p> : null}

      {/* Above the list, because these are what somebody came here to do — the
          list is what they came here to pick from. Below it, the two doors sat
          past however many projects this machine has. */}
      {creating === "form" ? null : (
        <div className="editor__bar">
          <button
            onClick={() => {
              setCreatingAt("");
              // Nothing known yet — the guided run, which is the only path that
              // offers the transcription credential (R2.7). Once this machine
              // has a project, the compact form is the one that fits.
              setCreating(creationScreenFor(projects));
            }}
          >
            New project
          </button>
          {/* R2.1 — the other half. Without it the only way into a project the
              registry does not list is to go and run `ow` in its directory,
              which is what the note below used to be the whole answer. */}
          <button onClick={() => void openExistingProject()} disabled={busy}>
            {busy ? "Opening…" : "Open project…"}
          </button>
        </div>
      )}

      {creating === "form" ? (
        <NewProject
          startingDirectory={creatingAt}
          onCancel={() => {
            setCreating("none");
            setCreatingAt("");
          }}
          onCreated={() => {
            setCreating("none");
            setCreatingAt("");
            setError(null);
            load();
          }}
          onError={setError}
        />
      ) : null}

      {projects && projects.length > 0 ? (
        <ul className="list">
          {projects.map((project) => (
            <li key={project.name} className="operation">
              <strong>{project.name}</strong>
              <code className="launcher__path">{project.path || "— moved or deleted"}</code>
              {!project.present ? (
                <span className="badge badge--failed">not where it was</span>
              ) : null}
              <span className="chrome__spacer" />
              {/* A list of projects with no way to open one was a list that
                  could only forget them. */}
              <button onClick={() => void open(project.name)} disabled={!project.present}>
                Open
              </button>
              <button onClick={() => void forget(project.name)}>Forget</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">Nothing here yet.</p>
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
  startingDirectory,
  onCancel,
  onCreated,
  onError,
}: {
  /** Where R2.4 already sent the user — empty when they came here directly. */
  startingDirectory: string;
  onCancel: () => void;
  onCreated: () => void;
  onError: (message: string) => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState(startingDirectory);
  const [language, setLanguage] = useState<Language>(DEFAULT_LANGUAGE);
  // Nothing preselected, as in the first run and the CLI picker: the convention
  // is committed, so a guess here is paid for by whoever clones the project.
  const [harnesses, setHarnesses] = useState<Harness[]>([]);
  const [busy, setBusy] = useState(false);
  /** Where new projects go unless somebody says otherwise (R3.4). */
  const [defaultRoot, setDefaultRoot] = useState("");
  /**
   * Whether the directory is the user's answer rather than ours (R3.5).
   *
   * True from the start when R2.4 sent them here with a directory already
   * chosen — that is emphatically their answer, and re-proposing over it would
   * throw away the folder they just picked in the chooser.
   */
  const [touched, setTouched] = useState(startingDirectory !== "");

  useEffect(() => {
    void bridge()
      .defaultDirectory()
      .then(setDefaultRoot)
      // No default is survivable: the field is still typeable and Choose… still
      // works, which is R3.2. Failing the whole form over a suggestion is not.
      .catch(() => setDefaultRoot(""));
  }, []);

  /** R3.4 — naming the project is the whole of saying where it goes. */
  useEffect(() => {
    setDirectory((current) => directoryFor(current, { defaultRoot, name, touched }));
  }, [defaultRoot, name, touched]);

  /** R3.1 — and R3.3: a cancelled chooser leaves what is in the box alone. */
  const choose = useCallback(async () => {
    try {
      const chosen = await bridge().chooseDirectory();
      if (chosen === null) return;
      setTouched(true);
      setDirectory((current) => directoryAfterChoosing(current, chosen));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [onError]);

  const create = useCallback(async () => {
    const trimmedName = name.trim();
    const trimmedDirectory = directory.trim();
    if (!trimmedName || !trimmedDirectory) {
      onError("a project needs a name and a directory");
      return;
    }
    if (harnesses.length === 0) {
      onError("choose at least one harness — the convention has to live somewhere a harness reads");
      return;
    }
    setBusy(true);
    try {
      // Through the scaffolder of 2.1, the same one `ow init` and the first run
      // use — so a project is the same project whichever door it came through.
      await bridge().createProject(trimmedName, trimmedDirectory, language, harnesses);
      onCreated();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [name, directory, language, harnesses, onCreated, onError]);

  return (
    <section className="launcher__new">
      <h3>New project</h3>
      {/* 6.4 — what a project *is*, said where one is made. The draft's
          sentence, and the answer to the question somebody making their second
          project actually has. */}
      <p className="empty">
        Its own sources, its own pages, its own history. Nothing is shared with the projects above.
      </p>
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
        {/* R3.1 and R3.2 together: the chooser for the ordinary case, the box
            still typeable for a path somebody already has in hand. */}
        <div className="editor__bar">
          <input
            className="editor__source"
            value={directory}
            placeholder={defaultRoot || "C:\\projects\\fenix"}
            onChange={(event) => {
              // Typing here is the user saying where (R3.5), including clearing
              // it: an empty box they emptied is not an invitation to refill it.
              setTouched(true);
              setDirectory(event.target.value);
            }}
          />
          <button type="button" onClick={() => void choose()} disabled={busy}>
            Choose…
          </button>
        </div>
      </label>
      <fieldset className="launcher__languages">
        <legend>Harnesses</legend>
        <p className="empty">
          Where the convention is written, and it is committed — so it reaches everyone who clones
          this project. Choose every harness your team uses; you can add another later.
        </p>
        <div className="editor__bar">
          {HARNESS_CHOICES.map((choice) => (
            <label key={choice.value}>
              <input
                type="checkbox"
                checked={harnesses.includes(choice.value)}
                onChange={() => setHarnesses((current) => toggleHarness(current, choice.value))}
              />{" "}
              {choice.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="launcher__languages">
        <legend>Content language</legend>
        <p className="empty">
          What transcription is told to expect, and what the generated entry file tells the agent to
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
