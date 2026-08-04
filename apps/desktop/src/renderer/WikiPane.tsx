import {
  Download,
  PanelLeft,
  PanelRight,
  Plus,
  SquarePen,
  TextCursorInput,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { PageView, WikiIndex } from "../main/api.js";
import { PaneBar } from "./PaneBar.js";
import { Button } from "./ui/Button.js";
import { IconButton } from "./ui/IconButton.js";
import { Reported } from "./Reported.js";
import { Tree } from "./Tree.js";
import type { Notice } from "./notices.js";

/**
 * The wiki pane (spec `wiki-pane`): a bar over three columns — tree, reader,
 * side — as the draft draws it.
 *
 * **The pane owns the frame; the columns own their own scrolling.** The shell's
 * `<main>` goes into a bleed mode for this pane (no padding, no scroll of its
 * own), because a tree that scrolls with the page it is next to is a tree you
 * lose your place in the moment you read anything long.
 *
 * The side column exists only while a page is open. It answers *where did this
 * page come from* and *what is wrong with it*, and both questions are about a
 * page — with nothing open there is nothing for it to be about, and a 250px
 * column of empty card is not an answer.
 */
export interface WikiPaneProps {
  index: WikiIndex;
  /** The page the reader is showing, once it has loaded. */
  page: PageView | null;
  /** What the location selects, whether or not the page has loaded yet. */
  selection?: string;
  notices: readonly Notice[];
  onOpen: (slug: string) => void;
  onCreate: () => void;
  /**
   * Take the whole project away as one zip (`specs/wiki-export` R4.3,
   * wiki-pane R6.1).
   *
   * **Beside *New page*, because it acts on the wiki.** It used to be the last
   * block of the settings sheet, under the WAV switch — which is where the first
   * version of that sheet had room for it, not where it belongs. A setting is
   * something you change once and live inside; an export is an act on the wiki,
   * the same shelf as creating a page, renaming one, deleting one. All the
   * others are in this bar and that one was three clicks away behind a modal
   * about API keys.
   *
   * Quieter than *New page* on purpose: the pane's one primary action is
   * writing a page, and a second loud button is how an accent stops meaning
   * anything.
   */
  onExport: () => void;
  /**
   * What can be done to the open page (R2.6), wired to the flows 8.7 to 8.9
   * already built. They sit in the bar rather than on the page: the draft draws
   * no chrome on the paper, and the editor it *does* draw is unreachable
   * without an entrance somewhere.
   */
  onEdit: () => void;
  onRename: () => void;
  onDelete: () => void;
  /**
   * Whether the editor is open on the page (uxpass 2.2, 2.4).
   *
   * Two things hang off it. The three page actions are disabled, because all
   * three were live mid-edit and *Delete this page* was one click away from an
   * unsaved draft. And the reader column stops scrolling, so the editor's own
   * two panes can fill it — see `.reader--editing`.
   */
  editing?: boolean;
  /** Save and Cancel, so one screen has one action row (uxpass 2.4). */
  editorActions?: React.ReactNode;
  /**
   * The reader's own contents. The wiki pane arranges; what a page looks like
   * is `Reader`'s, and while editing it is the editor's — both are wired in
   * `App`, which is where saving and navigating live.
   */
  reader: React.ReactNode;
  /**
   * The side column, or nothing when no page is open.
   *
   * A function rather than a node because below ~1000px it is a sheet the pane
   * opens and closes (uxpass 1.1), and whether it is showing is this pane's to
   * know — `App` builds what goes in it and has no business holding that.
   */
  side?: (open: boolean) => React.ReactNode;
}

export function WikiPane({
  index,
  page,
  selection,
  notices,
  onOpen,
  onCreate,
  onExport,
  onEdit,
  onRename,
  onDelete,
  editing = false,
  editorActions,
  reader,
  side,
}: WikiPaneProps): React.JSX.Element {
  const hasSide = page !== null && side !== undefined;
  /**
   * Whether each panel is showing *while it is a sheet* (uxpass 1.1, 1.2).
   *
   * Both start closed, which is what a narrow window wants: the reader is the
   * thing somebody came here for, and 115px of it was the finding this closes.
   * At the widths where they are columns the flags are inert — the media
   * queries in `globals.css` decide, and this component never asks how wide the
   * window is.
   */
  const [treeOpen, setTreeOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);

  return (
    <section className={hasSide ? "wiki-pane" : "wiki-pane wiki-pane--no-side"} aria-label="Wiki">
      <PaneBar
        title="Wiki"
        count={index.pages.length}
        noun="page"
        /* Where the open page actually sits. The old page bar said this and it
           is worth keeping: a folder is not an address, but "which file am I
           reading" is still a fair question. */
        detail={page ? <code className="pane-bar__path">{page.path}</code> : null}
      >
        <IconButton
          icon={PanelLeft}
          label={treeOpen ? "Hide the page list" : "Show the page list"}
          className="pane-bar__panel pane-bar__panel--tree"
          aria-expanded={treeOpen}
          onClick={() => setTreeOpen((open) => !open)}
        />
        {page ? (
          <>
            {/* Disabled while the editor is open (uxpass 2.2). All three were
                live mid-edit, which put *Delete this page* one click away from
                an unsaved draft — and rename and edit would both have thrown
                the buffer away without a word. */}
            <IconButton
              icon={SquarePen}
              label="Edit this page"
              disabled={editing}
              onClick={onEdit}
            />
            <IconButton
              icon={TextCursorInput}
              label="Rename this page"
              disabled={editing}
              onClick={onRename}
            />
            <IconButton
              icon={Trash2}
              label="Delete this page"
              className="icon-btn--danger"
              disabled={editing}
              onClick={onDelete}
            />
          </>
        ) : null}
        {/* Save and Cancel, in the one action row this screen has (2.4). */}
        {editing ? editorActions : null}
        {hasSide ? (
          <IconButton
            icon={PanelRight}
            label={sideOpen ? "Hide what is beside this page" : "Show what is beside this page"}
            className="pane-bar__panel pane-bar__panel--side"
            aria-expanded={sideOpen}
            onClick={() => setSideOpen((open) => !open)}
          />
        ) : null}
        {/* R6.1 — the whole project as one zip, beside the other acts on the
            wiki rather than at the foot of the settings. Disabled while the
            editor is open for the same reason the three page actions are: the
            archive would be written from what is on disk, which is not what is
            on screen. */}
        <Button onClick={onExport} icon={Download} variant="ghost" disabled={editing}>
          Export
        </Button>
        <Button onClick={onCreate} icon={Plus}>
          New page
        </Button>
      </PaneBar>

      <Tree
        pages={index.pages}
        current={selection}
        open={treeOpen}
        onOpen={(slug) => {
          // Picking a page is what the sheet was opened for, so it closes
          // behind you. At the widths where the tree is a column this is a flag
          // nothing reads.
          setTreeOpen(false);
          onOpen(slug);
        }}
      />

      <div className={editing ? "reader reader--editing" : "reader"}>
        {/* The wiki pane's own failures — reading the index, creating a page —
            in the column the reader is looking at rather than above the whole
            window, where they were indistinguishable from a failed drop. */}
        <Reported notices={notices} place="wiki" />
        {reader}
      </div>

      {hasSide ? side(sideOpen) : null}
    </section>
  );
}
