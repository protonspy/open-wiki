import { Pill, type PillTone } from "./ui/Pill.js";

/**
 * The row every pane is topped with (desktop-ui 5.1, 5.2, after the wiki
 * pane's own).
 *
 * A name, how many of whatever the pane is about, and the controls that act on
 * the pane rather than on a row inside it. It is one component because three
 * panes now draw it, and a bar that is 38px in one pane and 40px in the next is
 * how a window stops reading as one window.
 */
export interface PaneBarProps {
  title: string;
  /** How many of whatever this pane lists. Omitted when nobody has counted. */
  count?: number | null;
  countTone?: PillTone;
  /** What the count is called in the singular, for the pill's label. */
  noun?: string;
  /** Said beside the count: what this pane is looking at right now. */
  detail?: React.ReactNode;
  /** The controls, pushed to the right edge. */
  children?: React.ReactNode;
}

export function PaneBar({
  title,
  count,
  countTone,
  noun,
  detail,
  children,
}: PaneBarProps): React.JSX.Element {
  return (
    <div className="pane-bar">
      <span className="pane-title">{title}</span>
      {count === null || count === undefined ? null : (
        <Pill tone={countTone}>{noun ? `${count} ${noun}${count === 1 ? "" : "s"}` : count}</Pill>
      )}
      {detail}
      <span className="pane-bar__spacer" />
      {children}
    </div>
  );
}
