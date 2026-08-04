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

/**
 * What a citation chip reads (spec `wiki-pane`, R2.7).
 *
 * **The label is the fragment, not the URL.** `rec://fenix-weekly-2026-07-31#14:32`
 * in the middle of a sentence is forty characters of machinery in a line of
 * prose; what the reader wants is *14:32*, and the id is already in the chip's
 * attributes and in the panel the chip opens.
 *
 * `p12` becomes `p.12`, which is how a page is written outside a URL. The
 * fragment itself is untouched — it is what `resolveProvenance` validates and
 * what 8.6 seeks by, so it is never rewritten, only shown differently.
 */
export function citationLabel(scheme: string, fragment: string): string {
  const page = scheme === "src" ? /^p(\d+)$/.exec(fragment) : null;
  return page ? `p.${page[1]}` : fragment;
}

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
      // uxpass 3.1 — an `<a>` with no `href` is not focusable and has no `link`
      // role, so every navigation target inside a page was invisible to
      // assistive technology and unreachable without a mouse: measured at zero
      // focusable elements inside a rendered `<article>`. The `href` stays
      // absent on purpose (see `PAGE_ATTR` above); what was missing is the
      // consequence of that decision being carried through.
      open.attrSet("tabindex", "0");
      open.attrSet("role", "link");
      pushText(state, label);
      state.push("wikilink_close", "a", -1);
    } else {
      // A link to nowhere that looks like a link is worse than obviously
      // missing text — and it is the same thing 7.1 reports.
      //
      // Not focusable, because there is nothing to open: a tab stop that
      // cannot be activated is a promise the page cannot keep. What it gets
      // instead is uxpass 3.2 — the reason it is dead, in the text rather than
      // in a `title` a screen reader may never announce and a keyboard can
      // never surface.
      const open = state.push("wikilink_open", "span", 1);
      open.attrSet("class", "wikilink wikilink--broken");
      open.attrSet("title", `no page named ${target}`);
      pushText(state, label);
      const note = state.push("wikilink_note_open", "span", 1);
      note.attrSet("class", "visually-hidden");
      pushText(state, ` (broken link: no page named ${target})`);
      state.push("wikilink_note_close", "span", -1);
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
    // uxpass 3.1 — reachable from the keyboard, for the same reason and by the
    // same means as a wikilink. The name says what it opens as well as where:
    // the chip reads as its fragment, and *14:32* announced on its own is not
    // a citation anybody can act on.
    open.attrSet("tabindex", "0");
    open.attrSet("role", "link");
    open.attrSet(
      "aria-label",
      `${match[1] === "rec" ? "Recording" : "Source"} ${match[2]!} at ${citationLabel(match[1]!, match[3]!)}`,
    );
    // The chip reads as its fragment; the id and the fragment ride the
    // attributes, which is what the seek and the checks use.
    out.push(
      open,
      textToken(state, citationLabel(match[1]!, match[3]!)),
      new state.Token("provenance_close", "a", -1),
    );
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

/**
 * GFM task lists (uxpass 5.5).
 *
 * `- [ ] item` rendered the brackets literally, which is what markdown-it does
 * without a plugin — and a wiki whose own convention files are written in
 * checklists renders its conventions as punctuation. A core rule rather than a
 * dependency, for the reason at the top of this file: everything here works on
 * tokens, and `html: false` means a page cannot write an `<input>` itself.
 *
 * The box is disabled because this is a *reader*. A live checkbox would be a
 * control that changes nothing on disk, which is the dead-button class the
 * shell spent a whole group removing.
 */
const TASK_MARKER = /^\[([ xX])\]\s+/;

function taskListRule(state: StateCore): void {
  const tokens = state.tokens;
  /** The open list tokens, innermost last, so a nested list is marked too. */
  const lists: number[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
      lists.push(i);
      continue;
    }
    if (token.type === "bullet_list_close" || token.type === "ordered_list_close") {
      lists.pop();
      continue;
    }
    // The first paragraph of a list item, and nothing else: `[ ]` in the middle
    // of a sentence is a bracket somebody typed.
    if (token.type !== "inline") continue;
    if (tokens[i - 1]?.type !== "paragraph_open") continue;
    const item = tokens[i - 2];
    if (item?.type !== "list_item_open") continue;

    const match = TASK_MARKER.exec(token.content);
    const first = token.children?.[0];
    if (!match || !first || first.type !== "text" || !TASK_MARKER.test(first.content)) continue;

    first.content = first.content.replace(TASK_MARKER, "");
    token.content = token.content.replace(TASK_MARKER, "");

    const box = new state.Token("task_checkbox", "input", 0);
    box.attrSet("type", "checkbox");
    box.attrSet("disabled", "");
    if (match[1] !== " ") box.attrSet("checked", "");
    token.children = [box, ...(token.children ?? [])];

    item.attrJoin("class", "task-list-item");
    const list = lists[lists.length - 1];
    // Once per list, however many of its items are tasks — `attrJoin` appends,
    // so four checkboxes would otherwise write the class four times.
    const open = list === undefined ? undefined : tokens[list];
    if (open && !(open.attrGet("class") ?? "").split(" ").includes("contains-task-list")) {
      open.attrJoin("class", "contains-task-list");
    }
  }
}

