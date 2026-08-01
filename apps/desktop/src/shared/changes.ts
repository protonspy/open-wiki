/**
 * What a change to the project is, and the questions about one that both sides
 * of the bridge ask (plan 8.10).
 *
 * **Its own module because the renderer imports it.** `watcher.ts` starts a
 * chokidar watch, so importing `isOpenPage` from there pulled chokidar —
 * and readdirp, and `node:stream` — into the renderer bundle, where vite
 * externalises node built-ins for the browser and the build then fails on
 * `"Readable" is not exported by "__vite-browser-external"`. The desktop
 * application had never been built, so nothing said so.
 *
 * Nothing here touches the filesystem or `node:path`. That is the property that
 * makes it safe to import from a browser bundle, and it is the reason
 * `toProjectPath` stayed behind in `watcher.ts` with the watch itself.
 */

export type ChangeKind = "added" | "changed" | "removed";

export interface ProjectChange {
  kind: ChangeKind;
  /** Project-relative, with forward slashes — what a page id looks like. */
  path: string;
  /** Which part of the project it landed in. */
  area: "wiki" | "raw" | "other";
}

export function areaOf(relativePath: string): ProjectChange["area"] {
  const head = relativePath.split("/")[0];
  return head === "wiki" || head === "raw" ? head : "other";
}

/**
 * Whether a change is the open page moving (plan 8.10).
 *
 * By slug against the index, not by matching the path's tail. A page is its
 * slug wherever it sits (`adr:0016`), so `wiki/projects/fenix.md` and
 * `wiki/fenix.md` are the same page — and a suffix match would also fire for
 * `wiki/not-fenix.md` on a project where somebody named a page that way.
 */
export function isOpenPage(change: ProjectChange, openSlug: string | undefined): boolean {
  if (!openSlug || change.area !== "wiki") return false;
  const file = change.path.split("/").pop() ?? "";
  return file === `${openSlug}.md`;
}
