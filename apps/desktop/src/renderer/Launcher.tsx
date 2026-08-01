import { useCallback, useEffect, useState } from "react";
import type { KnownProject } from "../main/settings.js";
import { bridge } from "./bridge.js";

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

  const load = useCallback(() => {
    void bridge()
      .knownProjects()
      .then(setProjects)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(load, [load]);

  const create = useCallback(async () => {
    const name = globalThis.prompt?.("A short name for this project")?.trim();
    if (!name) return;
    const directory = globalThis.prompt?.("Where should it live?")?.trim();
    if (!directory) return;
    try {
      await bridge().createProject(name, directory, "en");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [load]);

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
      <div className="editor__bar">
        <button onClick={() => void create()}>New project</button>
      </div>
      <p className="empty">
        Opening a project is <code>ow</code> inside its directory — the same way <code>code .</code>{" "}
        works. This list is a convenience, and it is a cache rather than the truth: a project that
        moved is shown here so you can see that it did.
      </p>
    </div>
  );
}
