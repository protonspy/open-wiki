import { Plus, SquarePen, TextCursorInput, Trash2 } from "lucide-react";
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
   * What can be done to the open page (R2.6), wired to the flows 8.7 to 8.9
   * already built. They sit in the bar rather than on the page: the draft draws
   * no chrome on the paper, and the editor it *does* draw is unreachable
   * without an entrance somewhere.
   */
  onEdit: () => void;
  onRename: () => void;
  onDelete: () => void;
  /**
   * The reader's own contents. The wiki pane arranges; what a page looks like
   * is `Reader`'s, and while editing it is the editor's — both are wired in
   * `App`, which is where saving and navigating live.
   */
  reader: React.ReactNode;
  /** The side column, or nothing when no page is open. */
  side?: React.ReactNode;
}

export function WikiPane({
  index,
  page,
  selection,
  notices,
  onOpen,
  onCreate,
  onEdit,
  onRename,
  onDelete,
  reader,
  side,
}: WikiPaneProps): React.JSX.Element {
  const hasSide = page !== null && side !== undefined;
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
        {page ? (
          <>
            <IconButton icon={SquarePen} label="Edit this page" onClick={onEdit} />
            <IconButton icon={TextCursorInput} label="Rename this page" onClick={onRename} />
            <IconButton
              icon={Trash2}
              label="Delete this page"
              className="icon-btn--danger"
              onClick={onDelete}
            />
          </>
        ) : null}
        <Button onClick={onCreate} icon={Plus}>
          New page
        </Button>
      </PaneBar>

      <Tree pages={index.pages} current={selection} onOpen={onOpen} />

      <div className="reader">
        {/* The wiki pane's own failures — reading the index, creating a page —
            in the column the reader is looking at rather than above the whole
            window, where they were indistinguishable from a failed drop. */}
        <Reported notices={notices} place="wiki" />
        {reader}
      </div>

      {hasSide ? side : null}
    </section>
  );
}
