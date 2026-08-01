import MarkdownIt from "markdown-it";

/**
 * Rendering a wiki page for the embedded browser (plan 8.5).
 *
 * markdown-it because its plugin model is what lets `[[wikilink]]` and the
 * provenance schemes be taught to it rather than reimplemented around it
 * (`docs/stack.md`). Two rules are added and nothing else is changed.
 *
 * **`html: false`.** The wiki is markdown a person and an agent both write,
 * and a page carrying a `<script>` would run it inside a renderer that has the
 * project open. Nothing in the schema needs raw HTML, so the cheapest answer
 * is not to allow it.
 */

export interface RenderOptions {
  /** Every slug in this wiki, so a dead wikilink can look dead. */
  slugs: readonly string[];
}

export interface Wikilink {
  target: string;
  /** What the reader sees — `[[slug|label]]`. */
  label: string;
  resolved: boolean;
}

// `[[target]]` or `[[target|label]]`. The target stops at `|` or `]`, so a
// sentence containing a single `[` is untouched.
const WIKILINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/** Every wikilink in a body, in order, deduplicated by nothing — position matters. */
export function extractWikilinks(body: string, slugs: readonly string[]): Wikilink[] {
  const known = new Set(slugs);
  const links: Wikilink[] = [];
  for (const match of body.matchAll(WIKILINK)) {
    const target = match[1]!.trim();
    links.push({
      target,
      label: (match[2] ?? match[1]!).trim(),
      resolved: known.has(target),
    });
  }
  return links;
}

/**
 * Replace wikilinks with anchors the renderer understands.
 *
 * A resolved link becomes `<a href="page:<slug>">`, which the app intercepts —
 * never a real navigation, because a renderer that follows an `href` leaves
 * the application. A dead one becomes a `<span>` marked broken rather than a
 * link to nowhere: the reader should see that the page is missing at the point
 * they would have clicked, which is also what 7.1 reports.
 */
export function renderWikilinks(html: string, slugs: readonly string[]): string {
  const known = new Set(slugs);
  return html.replace(WIKILINK, (_whole, rawTarget: string, rawLabel?: string) => {
    const target = rawTarget.trim();
    const label = escapeHtml((rawLabel ?? rawTarget).trim());
    if (!known.has(target)) {
      return `<span class="wikilink wikilink--broken" title="no page named ${escapeHtml(
        target,
      )}">${label}</span>`;
    }
    return `<a class="wikilink" href="page:${encodeURIComponent(target)}">${label}</a>`;
  });
}

// `src://<id>#p12` and `rec://<id>#14:32` as they appear in prose. The same
// shape `store/provenance.ts` extracts, kept in step deliberately: a citation
// this renders and that does not validate would be a link the reader trusts
// and the checks do not.
const PROVENANCE = /\b(src|rec):\/\/([^\s#)\]]+)#([p\d:]+)/g;

/**
 * Turn a provenance citation into a link the application opens at the right
 * instant or page (plan 8.6 does the opening; this is what it clicks).
 */
export function renderProvenance(html: string): string {
  return html.replace(PROVENANCE, (whole, scheme: string, id: string, fragment: string) => {
    const href = `source:${encodeURIComponent(id)}#${encodeURIComponent(fragment)}`;
    return `<a class="provenance provenance--${scheme}" href="${href}">${escapeHtml(whole)}</a>`;
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let renderer: MarkdownIt | null = null;

function markdown(): MarkdownIt {
  renderer ??= new MarkdownIt({ html: false, linkify: false, typographer: false });
  return renderer;
}

/** A page's body as HTML, with its wikilinks and citations made clickable. */
export function renderPageBody(body: string, options: RenderOptions): string {
  const html = markdown().render(body);
  return renderProvenance(renderWikilinks(html, options.slugs));
}
