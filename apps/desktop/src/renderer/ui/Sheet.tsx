import { X } from "lucide-react";
import { Dialog } from "./Dialog.js";
import { IconButton } from "./IconButton.js";

/**
 * A sheet (plan 2.3): a wide modal panel over the middle of the window, for
 * something with its own settled shape — the settings of 6.1 above all.
 *
 * It is a `Dialog` with a width and a heading. What makes it a sheet rather
 * than a drawer is only where it sits: a sheet is a thing you came here to
 * do, a drawer is a thing you are consulting beside the work.
 */
export interface SheetProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function Sheet({ title, onClose, children }: SheetProps): React.JSX.Element {
  return (
    <Dialog className="sheet" labelledBy="sheet-title" onClose={onClose}>
      {(close) => (
        <>
          <header className="overlay__head">
            <h3 id="sheet-title">{title}</h3>
            <span className="chrome__spacer" />
            <IconButton icon={X} label="Close" onClick={() => close()} />
          </header>
          <div className="overlay__body">{children}</div>
        </>
      )}
    </Dialog>
  );
}
