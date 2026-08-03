/**
 * The paths a Codex `apply_patch` would touch (plan `harness-portability.md` 3.1).
 *
 * **Codex does not hand a hook a file path.** `apply_patch` is how Codex edits
 * a file, and its hook input is *command-shaped*: `tool_input` is
 * `{ command: "<the raw patch text>" }`, the same shape a shell command
 * arrives in. So the gate cannot read `tool_input.file_path` the way it does
 * under Claude Code — it has to read the patch.
 *
 * Read from `codex-rs/core/src/tools/handlers/apply_patch.rs`
 * (`apply_patch_payload_command`, "the raw patch text used as the
 * command-shaped hook input") and `codex-rs/hooks/src/events/pre_tool_use.rs`
 * ("Shell-like tools pass `{ "command": ... }` as `tool_input`").
 *
 * This finds the *targets*, not the resulting content. That distinction is the
 * whole of what the Codex gate can and cannot do, and `hooks.ts` states the
 * consequence rather than papering over it.
 */

/** One file a patch acts on, and what it does to it. */
export interface PatchTarget {
  path: string;
  op: "add" | "update" | "delete";
  /** Where an `Update File` is also being moved to, if it is. */
  movedTo?: string;
}

// The envelope Codex's patch format uses. `*** Move to:` follows an
// `*** Update File:` and renames it, so it is a second path the same hunk
// reaches — and a gate that read only the first would let a page be moved into
// `wiki/` unvalidated, or a guarded file be replaced by moving another over it.
const ADD = /^\*\*\* Add File:\s*(.+?)\s*$/;
const UPDATE = /^\*\*\* Update File:\s*(.+?)\s*$/;
const DELETE = /^\*\*\* Delete File:\s*(.+?)\s*$/;
const MOVE = /^\*\*\* Move to:\s*(.+?)\s*$/;

/**
 * Every path the patch names, in the order it names them.
 *
 * Deliberately permissive about the rest of the format: this is a *guard*, and
 * a guard that only recognises well-formed input is one that is stepped around
 * by malformed input. Anything that looks like a target is treated as one, and
 * a patch this cannot parse yields no targets — which callers must read as
 * "unknown", never as "touches nothing".
 */
export function patchTargets(patch: string): PatchTarget[] {
  const targets: PatchTarget[] = [];
  for (const raw of patch.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const add = ADD.exec(line);
    if (add?.[1]) {
      targets.push({ path: normalise(add[1]), op: "add" });
      continue;
    }
    const update = UPDATE.exec(line);
    if (update?.[1]) {
      targets.push({ path: normalise(update[1]), op: "update" });
      continue;
    }
    const del = DELETE.exec(line);
    if (del?.[1]) {
      targets.push({ path: normalise(del[1]), op: "delete" });
      continue;
    }
    const move = MOVE.exec(line);
    if (move?.[1]) {
      // Attaches to the `Update File` it follows, and stands alone as a target
      // in its own right so a caller checking paths sees both ends of the move.
      const last = targets.at(-1);
      if (last) last.movedTo = normalise(move[1]);
      targets.push({ path: normalise(move[1]), op: "add" });
    }
  }
  return targets;
}

/** Every distinct path a patch reaches, either end of a move included. */
export function patchPaths(patch: string): string[] {
  return [...new Set(patchTargets(patch).map((t) => t.path))];
}

/**
 * Whether this text is a patch at all.
 *
 * `Bash` and `apply_patch` both arrive as `{ command }`, and the gate answers
 * them differently — one is a shell command to scan for redirection, the other
 * is a patch to read targets from. The envelope is what tells them apart.
 */
export function looksLikePatch(command: string): boolean {
  return /^\s*\*\*\* Begin Patch\s*$/m.test(command);
}

/** Backslashes to forward slashes, and no leading `./`. */
function normalise(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}
