import { noticeAt, type Notice, type Place } from "./notices.js";

/**
 * What one place has to say, if it has anything (plan 1.5, then uxpass 4.1).
 *
 * Rendered at each place rather than once at the top, which is the whole of
 * that task: the component is trivial and where it is put is the point. It
 * lives in its own file because the wiki pane reports in two places of its own
 * — the tree and the page — and importing it back out of `App` would be a
 * cycle.
 *
 * **The region is always in the document, and empty when there is nothing to
 * say.** That is 4.1, and it is not a detail: a live region is announced only if
 * the assistive technology was already watching it when its contents changed.
 * A `<p>` that appears at the moment of the failure — which is what this
 * returned before — is a `<p>` nobody hears about. `.reported:empty` is what
 * keeps it out of the layout in the meantime.
 *
 * A failure is an `alert` and anything else is a `status`, because the two are
 * not the same interruption: a rename that repointed six links can wait for a
 * pause in the speech, and a save that did not happen cannot.
 */
export function Reported({
  notices,
  place,
}: {
  notices: readonly Notice[];
  place: Place;
}): React.JSX.Element {
  const notice = noticeAt(notices, place);
  const failed = notice?.tone === "error";
  return (
    <div
      className="reported"
      role={failed ? "alert" : "status"}
      aria-live={failed ? "assertive" : "polite"}
    >
      {notice ? <p className={failed ? "error" : "empty"}>{notice.text}</p> : null}
    </div>
  );
}
