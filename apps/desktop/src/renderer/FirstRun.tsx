import type { Harness, Language } from "@open-wiki/access";
import { HARNESS_CHOICES, toggleHarness } from "./harnesses.js";
import { useCallback, useEffect, useState } from "react";
import { bridge } from "./bridge.js";
import { canLeave, nextStep, STEPS, stepNumber, type StepId } from "./first-run.js";
import { DEFAULT_LANGUAGE, LANGUAGES } from "./languages.js";
import { directoryAfterChoosing, directoryFor } from "./open-existing.js";
import { Button } from "./ui/Button.js";
import { Segmented } from "./ui/Segmented.js";

/**
 * The first run (desktop-ui 6.3): project, language, transcription, done.
 *
 * **The project is created between step 2 and step 3**, which is not an
 * arrangement anybody would draw but is the only honest one: `createProject`
 * takes the name, the directory and the language, so it cannot run before both
 * of the first two steps — and the credential belongs to a *project*, so it
 * cannot be stored before one exists. Everything after the creation is
 * configuring something real rather than collecting answers to apply later.
 *
 * The renderer names the project and never its path, here as everywhere else:
 * the registry resolves the name (2.2), refuses an unknown one, and degrades to
 * a refusal for a directory that moved.
 */
export function FirstRun({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [step, setStep] = useState<StepId>("project");
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");
  const [language, setLanguage] = useState<Language>(DEFAULT_LANGUAGE);
  // Nothing preselected — see `canLeave`. A default here would be the silent
  // guess the plan's third divergence refuses, in the one place where the
  // person who suffers it is somebody else, later.
  const [harnesses, setHarnesses] = useState<Harness[]>([]);
  const [provider, setProvider] = useState<"groq" | "whispercpp">("groq");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** Where new projects go unless somebody says otherwise (R3.4, R3.5). */
  const [defaultRoot, setDefaultRoot] = useState("");
  const [touched, setTouched] = useState(false);

  const current = STEPS.find((s) => s.id === step) ?? STEPS[0]!;

  useEffect(() => {
    void bridge()
      .defaultDirectory()
      .then(setDefaultRoot)
      // Survivable: the field stays typeable and Choose… still works (R3.2).
      // Failing the first screen anybody sees over a suggestion is not.
      .catch(() => setDefaultRoot(""));
  }, []);

  /**
   * R3.4 — on the first screen this product shows, naming the project is the
   * whole of saying where it goes. Nobody's first act here should be composing
   * an absolute path by hand.
   */
  useEffect(() => {
    setDirectory((current) => directoryFor(current, { defaultRoot, name, touched }));
  }, [defaultRoot, name, touched]);

  /** Step 2 → the project exists. Everything after it configures that project. */
  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Through the scaffolder of 2.1 — the same one `ow init` and the launcher
      // use, so a project is the same project whichever door it came through.
      await bridge().createProject(name.trim(), directory.trim(), language, harnesses);
      setStep("transcription");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [name, directory, language, harnesses]);

  /** R3.1, and R3.3: a cancelled chooser leaves what is in the box alone. */
  const chooseDirectory = useCallback(async () => {
    try {
      const chosen = await bridge().chooseDirectory();
      if (chosen === null) return;
      setTouched(true);
      setDirectory((current) => directoryAfterChoosing(current, chosen));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const toggle = useCallback((h: Harness) => {
    setHarnesses((current) => toggleHarness(current, h));
  }, []);

  const saveCredential = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await bridge().saveCredentialFor(name.trim(), {
        provider,
        ...(provider === "groq" ? { apiKey: key } : {}),
      });
      setKey("");
      if (result.ok) {
        setNote(null);
        setStep("done");
      } else {
        // Not an error that stops the run: this step is skippable, and a key
        // that could not be checked is not a key that is wrong (8.3's
        // distinction, and `checkCredential`'s).
        setNote(result.reason);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [name, provider, key]);

  const open = useCallback(async () => {
    try {
      await bridge().openProject(name.trim());
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [name, onDone]);

  return (
    <section className="first-run">
      <p className="first-run__where">
        Step {stepNumber(step)} of {STEPS.length}
      </p>
      <h2>{current.title}</h2>
      <p className="first-run__detail">{current.detail}</p>
      {error ? <p className="error">{error}</p> : null}

      {step === "project" ? (
        <>
          <label className="field">
            Name
            <input
              value={name}
              placeholder="fenix"
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field">
            Directory
            {/* `specs/opening-an-existing-project`, R3.1 — wherever a directory
                is asked for, and this is the first one anybody ever sees. */}
            <div className="editor__bar">
              <input
                value={directory}
                placeholder={defaultRoot || "C:\\projects\\fenix"}
                onChange={(e) => {
                  // Typing is the user saying where (R3.5), clearing included.
                  setTouched(true);
                  setDirectory(e.target.value);
                }}
              />
              <button type="button" onClick={() => void chooseDirectory()}>
                Choose…
              </button>
            </div>
          </label>
          {/* R3.4 — said out loud, because a path that fills itself in is only
              reassuring if you can see where it came from. */}
          {!touched && defaultRoot ? (
            <p className="empty">
              New projects go in <code>{defaultRoot}</code> unless you say otherwise — type a path
              or use Choose….
            </p>
          ) : null}
        </>
      ) : null}

      {step === "harness" ? (
        <fieldset className="field">
          <legend>Harnesses</legend>
          {HARNESS_CHOICES.map((choice) => (
            <label key={choice.value} className="choice">
              <input
                type="checkbox"
                checked={harnesses.includes(choice.value)}
                onChange={() => toggle(choice.value)}
              />
              <span>{choice.label}</span>
              {/* What each choice actually puts in the directory, because this
                  is committed and the person choosing should see it. */}
              <span className="choice__detail">{choice.detail}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {step === "language" ? (
        <Segmented
          label="Content language"
          options={LANGUAGES.map((l) => ({ value: l.value, label: l.label }))}
          value={language}
          onChange={setLanguage}
        />
      ) : null}

      {step === "transcription" ? (
        <>
          <Segmented
            label="Transcription provider"
            options={[
              { value: "groq", label: "Groq" },
              { value: "whispercpp", label: "whisper.cpp, on this machine" },
            ]}
            value={provider}
            onChange={setProvider}
          />
          {provider === "groq" ? (
            <label className="field">
              API key
              <input
                type="password"
                placeholder="gsk_…"
                value={key}
                autoComplete="off"
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
          ) : (
            <p className="first-run__detail">
              You supply the binary and the model; nothing is sent anywhere. The Chat pane needs a
              Groq key, so it stays disabled while this is chosen.
            </p>
          )}
          {note ? <p className="empty">{note}</p> : null}
        </>
      ) : null}

      {step === "done" ? <p className="first-run__path">{directory.trim()}</p> : null}

      <div className="first-run__buttons">
        {step === "project" ? (
          <Button
            variant="primary"
            disabled={!canLeave("project", { name, directory, harnesses })}
            onClick={() => setStep(nextStep("project") ?? "done")}
          >
            Next
          </Button>
        ) : null}

        {step === "harness" ? (
          <Button
            variant="primary"
            disabled={!canLeave("harness", { name, directory, harnesses })}
            onClick={() => setStep(nextStep("harness") ?? "done")}
          >
            Next
          </Button>
        ) : null}

        {step === "language" ? (
          <Button variant="primary" disabled={busy} onClick={() => void create()}>
            {busy ? "Creating…" : "Create the project"}
          </Button>
        ) : null}

        {step === "transcription" ? (
          <>
            <Button
              variant="primary"
              disabled={busy || (provider === "groq" && key === "")}
              onClick={() => void saveCredential()}
            >
              {busy ? "Checking…" : "Check it and finish"}
            </Button>
            {/* Skippable, and the button says so rather than saying "Cancel"
                and skipping anyway — the same rule the recording box follows. */}
            <Button onClick={() => setStep("done")} disabled={busy}>
              Not recording yet — skip
            </Button>
          </>
        ) : null}

        {step === "done" ? (
          <Button variant="primary" onClick={() => void open()}>
            Open it
          </Button>
        ) : null}
      </div>
    </section>
  );
}
