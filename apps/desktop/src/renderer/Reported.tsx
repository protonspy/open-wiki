import { noticeAt, type Notice, type Place } from "./notices.js";

/**
 * What one place has to say, if it has anything (plan 1.5).
 *
 * Rendered at each place rather than once at the top, which is the whole of
 * that task: the component is trivial and where it is put is the point. It
 * lives in its own file because the wiki pane reports in two places of its own
 * — the tree and the page — and importing it back out of `App` would be a
 * cycle.
 */
export function Reported({
  notices,
  place,
}: {
  notices: readonly Notice[];
  place: Place;
}): React.JSX.Element | null {
  const notice = noticeAt(notices, place);
  if (!notice) return null;
  return <p className={notice.tone === "error" ? "error" : "empty"}>{notice.text}</p>;
}
