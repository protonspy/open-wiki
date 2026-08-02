import { X } from "lucide-react";
import { Dialog } from "./Dialog.js";
import { IconButton } from "./IconButton.js";

/**
 * A drawer (plan 2.3): full height against the right edge, for something you
 * consult beside the work rather than instead of it — the history of 6.2.
 *
 * It is still a modal `<dialog>`, and that is a deliberate limit rather than
 * an oversight: the history has an Undo button on every line, and a panel that
 * rewrites files while the pane behind it is still clickable is a panel where
 * the two disagree about what the project contains.
 */
export interface DrawerProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function Drawer({ title, onClose, children }: DrawerProps): React.JSX.Element {
  return (
    <Dialog className="drawer" labelledBy="drawer-title" onClose={onClose}>
      {(close) => (
        <>
          <header className="overlay__head">
            <h3 id="drawer-title">{title}</h3>
            <span className="chrome__spacer" />
            <IconButton icon={X} label="Close" onClick={() => close()} />
          </header>
          <div className="overlay__body">{children}</div>
        </>
      )}
    </Dialog>
  );
}
