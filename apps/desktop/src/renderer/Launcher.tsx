import { useCallback, useEffect, useState } from "react";
import { FolderOpen, FolderPlus } from "lucide-react";
import type { Harness, Language } from "@open-wiki/access";
import { Button } from "./ui/Button.js";
import { Input } from "./ui/Input.js";
import { HARNESS_CHOICES, toggleHarness } from "./harnesses.js";
import type { KnownProject } from "../main/settings.js";
import { bridge } from "./bridge.js";
import { FirstRun } from "./FirstRun.js";
import { DEFAULT_LANGUAGE, LANGUAGES } from "./languages.js";
import {
  creationScreenFor,
  directoryAfterChoosing,
  directoryFor,
  kebabCase,
  openExisting,
  relocateProject,
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
   * Where a new project would land (R3.4), said in the heading rather than
   * discovered inside a form. It is also the folder R2.6 has just read, so the
   * list below and this line are about the same place.
   */
  const [defaultRoot, setDefaultRoot] = useState("");

  useEffect(() => {
    void bridge()
      .defaultDirectory()
      .then(setDefaultRoot)
      // A heading line is not worth an error: the doors below both still work.
      .catch(() => setDefaultRoot(""));
  }, []);

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
   * Say where a project went (uxpass 8.4).
   *
   * The same two answers **Open project…** has, because it is the same act seen
   * from the other end: a directory chosen, and either it is a project or it is
   * somewhere to make one. What is different is the stale entry, which
   * `relocateProject` drops so the directory can be taken on under the name this
   * project is actually called.
   */
  const locate = useCallback(
    async (name: string) => {
      setBusy(true);
      try {
        const attempt = await relocateProject(bridge(), name);
        if (attempt.kind === "cancelled") return;
        if (attempt.kind === "relocated") {
          setError(null);
          load();
          return;
        }
        setError(`${attempt.directory} is not a project — name it and it will be one.`);
        setCreatingAt(attempt.directory);
        setCreating("form");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

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
      <div className="launcher__head">
        <h2>Projects on this machine</h2>
        {/* Where a new one lands, said before anybody asks — the draft's §2.2
            caption idiom, which states the effect in the machine's own voice. */}
        {defaultRoot ? <p className="launcher__where">new projects go in {defaultRoot}</p> : null}
      </div>

      {error ? <p className="error">{error}</p> : null}

      {/* Above the list, because these are what somebody came here to do — the
          list is what they came here to pick from. Below it, the two doors sat
          past however many projects this machine has. */}
      {creating === "form" ? null : (
        <div className="launcher__doors">
          {/* The one amber button on this screen. Opening a project is done from
              its own row, so creating is the single act that has nowhere else to
              live — and `Button` reserves primary for exactly that. */}
          <Button
            variant="primary"
            icon={FolderPlus}
            onClick={() => {
              setCreatingAt("");
              // Nothing known yet — the guided run, which is the only path that
              // offers the transcription credential (R2.7). Once this machine
              // has a project, the compact form is the one that fits.
              setCreating(creationScreenFor(projects));
            }}
          >
            New project
          </Button>
          {/* R2.1 — the other half. Without it the only way into a project the
              registry does not list is to go and run `ow` in its directory,
              which is what the note below used to be the whole answer. */}
          <Button icon={FolderOpen} onClick={() => void openExistingProject()} disabled={busy}>
            {busy ? "Opening…" : "Open project…"}
          </Button>
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
        <ul className="launcher__projects">
          {projects.map((project) => (
            <li
              key={project.name}
              className={
                project.present
                  ? "launcher__project"
                  : "launcher__project launcher__project--missing"
              }
            >
              <span className="launcher__identity">
                <span className="launcher__name">{project.name}</span>
                <code className="launcher__path">{project.path || "moved or deleted"}</code>
              </span>
              {!project.present ? (
                <span className="badge badge--failed">not where it was</span>
              ) : null}
              <span className="launcher__actions">
                {/* A list of projects with no way to open one was a list that
                    could only forget them. Forget is quiet on purpose: it drops
                    an entry and touches nothing on disk, so it must not carry
                    the weight of a delete. */}
                {project.present ? (
                  <Button size="sm" onClick={() => void open(project.name)}>
                    Open
                  </Button>
                ) : (
                  /* uxpass 8.4 — a project that moved offered only Forget, so
                     the one thing anybody wants to do with it was the one thing
                     this screen could not do. */
                  <Button size="sm" onClick={() => void locate(project.name)} disabled={busy}>
                    Locate…
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => void forget(project.name)}>
                  Forget
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        /* An empty screen is an invitation, not a report. "Nothing here yet."
           described the state and left the reader to work out the rest. */
        <div className="launcher__nothing">
          <p className="launcher__foot">No projects on this machine yet.</p>
          <p className="launcher__foot">
            Create one, or open a project you already have — any folder holding <code>raw/</code>,{" "}
            <code>wiki/</code> and <code>.state/</code>, however it got there.
          </p>
        </div>
      )}

      {/* uxpass 8.3 — the cache sentence explains the list, so it is said where
          there is a list. It appeared on the empty screen too, explaining the
          behaviour of rows that could not exist. */}
      {projects && projects.length > 0 ? (
        <p className="launcher__foot">
          This list is a cache rather than the truth, so a project whose directory moved is shown
          here instead of quietly disappearing — <strong>Locate…</strong> is how you say where it
          went.
        </p>
      ) : null}
      <p className="launcher__foot">
        Running <code>ow</code> inside a project opens it too, the same way <code>code .</code>{" "}
        does.
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

  /**
   * What this project is actually called (R3.6).
   *
   * The registry takes letters, digits, dot, dash and underscore — so `test 123`
   * was refused after the path beside it had already been proposed as
   * `…\test-123`, which is the form saying one thing and doing another.
   */
  const projectName = kebabCase(name);

  const create = useCallback(async () => {
    const trimmedDirectory = directory.trim();
    if (!projectName || !trimmedDirectory) {
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
      await bridge().createProject(projectName, trimmedDirectory, language, harnesses);
      onCreated();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [projectName, directory, language, harnesses, onCreated, onError]);

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
        <Input
          value={name}
          placeholder="fenix"
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {/* R3.6 — said before it happens rather than discovered afterwards. */}
      {projectName && projectName !== name.trim() ? (
        <p className="empty">
          Created as <code>{projectName}</code> — the name is an identifier, so it takes the same
          shape as the folder.
        </p>
      ) : null}
      <label>
        Directory
        {/* R3.1 and R3.2 together: the chooser for the ordinary case, the box
            still typeable for a path somebody already has in hand. */}
        <div className="field__row">
          <Input
            value={directory}
            placeholder={defaultRoot || "C:\\projects\\fenix"}
            onChange={(event) => {
              // Typing here is the user saying where (R3.5), including clearing
              // it: an empty box they emptied is not an invitation to refill it.
              setTouched(true);
              setDirectory(event.target.value);
            }}
          />
          <Button onClick={() => void choose()} disabled={busy}>
            Choose…
          </Button>
        </div>
      </label>
      <fieldset className="launcher__languages">
        <legend>Harnesses</legend>
        <p className="empty">
          Where the convention is written, and it is committed — so it reaches everyone who clones
          this project. Choose every harness your team uses; you can add another later.
        </p>
        <div className="choice-row">
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
        <div className="choice-row">
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
      <div className="field__row">
        <Button variant="primary" onClick={() => void create()} disabled={busy}>
          {busy ? "Creating…" : "Create"}
        </Button>
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
