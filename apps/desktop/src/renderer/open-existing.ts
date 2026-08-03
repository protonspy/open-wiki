import type { AdoptOutcome } from "../main/settings.js";

/**
 * Opening a project the application was never told about
 * (`specs/opening-an-existing-project`, R2.1, R2.2, R2.4, R3.3).
 *
 * The decision rather than the buttons, in a module beside the component, for
 * the reason everything else in this renderer is: a component cannot be reached
 * by a test here, and what a chosen directory *means* is the part worth being
 * right about.
 */
export type OpenAttempt =
  /** The chooser was dismissed. Nothing happened, and nothing should be said. */
  | { kind: "cancelled" }
  /** A window is opening on it (R2.2). */
  | { kind: "opened"; name: string }
  /** Not a project — offer to make one there, on that directory (R2.4). */
  | { kind: "create-here"; directory: string };

/** The two calls this takes, and nothing else of the bridge. */
export interface OpenExistingBridge {
  chooseDirectory(): Promise<string | null>;
  openDirectory(directory: string): Promise<AdoptOutcome>;
}

/**
 * Choose a directory, then act on what it turned out to be.
 *
 * **Cancelling is not a failure and never reaches `openDirectory`.** A chooser
 * dismissed with Escape is the most ordinary thing a user does with one, and an
 * error banner for it would be noise on every second click.
 */
export async function openExisting(ow: OpenExistingBridge): Promise<OpenAttempt> {
  const directory = await ow.chooseDirectory();
  if (directory === null) return { kind: "cancelled" };
  const outcome = await ow.openDirectory(directory);
  return outcome.kind === "adopted"
    ? { kind: "opened", name: outcome.project.name }
    : { kind: "create-here", directory: outcome.directory };
}

/**
 * What a directory field holds after the chooser closes (R3.2, R3.3).
 *
 * Cancelling leaves what was typed alone. Clearing it instead would throw away
 * a path somebody typed by hand, which R3.2 keeps working, in the one moment
 * they were looking for the easier way to enter it.
 */
export function directoryAfterChoosing(current: string, chosen: string | null): string {
  return chosen ?? current;
}
