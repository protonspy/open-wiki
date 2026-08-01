import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageView, ProjectInfo, WikiIndex } from "../main/api.js";
import { bridge, hasBridge } from "./bridge.js";
import { renderPageBody } from "./markdown.js";
import { History, parseLink, type Location } from "./navigation.js";
import { RecordingIndicator } from "./RecordingIndicator.js";
import { useRecording } from "./recording.js";

/**
 * The shell (plan 8.2), and browsing the wiki inside it (plan 8.5).
 *
 * The components in this file are deliberately dumb: every decision they would
 * otherwise make — where Back goes, what an anchor means, how a page becomes
 * HTML — is a function in a `.ts` module beside them, which is what a test can
 * reach. What is left is arranging the results.
 */
export function App(): React.JSX.Element {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [index, setIndex] = useState<WikiIndex>({ pages: [], slugs: [] });
  const [page, setPage] = useState<PageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const history = useRef(new History());
  const [location, setLocation] = useState<Location>({ view: "wiki" });
  const recording = useRecording();

  const refreshIndex = useCallback(async () => {
    try {
      setIndex(await bridge().index());
    } catch (e) {
      setError(message(e));
    }
  }, []);

  const go = useCallback((next: Location | null) => {
    if (!next) return;
    setLocation(next);
  }, []);

  const visit = useCallback(
    (next: Location) => {
      go(history.current.visit(next));
    },
    [go],
  );

  useEffect(() => {
    if (!hasBridge()) {
      setError("this page is not running inside the application");
      return;
    }
    void bridge()
      .project()
      .then(setProject)
      .catch((e: unknown) => setError(message(e)));
    void refreshIndex();
  }, [refreshIndex]);

  // 8.10 — the folder changed, whoever wrote it. The index is rebuilt because
  // a new page changes which wikilinks resolve, and the open page is re-read
  // only when it is the one that moved.
  useEffect(() => {
    if (!hasBridge()) return;
    return bridge().onChanged((change) => {
      if (change.area !== "wiki") return;
      void refreshIndex();
      if (location.slug && change.path.endsWith(`/${location.slug}.md`)) {
        void reload(location.slug);
      }
    });
  }, [location.slug, refreshIndex]);

  const reload = useCallback(async (slug: string) => {
    try {
      setPage(await bridge().page(slug));
      setError(null);
    } catch (e) {
      setPage(null);
      setError(message(e));
    }
  }, []);

  useEffect(() => {
    if (location.view !== "wiki" || !location.slug) {
      setPage(null);
      return;
    }
    void reload(location.slug);
  }, [location, reload]);

  const html = useMemo(
    () => (page ? renderPageBody(page.body, { slugs: index.slugs }) : ""),
    [page, index.slugs],
  );

  // One handler for the whole rendered page: a click on an anchor is routed by
  // what `markdown.ts` minted, and anything else leaves the window.
  const onPageClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (event.target as HTMLElement).closest("a");
      if (!anchor) return;
      event.preventDefault();
      const target = parseLink(anchor.getAttribute("href") ?? "");
      if (target.kind === "page") visit({ view: "wiki", slug: target.slug });
      // `source:` is 8.6 and `external` is the system browser; neither is this
      // PR's, and doing nothing is better than doing the wrong thing.
    },
    [visit],
  );

  return (
    <div className="app">
      <header className="chrome">
        <span className="chrome__project">{project?.name ?? "…"}</span>
        <nav className="nav">
          <button onClick={() => go(history.current.back())} disabled={!history.current.canGoBack}>
            ←
          </button>
          <button
            onClick={() => go(history.current.forward())}
            disabled={!history.current.canGoForward}
          >
            →
          </button>
          <button aria-current={location.view === "wiki"} onClick={() => visit({ view: "wiki" })}>
            Wiki
          </button>
          <button
            aria-current={location.view === "sources"}
            onClick={() => visit({ view: "sources" })}
          >
            Sources
          </button>
        </nav>
        <span className="chrome__spacer" />
        <RecordingIndicator recording={recording} />
      </header>

      <main className="main">
        {error ? <p className="error">{error}</p> : null}
        {location.view === "wiki" && !location.slug ? (
          <PageList index={index} onOpen={(slug) => visit({ view: "wiki", slug })} />
        ) : null}
        {location.view === "wiki" && page ? (
          <article className="page">
            <Frontmatter page={page} />
            {/* The markdown is rendered with `html: false`, so what reaches
                here is a closed set of tags this renderer produced. */}
            <div onClick={onPageClick} dangerouslySetInnerHTML={{ __html: html }} />
          </article>
        ) : null}
        {location.view === "sources" ? <p className="empty">The sources screen is 6.2.</p> : null}
      </main>
    </div>
  );
}

function PageList({
  index,
  onOpen,
}: {
  index: WikiIndex;
  onOpen: (slug: string) => void;
}): React.JSX.Element {
  if (index.pages.length === 0) {
    return <p className="empty">This wiki has no pages yet.</p>;
  }
  return (
    <ul className="list">
      {index.pages.map((ref) => (
        <li key={ref.path}>
          <button onClick={() => onOpen(ref.slug)}>{ref.slug}</button>
        </li>
      ))}
    </ul>
  );
}

/** The page's frontmatter, shown as itself — 8.5 asks for it on the page. */
function Frontmatter({ page }: { page: PageView }): React.JSX.Element | null {
  if (page.frontmatterBroken) {
    return <p className="error">This page&rsquo;s frontmatter will not parse.</p>;
  }
  if (!page.frontmatter) return null;
  return (
    <dl className="frontmatter">
      {Object.entries(page.frontmatter).map(([key, value]) => (
        <div key={key} style={{ display: "contents" }}>
          <dt>{key}</dt>
          <dd>{Array.isArray(value) ? value.join(", ") : String(value ?? "")}</dd>
        </div>
      ))}
    </dl>
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
