import clsx from "clsx";

/**
 * A bordered block with an optional heading and actions (plan 2.3).
 *
 * The draft uses it where a pane has several unrelated things to say at once —
 * the MCP pane above all — and nowhere else. A card around a list that is the
 * whole pane is a border drawn inside a border.
 */
export interface CardProps {
  title?: string;
  /** Sits at the right of the heading row, where the draft puts its buttons. */
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function Card({ title, actions, className, children }: CardProps): React.JSX.Element {
  return (
    <section className={clsx("card", className)}>
      {title || actions ? (
        <div className="card__head">
          {title ? <h3>{title}</h3> : null}
          <span className="chrome__spacer" />
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}
