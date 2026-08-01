import { randomUUID } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Write a file so that no reader ever sees half of it.
 *
 * Every file this package writes into a recording's directory goes through
 * here — the journal after every chunk, the time map, the timeline, the VTT,
 * the text. Two properties matter and neither is free:
 *
 * **A reader never sees a partial file.** The content lands under a temporary
 * name and the rename is what publishes it. `journal.json` is rewritten after
 * every chunk, which makes it the file most likely to be caught mid-write by a
 * machine going down, and a truncated journal reads as no journal — throwing
 * away an hour of paid-for transcription.
 *
 * **The temporary name is unguessable, and refuses to reuse an entry.**
 * `${target}.tmp` was predictable, and `writeFileSync`'s default flag follows a
 * symlink and truncates whatever it finds — so anything able to plant an entry
 * at that path before the write got an arbitrary file overwritten with content
 * it partly controlled. `raw/` is content: it arrives with a clone, and the
 * window between recording and finishing is hours by design. `wx` makes an
 * existing entry an error rather than a target.
 *
 * It is `packages/access/src/write/atomic-write.ts` restated rather than
 * shared, because the dependency runs the other way.
 */
export function writeAtomic(target: string, contents: string): void {
  const temp = join(dirname(target), `.ow-tmp-${randomUUID()}`);
  try {
    writeFileSync(temp, contents, { encoding: "utf8", flag: "wx" });
    // Rename replaces the *name*, so a symlink sitting at `target` is replaced
    // by the file rather than written through.
    renameSync(temp, target);
  } catch (e) {
    rmSync(temp, { force: true });
    throw e;
  }
}
