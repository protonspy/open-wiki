import {
  citedSourcePages,
  formatDenial,
  listSourceStates,
  readManifest,
  readWiki,
  safe,
  updateManifest,
} from "@open-wiki/access";

/**
 * `ow source list|mark|unmark|describe` — plan tasks 4.2, 4.3, 4.4 and 8.2 of
 * `plans/sources-stored-not-parsed.md`.
 *
 * This is the surface **the agent's own loop** works through: `list` says what
 * nobody has finished with, `mark` records the judgement that closes one.
 * `specs/source-status/` settled what gets written and where; this is the door,
 * and it is the sanctioned one because `raw/` is not gated the way `wiki/` is —
 * an agent writing `manifest.json` with its own tools would meet no schema at
 * all (plan task 8.2).
 *
 * **Two verbs rather than one verb with a flag.** `ow source mark <id>
 * --unprocessed` would be a flag whose meaning is the opposite of the verb it
 * modifies, and it would collide with `ow source list --unprocessed`, where the
 * same word selects rather than negates. `mark` and `unmark` add and remove a
 * declaration, which is what the model actually is: absent *is* unprocessed.
 */

export interface SourceMarkResult {
  id: string;
  /** The date the declaration carries, absent once withdrawn. */
  processed?: string;
  /** False when the manifest already said this — a retry, not a failure. */
  changed: boolean;
}

export type SourceMarkOutcome =
  { ok: true; result: SourceMarkResult } | { ok: false; reason: string };

/**
 * Declare a source processed, or withdraw the declaration.
 *
 * Idempotent on purpose, and it **keeps the original date**. The loop marks the
 * same source twice for ordinary reasons — a crash mid-run, a retry after a
 * refusal elsewhere — and the declaration records when somebody read the
 * source, so re-stamping it on a repeat would lose the only fact it carries.
 */
export function runSourceMark(
  projectRoot: string,
  id: string,
  processed: boolean,
  date: string,
): SourceMarkOutcome {
  let declared: string | undefined;
  try {
    declared = readManifest(projectRoot, id).processed;
  } catch (err) {
    return { ok: false, reason: refusal(id, err) };
  }

  const wanted = processed ? (declared ?? date) : undefined;
  const result = (changed: boolean): SourceMarkOutcome => ({
    ok: true,
    result: { id, changed, ...(wanted !== undefined ? { processed: wanted } : {}) },
  });

  if (wanted === declared) return result(false);

  try {
    updateManifest(projectRoot, id, { processed: wanted ?? null });
  } catch (err) {
    return { ok: false, reason: refusal(id, err) };
  }
  return result(true);
}

/**
 * `ow source describe <id> <text>` — record what a source is about (plan 8.2).
 *
 * **The CLI is the sanctioned path**, and that is the point of the task rather
 * than a convenience: `raw/` is not gated the way `wiki/` is, so an agent
 * writing `manifest.json` with its own tools would meet no schema at all — no
 * bound, no blank check, nothing stopping it from replacing the file with
 * whatever it composed. Here it meets `updateManifest`.
 *
 * Written in the same breath as marking the source read (plan 5.5). Reading the
 * file is the expensive part and it has already happened; a description written
 * then costs nothing, and one written later costs the whole read again.
 *
 * Always reports `changed: true`, unlike `runSourceMark`: a description
 * *replaces*, so there is no "already said that" to distinguish and no original
 * date to preserve. Do not read the shared result type as promising parity.
 */
export function runSourceDescribe(
  projectRoot: string,
  id: string,
  description: string,
): SourceMarkOutcome {
  try {
    const written = updateManifest(projectRoot, id, { description });
    return {
      ok: true,
      result: {
        id,
        changed: true,
        ...(written.processed !== undefined ? { processed: written.processed } : {}),
      },
    };
  } catch (err) {
    return { ok: false, reason: refusal(id, err) };
  }
}

/**
 * One refusal, in the shape the gate refuses a page write (plan 9.13) — an
 * agent that learned to read one has learned both.
 *
 * Everything interpolated is run through `safe`: the id arrives on a command
 * line an agent composed, this text goes to stderr an agent reads, and an id
 * carrying a newline plus its own plausible `  - ` bullet would be a refusal
 * that reads as something else. `safe` is the same helper the check report uses
 * for exactly this reason.
 */
function refusal(id: string, err: unknown): string {
  const detail = safe(err instanceof Error ? err.message : String(err));
  return formatDenial(`raw/${safe(id)}/manifest.json`, [
    detail,
    "Run `ow source list` to see the ids this project actually has.",
  ]);
}

/**
 * `ow source list` as JSON — what the agent's loop reads.
 *
 * `unprocessedOnly` is the queue, and it is **exactly** "carries no
 * declaration". It deliberately does not also exclude what pages cite: a
 * citation is not proof of a complete read — a page about one source may cite
 * another in passing — and a source that left the queue because somebody
 * mentioned it is a source silently never read, which is the failure this whole
 * feature exists to remove rather than relocate. The uncited *check* uses both
 * facts, because there the question is a different one.
 */
export function runSourceList(projectRoot: string, unprocessedOnly: boolean): string {
  // One read of the wiki answers `citedBy` for every source, rather than twenty
  // sources meaning twenty walks over the pages.
  const citations = citedSourcePages(readWiki(projectRoot));
  const states = listSourceStates(projectRoot, citations);
  const listed = unprocessedOnly ? states.filter((s) => s.processed === undefined) : states;
  // The free text is already bounded: `sourceState` does it for every reader of
  // a `SourceState`, which is where it belongs. This did it here first, and a
  // review found the two desktop callers that copy would never have reached.
  return JSON.stringify(listed, null, 2);
}
