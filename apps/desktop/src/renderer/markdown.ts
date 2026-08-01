import MarkdownIt from "markdown-it";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import type Token from "markdown-it/lib/token.mjs";

/**
 * Rendering a wiki page for the embedded browser (plan 8.5).
 *
 * **Both extensions are markdown-it rules, not replacements over its output.**
 * That is the reason `docs/stack.md` gives for choosing markdown-it in the
 * first place, and it is not a style preference. A `String.replace` over
 * already-serialised HTML does not know what an attribute is: a citation
 * inside a link title lands in `title="…"`, the substitution's own quote ends
 * that attribute, and the rest becomes attribute *names* on somebody else's
 * tag. It also rewrites the inside of code spans, so a page documenting the
 * syntax — `[[target]]`, `rec://…` — renders its own examples as live links,
 * which several pages in this repository already do.
 *
 * Working on tokens removes the class: markdown-it escapes every attribute it
 * writes, and an inline rule never sees a tag.
 *
 * `html: false` on top of that, because the wiki is markdown a person and an
 * agent both write, and a page carrying a `<script>` would run it inside a
 * renderer that has the project open.
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

/**
 * The two attributes that mean "the application handles this".
 *
 * Not an `href` scheme. markdown-it happily renders `[x](page:evil)`, so a
 * scheme is something a page author can mint and the renderer cannot tell
 * apart from its own — while `data-ow-*` is an attribute only these rules
 * emit, because `html: false` means a page cannot write an attribute at all.
 * The distinction is cheap now and load-bearing when 8.6 makes `source:`
 * open a file.
 */
export const PAGE_ATTR = "data-ow-page";
export const SOURCE_ATTR = "data-ow-source";
export const FRAGMENT_ATTR = "data-ow-fragment";

// `[[target]]` or `[[target|label]]`. The target stops at `|` or `]`, so a
// sentence containing a single `[` is untouched.
const WIKILINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

// `src://<id>#p12` and `rec://<id>#14:32` as they appear in prose. The same
// shape `store/provenance.ts` extracts, kept in step deliberately: a citation
// this renders and that does not validate would be a link the reader trusts
// and the checks do not.
const PROVENANCE = /\b(src|rec):\/\/([^\s#)\]]+)#([p\d:]+)/g;

/** Every wikilink in a body, in order. Position matters, so nothing is deduplicated. */
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

interface RenderEnv {
  slugs?: ReadonlySet<string>;
}

const OPEN_BRACKET = 0x5b;

/**
 * `[[target]]` as an inline rule, so it never fires inside a code span, a
 * fence, an autolink or an attribute.
 */
function wikilinkRule(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== OPEN_BRACKET) return false;
  if (state.src.charCodeAt(start + 1) !== OPEN_BRACKET) return false;
  const end = state.src.indexOf("]]", start + 2);
  if (end < 0 || end > state.posMax) return false;

  const inner = state.src.slice(start + 2, end);
  // A `[` inside is not a wikilink; it is a link written next to a bracket.
  if (inner.includes("[") || inner.trim() === "") return false;

  if (!silent) {
    const bar = inner.indexOf("|");
    const target = (bar < 0 ? inner : inner.slice(0, bar)).trim();
    const label = (bar < 0 ? inner : inner.slice(bar + 1)).trim() || target;
    const known = (state.env as RenderEnv).slugs?.has(target) ?? false;

    if (known) {
      const open = state.push("wikilink_open", "a", 1);
      open.attrSet("class", "wikilink");
      open.attrSet(PAGE_ATTR, target);
      pushText(state, label);
      state.push("wikilink_close", "a", -1);
    } else {
      // A link to nowhere that looks like a link is worse than obviously
      // missing text — and it is the same thing 7.1 reports.
      const open = state.push("wikilink_open", "span", 1);
      open.attrSet("class", "wikilink wikilink--broken");
      open.attrSet("title", `no page named ${target}`);
      pushText(state, label);
      state.push("wikilink_close", "span", -1);
    }
  }
  state.pos = end + 2;
  return true;
}

function pushText(state: StateInline, content: string): void {
  const token = state.push("text", "", 0);
  token.content = content;
}

/**
 * Citations, as a core rule that splits the text tokens an inline pass already
 * produced. Splitting text rather than matching source is what keeps it out of
 * code spans: by this point a code span is a `code_inline` token, not text.
 */
function provenanceRule(state: StateCore): void {
  for (const block of state.tokens) {
    if (block.type !== "inline" || !block.children) continue;
    const rebuilt: Token[] = [];
    for (const child of block.children) {
      if (child.type !== "text") {
        rebuilt.push(child);
        continue;
      }
      rebuilt.push(...splitProvenance(state, child));
    }
    block.children = rebuilt;
  }
}

function splitProvenance(state: StateCore, token: Token): Token[] {
  const text = token.content;
  PROVENANCE.lastIndex = 0;
  let cursor = 0;
  const out: Token[] = [];
  for (const match of text.matchAll(PROVENANCE)) {
    const at = match.index;
    if (at > cursor) out.push(textToken(state, text.slice(cursor, at)));
    const open = new state.Token("provenance_open", "a", 1);
    open.attrSet("class", `provenance provenance--${match[1]!}`);
    open.attrSet(SOURCE_ATTR, match[2]!);
    open.attrSet(FRAGMENT_ATTR, match[3]!);
    out.push(open, textToken(state, match[0]), new state.Token("provenance_close", "a", -1));
    cursor = at + match[0].length;
  }
  if (out.length === 0) return [token];
  if (cursor < text.length) out.push(textToken(state, text.slice(cursor)));
  return out;
}

function textToken(state: StateCore, content: string): Token {
  const token = new state.Token("text", "", 0);
  token.content = content;
  return token;
}

let renderer: MarkdownIt | null = null;

function markdown(): MarkdownIt {
  if (!renderer) {
    renderer = new MarkdownIt({ html: false, linkify: false, typographer: false });
    renderer.inline.ruler.before("link", "wikilink", wikilinkRule);
    renderer.core.ruler.push("provenance", provenanceRule);
  }
  return renderer;
}

/** A page's body as HTML, with its wikilinks and citations made clickable. */
export function renderPageBody(body: string, options: RenderOptions): string {
  return markdown().render(body, { slugs: new Set(options.slugs) } satisfies RenderEnv);
}
