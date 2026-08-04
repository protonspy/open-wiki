import clsx from "clsx";

/**
 * A dense table (plan 2.3), as the draft draws the sources list.
 *
 * The header row is set as a label rather than as content — mono, 10px, upper,
 * quiet — because in a table this dense a bold header competes with the rows
 * it is naming.
 */
export interface Column {
  /** What the header says. */
  header: string;
  /**
   * Whether the header is for the ear only (uxpass 4.3).
   *
   * A column of row actions needs no visible heading — the buttons say what
   * they do — but an unlabelled `<th>` leaves anybody reading the table cell by
   * cell with an unnamed column, which is worse than a redundant word. So the
   * word is written and hidden, rather than not written.
   */
  hiddenHeader?: boolean;
  /**
   * Pushed to the right edge. For counts and for the actions column: a number
   * read down a column is read by its last digit, and a ragged right edge is
   * what makes that impossible.
   */
  align?: "left" | "right";
  /** A hint for the browser's own layout, in any CSS width unit. */
  width?: string;
}

/** The classes a cell wears, given its column. */
export function cellClass(column: Column, extra?: string): string {
  return clsx(column.align === "right" && "table__num", extra);
}

export interface TableProps {
  columns: readonly Column[];
  className?: string;
  /** One `<tr>` per row. Building them is the caller's, because what a row
      says is the caller's — this decides only the frame around them. */
  children: React.ReactNode;
}

export function Table({ columns, className, children }: TableProps): React.JSX.Element {
  return (
    <table className={clsx("table", className)}>
      <thead>
        <tr>
          {columns.map((column, i) => (
            <th
              // By position: two columns may legitimately share a heading, and
              // a key that collides is a column React reuses for another one.
              key={`${column.header}-${i}`}
              scope="col"
              style={{
                width: column.width,
                textAlign: column.align === "right" ? "right" : undefined,
              }}
            >
              {column.hiddenHeader ? (
                <span className="visually-hidden">{column.header}</span>
              ) : (
                column.header
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}
