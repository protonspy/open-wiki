/**
 * What a page created from this window starts as (desktop-ui 8.2).
 *
 * **The type was hardcoded, and the type is not decoration.** Every page the
 * UI made was born `type: topic` — a person, a project and a subject alike —
 * and the type is half of the `id` (`type:slug`, plan 5.1), which means it is
 * also what `ow graph` walks by and what the scaffolded skill tells the agent
 * to write. A window that can only make topics is a window whose pages have to
 * be corrected by hand afterwards, in the one field a later save validates.
 */

export interface PageType {
  value: string;
  label: string;
}

/**
 * The types the scaffolded skill names, and the ones this window offers.
 *
 * The schema does not restrict `type` to a list — it asks for a lowercase
 * token — so this is the vocabulary the convention uses rather than a
 * constraint the store imposes. A project that coins a fourth writes it by
 * hand or through its agent, and nothing here refuses it.
 *
 * Codewiki is absent on purpose: a codewiki page is narrated code and belongs
 * under `wiki/codewiki/`, which is the codewiki skill's job and not a choice in
 * a New page box.
 */
export const PAGE_TYPES: readonly PageType[] = [
  { value: "topic", label: "Topic" },
  { value: "project", label: "Project" },
  { value: "person", label: "Person" },
];

export const DEFAULT_PAGE_TYPE = "topic";

/**
 * A new page that already satisfies the schema, so the first save is not a
 * fight.
 *
 * `today` is passed in rather than read here: it is the `updated` field, the
 * gate validates its shape, and a function that reads the clock is a function
 * a test has to work around.
 */
export function pageTemplate(slug: string, type: string, today: string): string {
  const kind = type.trim() === "" ? DEFAULT_PAGE_TYPE : type.trim();
  return [
    "---",
    // The id carries the type, which is why choosing one matters: `topic:ana`
    // for a person is a page that reads correctly and graphs wrongly.
    `id: ${kind}:${slug}`,
    `type: ${kind}`,
    `title: ${slug}`,
    "status: active",
    "aliases: []",
    `updated: ${today}`,
    "sources: []",
    'superseded-by: ""',
    "---",
    "",
    "",
  ].join("\n");
}
