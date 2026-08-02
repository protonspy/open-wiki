/**
 * What went wrong, and where (plan 1.5).
 *
 * Every failure in the shell used to land in one `error` string rendered as a
 * single line at the top of `main`. Three things were wrong with that, and
 * only the first is cosmetic:
 *
 * - a failed rename and a failed drop looked identical, so the sentence had to
 *   carry the whole context or the reader could not tell what had failed;
 * - a failure *inside* a pane was reported *outside* it, above a pane that
 *   went on showing stale content as though nothing had happened;
 * - and one slot means the second failure erases the first. A drop that
 *   refused a file while the page was already failing to load left one of the
 *   two on screen, chosen by whichever finished last.
 *
 * So a notice carries the place it belongs to, and each place shows its own.
 * One notice per place: a failure that repeats replaces its predecessor rather
 * than stacking, and a failure somewhere else leaves it alone.
 */

/**
 * Where something happened — the part of the window that has to say so.
 *
 * `shell` is deliberately narrow. It is for what makes the whole window
 * useless: no bridge, no project. Anything a pane, a page or an operation can
 * own belongs to that pane, page or operation instead, which is the whole
 * point of this module.
 */
export type Place = "shell" | "wiki" | "page" | "recording" | "checks";

export interface Notice {
  place: Place;
  /** An error is a failure; a note is what happened, and happened correctly. */
  tone: "error" | "note";
  text: string;
}

/**
 * A failure at a place, from whatever the promise rejected with — or from a
 * sentence, for the refusals this side decides itself and never throws.
 */
export function failure(place: Place, error: unknown): Notice {
  return { place, tone: "error", text: error instanceof Error ? error.message : String(error) };
}

/**
 * Something that happened and is worth saying — a rename that repointed six
 * links, say. It shared the error slot before, and read as a failure because
 * of it: the same red box, the same position, for the two opposite outcomes.
 */
export function note(place: Place, text: string): Notice {
  return { place, tone: "note", text };
}

/** The notice a place is showing, if it is showing one. */
export function noticeAt(notices: readonly Notice[], place: Place): Notice | undefined {
  return notices.find((notice) => notice.place === place);
}

/** Put this notice in its place, replacing whatever that place was showing. */
export function replaceAt(notices: readonly Notice[], notice: Notice): Notice[] {
  return [...notices.filter((existing) => existing.place !== notice.place), notice];
}

/** Nothing to say here any more. */
export function clearAt(notices: readonly Notice[], place: Place): Notice[] {
  return notices.filter((notice) => notice.place !== place);
}

/**
 * The failure at this place is over; anything else it was saying stands.
 *
 * A page that loads after failing to load has answered its own error, and a
 * successful read is the answer. It has not answered the note left by the
 * rename that navigated here, which is a record of something that did happen.
 */
export function clearFailureAt(notices: readonly Notice[], place: Place): Notice[] {
  return notices.filter((notice) => notice.place !== place || notice.tone !== "error");
}