/**
 * The anchor a heading is addressed by (uxpass 5.6).
 *
 * Headings carried no `id`, so a long page had no in-page anchoring and no table
 * of contents was possible. Diacritics are folded rather than dropped, because a
 * project's content language may be `pt-BR` and *Migração* would otherwise
 * become `mira-o`.
 */
export function headingId(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function headingIdRule(state: StateCore): void {
  // Two headings can legitimately read the same — *Consequences* under each of
  // three decisions — and two elements sharing an id is one nothing can reach.
  const seen = new Map<string, number>();
  for (let i = 0; i < state.tokens.length; i++) {
    const token = state.tokens[i];
    if (token?.type !== "heading_open") continue;
    const base = headingId(state.tokens[i + 1]?.content ?? "");
    if (!base) continue;
    const taken = seen.get(base) ?? 0;
    seen.set(base, taken + 1);
    token.attrSet("id", taken === 0 ? base : `${base}-${String(taken)}`);
  }
}

/** A heading in a page, as a table of contents reads it. */
export interface PageHeading {
  /** 1 for `#`, 2 for `##`, and so on. */
  level: number;
  id: string;
  text: string;
}

/**
 * Every heading in a body, with the id the rendered page will actually carry.
 *
 * Parsed through the same renderer rather than matched with a regular
 * expression: the ids come from the rule above, so a contents entry and the
 * heading it points at cannot disagree — and a `#` inside a fenced block is not
 * a heading, which a regex over the source would not know.
 */
export function extractHeadings(body: string): PageHeading[] {
  const tokens = markdown().parse(body, {} satisfies RenderEnv);
  const headings: PageHeading[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token?.type !== "heading_open") continue;
    const id = token.attrGet("id");
    if (id === null) continue;
    headings.push({
      level: Number(token.tag.slice(1)),
      id,
      text: tokens[i + 1]?.content ?? "",
    });
  }
  return headings;
}

/**
 * Whether the body opens with its own `#` heading (uxpass 5.1).
 *
 * Every page rendered its title twice — the reader drew `titleOfPage`, and the
 * body's own `# Heading` rendered straight after it, two `<h1>` in one
 * `<article>` on every page in the wiki. The body wins where it has an opinion,
 * because dropping it would discard text somebody wrote; the reader supplies the
 * title only when the body has none.
 */
export function opensWithHeading(body: string): boolean {
  const tokens = markdown().parse(body, {} satisfies RenderEnv);
  return tokens[0]?.type === "heading_open" && tokens[0].tag === "h1";
}

let renderer: MarkdownIt | null = null;

function markdown(): MarkdownIt {
  if (!renderer) {
    renderer = new MarkdownIt({ html: false, linkify: false, typographer: false });
    renderer.inline.ruler.before("link", "wikilink", wikilinkRule);
    renderer.core.ruler.push("provenance", provenanceRule);
    renderer.core.ruler.push("tasklist", taskListRule);
    renderer.core.ruler.push("headingid", headingIdRule);
  }
  return renderer;
}

/** A page's body as HTML, with its wikilinks and citations made clickable. */
export function renderPageBody(body: string, options: RenderOptions): string {
  return markdown().render(body, { slugs: new Set(options.slugs) } satisfies RenderEnv);
}
