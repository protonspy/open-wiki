import clsx from "clsx";

/**
 * A pane with nothing in it yet (uxpass 8.1).
 *
 * **Every empty state in this application was one grey sentence pinned to the
 * top-left of an otherwise empty pane** — *"Pick a page on the left to read
 * it."* over 650px of void, *"Ask the agent to read the project and write a
 * page."* over 570px more. Three things are wrong with that, and the layout is
 * the least of them: the sentence describes the state instead of saying what the
 * pane is for, it offers nothing to do about it, and pinned to a corner of a
 * large empty area it reads as something left over rather than as the screen.
 *
 * So an empty state is a block: what this pane is, one sentence of why, and the
 * first thing to do — the shape `EmptyWiki`'s doorway (plan 1.4) already proved
 * on the one screen where somebody bothered.
 *
 * Centred in the pane, and left-aligned inside itself. Centred prose is harder
 * to read at every line length, and this block is prose.
 */
export interface EmptyProps {
  /** What this pane is, in a few words. Not a report of the state. */
  title: string;
  /** One sentence of why, and what will fill it. */
  children?: React.ReactNode;
  /** The first thing to do here, when there is one. */
  action?: React.ReactNode;
  className?: string;
}

export function Empty({ title, children, action, className }: EmptyProps): React.JSX.Element {
  return (
    <div className={clsx("empty-state", className)}>
      <p className="empty-state__lead">{title}</p>
      {children ? <div className="empty-state__body">{children}</div> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}
