import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The operation log in `.state/log.jsonl`. It records **what was observed**,
 * not only what this application performed — a hook and the editor both feed
 * it, and the folder observer records changes neither saw (plan task 2.4,
 * `adr:0013-the-project-directory-is-the-unit`).
 */
export type Origin = "editor" | "cli" | "hook" | "observer" | "agent";

export interface OperationPage {
  /** Project-relative path, e.g. `wiki/page.md`. */
  path: string;
  /** Whether the page existed before the operation (drives undo). */
  existed: boolean;
}

export interface Operation {
  id: string;
  time: string;
  origin: Origin;
  pages: OperationPage[];
  snapshotId: string;
}

const LOG_FILE = join(".state", "log.jsonl");

function now(): string {
  return new Date().toISOString();
}

export function appendOperation(projectRoot: string, partial: Omit<Operation, "time">): Operation {
  const op: Operation = { ...partial, time: now() };
  const file = join(projectRoot, LOG_FILE);
  mkdirSync(join(file, ".."), { recursive: true });
  appendFileSync(file, JSON.stringify(op) + "\n", "utf8");
  return op;
}

export function listOperations(projectRoot: string): Operation[] {
  const file = join(projectRoot, LOG_FILE);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Operation);
}

export function getOperation(projectRoot: string, id: string): Operation | undefined {
  return listOperations(projectRoot).find((op) => op.id === id);
}
