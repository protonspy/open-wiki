/**
 * What a window shows, and — the part that matters — what it is allowed to ask
 * for while it decides (plans/desktop-ipc-per-window).
 *
 * `project()` is a round trip, and until it answers the window does not know
 * whether it is a wiki or a launcher. Rendering the project shell in the
 * meantime is not merely early: the shell fetches. A launcher window asked for
 * `wiki:index`, `history:list` and `sources:inbox-waiting` before finding out it
 * had no project, and the main process refused all three — refusals it logged
 * and the window painted as failures, on a window where nothing was wrong.
 *
 * So there are three states, not two. `waiting` is not a launcher that has not
 * arrived yet and not a wiki that has not loaded yet; it is a window that has
 * not been told which it is, and it asks for nothing.
 */
export type WindowView = "waiting" | "launcher" | "project";

/**
 * @param hasProject `null` until `project()` answers — including when it failed,
 *   which is a window that still does not know and still must not ask.
 */
export function windowView(hasProject: boolean | null): WindowView {
  if (hasProject === null) return "waiting";
  return hasProject ? "project" : "launcher";
}

/** Whether a window in this state may use a channel that needs a project. */
export function mayAskForProject(view: WindowView): boolean {
  return view === "project";
}
