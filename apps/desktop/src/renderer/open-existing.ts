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

/** What a project whose directory moved came to (uxpass 8.4). */
export type RelocateAttempt =
  | { kind: "cancelled" }
  /** Found: the registry now points at where it actually is. */
  | { kind: "relocated"; name: string }
  /** The chosen directory is not a project — offer to make one there. */
  | { kind: "not-a-project"; directory: string };

/** The three calls a relocate takes, and nothing else of the bridge. */
export interface RelocateBridge extends OpenExistingBridge {
  forgetProject(name: string): Promise<void>;
}

/**
 * Point a moved project at where it actually is (uxpass 8.4).
 *
 * A project marked **not where it was** offered only **Forget**, so a moved
 * project was a dead end: the one thing anybody wants to do with it — say where
 * it went — was the one thing the screen could not do.
 *
 * **The stale entry is dropped before the directory is taken on**, and the order
 * is the whole of the design. `adoptProject` derives a *free* name from the
 * directory, and the entry that moved is holding the name this project is
 * called: adopting first would register it as `fenix-2` beside a `fenix` that
 * points at nothing. Dropping a pointer that already resolves to nothing costs
 * nothing — the registry is a cache and never truth (2.2), and the directory is
 * what is real.
 *
 * The chooser is answered *first*, so cancelling forgets nothing.
 */
export async function relocateProject(ow: RelocateBridge, name: string): Promise<RelocateAttempt> {
  const directory = await ow.chooseDirectory();
  if (directory === null) return { kind: "cancelled" };
  await ow.forgetProject(name);
  const outcome = await ow.openDirectory(directory);
  return outcome.kind === "adopted"
    ? { kind: "relocated", name: outcome.project.name }
    : { kind: "not-a-project", directory: outcome.directory };
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

/**
 * Where a new project is proposed to go (R3.4).
 *
 * `<default location>/<name in kebab-case>`, so naming the project is the whole
 * of saying where it lives — which is the friction
 * `adr:0013-the-project-directory-is-the-unit` left behind when it removed the
 * container folder and left an absolute path to be typed for every project.
 *
 * **The separator is read off the root rather than assumed**, because the root
 * comes from the main process and this code runs in a sandboxed renderer with
 * no `path` module to ask. A Windows root gives `\`; anything else gives `/`.
 *
 * A name that survives no folder name proposes nothing: `WikiProjects\` on its
 * own is not a place to put a project, and offering it would make the Create
 * button look ready.
 */
export function proposedDirectory(defaultRoot: string, name: string): string {
  const folder = kebabCase(name);
  if (defaultRoot === "" || folder === "") return "";
  const separator = defaultRoot.includes("\\") ? "\\" : "/";
  const root = defaultRoot.replace(/[\\/]+$/, "");
  return `${root}${separator}${folder}`;
}

/**
 * A project's name as a folder name (R3.4).
 *
 * What somebody types is prose — `Meu Projeto (2024)` — and what a path wants is
 * one predictable token. Kebab-case is what this repository already names things
 * on disk with: a page's slug, a source's id, a branch. A folder matching the
 * typed name exactly would put spaces and parentheses into every path anybody
 * ever quotes afterwards.
 *
 * **Accents are folded, not dropped**, so `Ação` becomes `acao` rather than
 * `a-o`. This product's content language is often Portuguese (`adr:0008`),
 * which makes an accented name an ordinary case here and not an edge one.
 */
export function kebabCase(name: string): string {
  return (
    name
      .normalize("NFD")
      // The combining marks the decomposition above leaves behind.
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

/** The two ways a project gets made, and which one a click opens (R2.7). */
export type CreationScreen = "first-run" | "form";

/**
 * Which one **New project** should open (R2.7).
 *
 * **The guided run only while this machine has nothing**, because it is the one
 * path that offers the transcription credential, and a first project created
 * without ever being asked about transcription is a worse trade than one extra
 * screen. Once a project exists the compact form fits: whoever is making their
 * second project has already answered those questions once and can reach them
 * in settings.
 *
 * `null` — the list has not come back yet — counts as nothing known. It is the
 * state a brand-new machine passes through, and guessing "form" would flash the
 * wrong screen at exactly the person the guided run is for.
 */
export function creationScreenFor(projects: readonly unknown[] | null): CreationScreen {
  return projects === null || projects.length === 0 ? "first-run" : "form";
}

/**
 * What the directory field should hold, given everything known about it (R3.5).
 *
 * **Once the user has said where, this stops having an opinion.** A proposal
 * that keeps rewriting itself under a hand-typed path is not a convenience;
 * it is the field fighting whoever is using it. So `touched` — set by an edit
 * or by the chooser — ends the proposing for good, and the name may then change
 * freely without moving the project.
 */
export function directoryFor(
  current: string,
  { defaultRoot, name, touched }: { defaultRoot: string; name: string; touched: boolean },
): string {
  if (touched) return current;
  return proposedDirectory(defaultRoot, name);
}
