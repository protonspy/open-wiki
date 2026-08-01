import { isIdTaken, slugify } from "./id.js";

/**
 * A recording's id: what it was, plus the day it happened (plan 4.16,
 * `adr:0011-sources-are-named-by-what-they-are`).
 *
 * `fenix-weekly-2026-07-31`. The date is part of the shape rather than a
 * disambiguator that appears only on a clash — recurring meetings are the
 * normal case, and a scheme where the first `fenix-weekly` has no date and the
 * second gets a suffix produces ids whose meaning depends on the order they
 * were created in.
 *
 * **A second recording the same day takes `-2`.** That is the opposite of the
 * rule for a file, which is refused outright (3.6) so the user renames it
 * rather than the application inventing `arquitetura-fenix (2).pdf` on their
 * behalf. The difference is that a filename is a thing the user already has a
 * name for and a recording is not: two `fenix-weekly` on one Tuesday is a
 * normal Tuesday, and there is nothing to rename.
 */

/** How many same-day recordings can share an occasion before it is absurd. */
const MAX_SAME_DAY = 99;

export interface RecordingIdInput {
  /** What is being recorded, as the user typed it. May be empty. */
  occasion: string;
  /** When capture started. */
  at: Date;
}

/**
 * The id, free in this project.
 *
 * **An empty occasion falls back to the timestamp rather than refusing.** A
 * recording that started is worth more than a naming rule, and capture must
 * never be blocked on a text field (`adr:0011`). The fallback is legible as a
 * fallback, which is the point: somebody scanning `raw/` can see which
 * recordings nobody named.
 */
export function recordingId(projectRoot: string, input: RecordingIdInput): string {
  const base = baseId(input);
  if (!isIdTaken(projectRoot, base)) return base;
  for (let n = 2; n <= MAX_SAME_DAY; n++) {
    const candidate = `${base}-${n}`;
    if (!isIdTaken(projectRoot, candidate)) return candidate;
  }
  // A hundred recordings of one occasion on one day is not a naming problem.
  // Falling through to the timestamp keeps capture possible, which is the rule
  // this whole function is built around.
  return `${base}-${timeOf(input.at)}`;
}

/** The id before any same-day suffix. Exported because 4.16's shape is testable alone. */
export function baseId(input: RecordingIdInput): string {
  // `slugify`, not `deriveId`: `deriveId` keeps a trailing `.pdf` because a
  // file's format is part of its identity. An occasion has no format, and
  // "Vendor call re. arch" would otherwise keep `.arch` as though it were one.
  const occasion = slugify(input.occasion);
  const day = dayOf(input.at);
  return occasion === "" ? `recording-${day}-${timeOf(input.at)}` : `${occasion}-${day}`;
}

/** `2026-07-31`, in local time — the day the person remembers having it. */
function dayOf(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** `140211`, for the unnamed fallback and the absurd-collision fallback. */
function timeOf(at: Date): string {
  return `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
