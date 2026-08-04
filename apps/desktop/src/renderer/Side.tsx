import type { Finding } from "@open-wiki/access";
import { AudioLines, CircleAlert, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import type { PageView } from "../main/api.js";
import type { PageSource } from "../main/sources.js";
import { bridge } from "./bridge.js";
import { failed, LOADING, ready, valueOf, type Loaded } from "./loaded.js";
import { extractHeadings, type PageHeading } from "./markdown.js";
import { ICON_SM } from "./ui/icons.js";

/**
 * Beside the page: where it came from, and what is wrong with it (spec
 * `wiki-pane`, R3).
 *
 * Both questions are about the page in front of the reader, and both are
 * answered by data the backend already serves — 6.5's `sourcesOfPage` and 7.6's
 * checks. Nothing here derives anything: it arranges two lists and omits either
 * one when it is empty, because a header over nothing is a claim that there was
 * something to say.
 */

export interface SideProps {
  page: PageView;
  /** Bumped when the project changed, so both lists refetch. */
  reloadKey: number;
  onOpenSource: (id: string, fragment: string) => void;
  /**
   * Whether it is showing while it is a sheet rather than a column
   * (uxpass 1.1). Inert at the widths where it is a column — see `Tree`.
   */
  open?: boolean;
}

export function Side({
  page,
  reloadKey,
  onOpenSource,
  open = false,
}: SideProps): React.JSX.Element {
  return (
    <aside className="side" aria-label="About this page" data-open={String(open)}>
      <PageContents body={page.body} />
      <PageProvenance slug={page.slug} reloadKey={reloadKey} onOpen={onOpenSource} />
      <PageFindings path={page.path} reloadKey={reloadKey} />
    </aside>
  );
}

/**
 * How many headings a page has to have before a contents list earns its place
 * (uxpass 5.6).
 *
 * Below this the list is longer than the scrolling it saves — and it would sit
 * above the provenance, which is the column's actual subject.
 */
export const CONTENTS_THRESHOLD = 4;

/** Which headings a contents list shows, or none at all. */
export function contentsOf(body: string): PageHeading[] {
  // `h1` is the page's own title, which is at the top of the column already.
  const inside = extractHeadings(body).filter(
    (heading) => heading.level >= 2 && heading.level <= 3,
  );
  return inside.length >= CONTENTS_THRESHOLD ? inside : [];
}

/**
 * The page's own headings, for a page long enough to get lost in (uxpass 5.6).
 *
 * The ids come from `markdown.ts`'s own rule, through the same parse the reader
 * renders — so an entry here and the heading it points at cannot disagree about
 * what the anchor is called.
 */
export function PageContents({ body }: { body: string }): React.JSX.Element | null {
  const headings = contentsOf(body);
  if (headings.length === 0) return null;
  return (
    <>
      <p className="side-title">On this page</p>
      <nav className="side-toc" aria-label="On this page">
        {headings.map((heading) => (
          <button
            key={heading.id}
            type="button"
            className={heading.level > 2 ? "side-toc__item side-toc__item--deep" : "side-toc__item"}
            onClick={() => document.getElementById(heading.id)?.scrollIntoView({ block: "start" })}
          >
            {heading.text}
          </button>
        ))}
      </nav>
    </>
  );
}

/**
 * Which sources the open page came from (plan 6.5) — the inverse of the sources
 * screen's "cited by" (6.4).
 *
 * A citation whose source is not there is **shown as broken, not hidden**
 * (R3.3) — the same choice 8.5 makes for a wikilink that does not resolve.
 * Dropping it would leave the reader believing the page is sourced, which is
 * the one wrong answer available here.
 */
export function PageProvenance({
  slug,
  reloadKey,
  onOpen,
}: {
  slug: string;
  reloadKey: number;
  onOpen: (id: string, fragment: string) => void;
}): React.JSX.Element | null {
  const [loaded, setLoaded] = useState<Loaded<PageSource[]>>(LOADING);

  useEffect(() => {
    // **Cleared first.** This component survives navigation — same instance, no
    // `key` — so without this the previous page's sources stay on screen beside
    // the new page's body until the walk over the wiki returns. For a panel
    // whose whole job is saying where the page in front of you came from,
    // attributing one page's provenance to another is the one wrong answer.
    setLoaded(LOADING);
    // Guarded as well, against a different failure: a slow answer for the page
    // we have left arriving after the fast one for the page we are on.
    let live = true;
    void bridge()
      .sourcesOfPage(slug)
      .then((found) => {
        if (live) setLoaded(ready(found));
      })
      // 8.3 — **not an empty list.** A read that failed used to omit the
      // section, which reads as "this page rests on nothing" — the opposite
      // claim, made silently, on the panel whose subject is provenance.
      .catch((e: unknown) => {
        if (live) setLoaded(failed(e));
      });
    return () => {
      live = false;
    };
  }, [slug, reloadKey]);

  if (loaded.state === "failed") {
    return (
      <>
        <p className="side-title">Where this page came from</p>
        <p className="error">Could not read this page&rsquo;s sources: {loaded.why}</p>
      </>
    );
  }

  const sources = valueOf(loaded);
  if (!sources || sources.length === 0) return null;

  return (
    <>
      <p className="side-title">Where this page came from</p>
      {sources.map((source) =>
        source.kind === null ? (
          <div key={source.id} className="src-card src-card--broken">
            <span className="name">
              <CircleAlert size={ICON_SM} aria-hidden />
              {source.id}
            </span>
            <span className="meta">{source.reason ?? "this source is not in the project"}</span>
          </div>
        ) : (
          <button
            key={source.id}
            type="button"
            className="src-card"
            // The fragment comes from the backend — the start of a recording,
            // the first page of a document — so this opens the same panel a
            // citation in the prose opens, through the same call.
            onClick={() => onOpen(source.id, source.fragment)}
          >
            <span className="name">
              {source.kind === "recording" ? (
                <AudioLines size={ICON_SM} aria-hidden />
              ) : (
                <FileText size={ICON_SM} aria-hidden />
              )}
              {source.title}
            </span>
            <span className="meta">{source.id}</span>
          </button>
        ),
      )}
    </>
  );
}

/**
 * What the checks say about this page (R3.4).
 *
 * **Filtered by path, not by slug.** A finding's `page` is where the file is —
 * `wiki/topics/retention.md` — and comparing it against `retention` would match
 * nothing at all, on every page, silently. The checks pane shows the rest.
 *
 * Every finding already carries its `fix`, and 7.6's rule holds here: this is
 * rendering, never advice of its own.
 */
export function PageFindings({
  path,
  reloadKey,
}: {
  path: string;
  reloadKey: number;
}): React.JSX.Element | null {
  const [loaded, setLoaded] = useState<Loaded<Finding[]>>(LOADING);

  useEffect(() => {
    setLoaded(LOADING);
    let live = true;
    void bridge()
      .findings()
      .then((found) => {
        if (live) setLoaded(ready(found));
      })
      // 8.3 — the checks pane says this loudly and so does this: an empty list
      // here would claim there is nothing wrong with the page, which is a
      // verdict, and a read that failed reached no verdict at all.
      .catch((e: unknown) => {
        if (live) setLoaded(failed(e));
      });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  if (loaded.state === "failed") {
    return (
      <>
        <p className="side-title side-title--later">Needs attention</p>
        <p className="error">The checks could not run: {loaded.why}</p>
      </>
    );
  }

  const findings = valueOf(loaded);
  const mine = findings ? findingsFor(findings, path) : [];
  if (mine.length === 0) return null;

  return (
    <>
      <p className="side-title side-title--later">Needs attention</p>
      {mine.map((finding, i) => (
        <div key={`${finding.code}-${i}`} className="finding">
          <CircleAlert size={ICON_SM} aria-hidden />
          <span>
            {finding.message}
            <span className="fix">{finding.fix}</span>
          </span>
        </div>
      ))}
    </>
  );
}

/** The findings about one page, by the path they name. */
export function findingsFor(findings: readonly Finding[], path: string): Finding[] {
  return findings.filter((finding) => finding.page === path);
}
