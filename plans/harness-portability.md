---
autonomy: auto
ci: wait
worktree: per-group
merge: auto
---

# Open Wiki in Claude Code, Codex and opencode

Everything this product scaffolds into a project is addressed to one harness.
`scaffoldSkills` writes `.claude/skills/`, `claude-md.ts` generates `CLAUDE.md`, the
plugin ships Claude Code hooks, and the only thing that refuses a write before it lands
is a Claude Code `PreToolUse` hook. Open a project in Codex or opencode and none of it is
read: the convention is on disk, in a directory that harness never looks in.

`protonspy/spec-claude-code#6` solved the same problem for `scc` — one template set,
paths from a harness profile, an entry file that differs by name — and that is the
shape to copy. Two things do not copy, and they are where the work actually is.

## The first divergence: a project is committed, a workspace is not

`scc init` asks which harness and scaffolds for it. One choice, one answer, because an
`scc` workspace is one developer's setup.

**A project directory is not.** `adr:0013-the-project-directory-is-the-unit` put the
convention inside the repository precisely so that `.mcp.json`, `CLAUDE.md` and the
skills are committed and reach everyone who clones. A team is not homogeneous — one
person on Claude Code and one on Codex is the normal case, not the edge — and a project
scaffolded for one of them silently gives the other nothing.

So **`ow init` takes harnesses, plural**, and a project may carry more than one entry
file. That is a real difference from `scc`, arrived at from a real difference in what
the artifact is for.

## The second divergence: the convention is prose, the gate is machinery

`scc` scaffolds methodology, which is entirely prose. Every byte of it ports by
changing a path and a filename.

This product scaffolds prose **and a gate**, and the gate is machinery — three different
machines, as it turns out, none of which ports by renaming anything:

| | Claude Code | Codex | opencode |
| --- | --- | --- | --- |
| the convention (skills, entry file) | scaffolded | scaffolded, at that harness's paths | scaffolded, at that harness's paths |
| refusal before the write | `PreToolUse`, `permissionDecision: deny`, with `updatedInput` | `PreToolUse`, `should_block`, `apply_patch` named in the blocked path | a plugin's `permission.ask`, `status: "deny"` |
| how it is configured | a hook command in JSON | a hook command in TOML | a JavaScript plugin |
| the documented path in every regime | the `ow write` verb | the `ow write` verb | the `ow write` verb |
| the net if a harness has none | group 7 | group 7 | group 7 |

> **This section said the opposite until 1.1 read the sources.** It was written as *the
> convention is portable, the gate is not*, quoting `adr:0013`'s "hooks are also Claude
> Code's mechanism and nobody else's", and it reserved 3.1 for scaffolding nothing where a
> harness cannot refuse. **All three can refuse.** What varies is the mechanism, not whether
> one exists. See [[what-a-harness-loads]] and `adr:0024-the-convention-ships-to-every-harness`,
> which says *scaffolded per harness* rather than *degrades* for exactly this reason. The
> row for a harness with no interception stays, because it is a claim about the future
> rather than about these three.

**What each harness can enforce is a claim to check against its source**, and that rule is
why the table above is now right. `scc#6` verified its conventions "against each tool's own
source rather than its docs, which disagree in two places", `adr:0013` makes the same demand
a rule, and this is the third time in this repository that reading beat reasoning about a
harness. Anything group 2, 3 or 4 adds to that table is checked the same way.

## The third divergence: no silent default

`scc init` falls back to Claude Code when nobody is at the terminal — "an agent or a CI
job drives `init` exactly as before". That is right for `scc` and wrong here, for a
reason that is specific rather than a matter of taste.

**In `scc`, guessing wrong is discovered by the person who guessed, immediately.** They
are the only user of that workspace; the wrong picker choice shows up in their next
command.

**Here, the person who suffers is somebody else, later.** The convention is committed
(`adr:0013`), so a project scaffolded for the wrong harness looks perfect to whoever ran
`ow init` and gives nothing to the colleague who clones it next week. The feedback loop
that makes a silent default safe is broken, and the failure it produces — files on disk
that the harness never reads — is the exact failure this entire plan exists to end. A
default that reproduces the bug one level up is not a convenience.

So the contract is three-way and the third case refuses:

| invocation | what happens |
| --- | --- |
| a harness named | scaffold it, ask nothing |
| none named, terminal attached | the picker |
| none named, no terminal | refuse, and name the flags |

A refusal costs one second and one flag. A wrong scaffold costs somebody a week and
looks like the product not working.

**This is a breaking change to `ow init`, and calling it one is the point.** Scripts and
`npx open-wiki init` have to name a harness. That is cheap now and expensive after the
first project is scaffolded wrong.

## What this is not allowed to become

**Three copies of the convention.** `adr:0015-the-convention-ships-as-skills` gave it
one home, and the plugin was explicitly forbidden from re-shipping the skills for the
same reason. One template set, three renderings, is the only version of this that does
not drift.

**A second product.** The desktop application, the recorder and the wiki store do not
change. This is entirely about what `ow init` writes and where.

## And the ageing problem, which now has a known answer

`adr:0015` left one thing open: a skill scaffolded into a project ages there, so a
project set up today keeps today's convention forever. `plans/sources-stored-not-parsed.md`
task 5.3 already flags that this is about to bite, because a project scaffolded before
that plan lands has a skill that never mentions source status.

`scc#6` built exactly this answer: hash every managed file against what the current
build renders **and** against what the manifest says was last written, which separates
*unchanged*, *needs updating*, and *the user edited this* — and keep the edited one,
naming it, rather than merging or clobbering. `ow update` is that, and it closes a gap
this project recorded and then had to route around twice.

---

## 1 — Read the harnesses before designing for them

- [x] 1.1 (Unit) Establish, from each harness's own source, what it loads and from where: entry file, skills or equivalent, MCP configuration, and what — if anything — can inspect or refuse a write before it lands. Record it as findings with citations, because everything below is built on it and `adr:0013` is explicit that a claim about a harness that was reasoned rather than read does not belong in this repository
  - [[what-a-harness-loads]], read from each harness own source. Entry file, convention directory, MCP configuration and interception for all three, each line cited to the file it came from.
  - **It overturned this plan premise.** The plan says the convention is portable and the gate is not, and reserves 3.1 for scaffolding nothing where a harness cannot intercept. All three can: Codex has `PreToolUse` carrying `should_block` and names `apply_patch` in the blocked path, and opencode refuses through `permission.ask`. What varies is the mechanism — a hook in JSON, a hook in TOML, a JavaScript plugin.
  - **And opencode hook that can refuse is not the obvious one.** `tool.execute.before` returns `Promise<void>` and its output carries only `args`, so it can rewrite what a tool was asked to do and cannot refuse it. A plugin written against it would silently permit everything.
  - **Two of the three read `CLAUDE.md`** — opencode names it directly, Codex can be configured to. A project scaffolded for more than one harness can load the same convention twice under two names, which 2.2 has to decide about rather than discover.
  - The exercise is the point: `adr:0013` exists because a claim about a harness was reasoned rather than read, and was wrong. Second time asked, second time reading beat reasoning.
- [x] 1.2 (Unit) An ADR: the convention ships to every harness, the gate degrades per harness, and a project may carry more than one. It narrows `adr:0015` — which said the convention ships as skills, in the singular — rather than superseding it, and it is hard to reverse because it decides what is committed into every project this product touches. It is the *mechanics*; the stance it applies is already recorded in `adr:0020-decisions-are-made-for-every-harness`, which deliberately left these questions to this task
  - `adr:0024-the-convention-ships-to-every-harness`. It narrows `adr:0015` rather than superseding it: the convention still ships as skills wherever a harness has a skills directory, and ships the same text under whatever that harness reads where one does not.
  - **It says "scaffolded per harness", not "degrades".** That word assumed a hierarchy 1.1 did not find. Where a harness offers interception the strongest one is scaffolded; the branch for a harness offering none stays, because it is a claim about the future rather than about these three.
  - **`ow write` is the documented path in every regime**, not only where hooks are absent. It is the one path that is the same everywhere, and a convention recommending it conditionally has to explain the condition.

## 2 — One template set, three renderings

- [x] 2.1 (Unit) A harness profile: entry filename, convention directory, MCP configuration path and schema, and the interception this harness offers — the strongest one, which the gate scaffolds and the convention text names. Data, not branches — the same move that let `scc` delete its per-harness template tree instead of growing two more. **Not "what the gate degrades to"**, which is how this task read before 1.1: `adr:0024` rejected the word because it assumed a hierarchy the source does not support
  - `packages/access/src/harness.ts` — `HARNESSES`, `PROFILES`, and the queries a renderer needs. No branch on harness identity anywhere outside it.
  - **Reading corrected the plan a second time. All three harnesses read project-local skills**, with `SKILL.md`, from a directory this product can write: `.claude/skills`, `.codex/skills` (`SkillScope::Repo`, `codex-rs/core-skills/src/loader.rs`), `.opencode/skills` (`packages/core/src/config/plugin/skill.ts`, and opencode's own repository ships one). `adr:0024` was written expecting the convention to ship as a skill only "wherever a harness has a skills directory" and as entry-file text elsewhere. That branch is unexercised by these three, exactly as 1.1's "scaffold nothing where there is no gate" branch was.
  - **Codex also reads `.agents/skills`, and the profile deliberately does not write there.** It is the harness-neutral location and therefore the tempting one; a convention written to a directory several harnesses share is one `ow update` cannot attribute, which would cost 5.1 its per-file answer.
  - **Codex's gate can be JSON.** `.codex/hooks.json` is loaded beside the TOML form (`codex-rs/hooks/src/engine/discovery.rs`), and Codex warns when a layer carries both. So two of the three gates are a JSON hook file and only opencode's is a plugin — a smaller spread than "a hook in JSON, a hook in TOML, a plugin" suggested.
  - **Two entry-file collisions, decided rather than discovered** (`adr:0024` asked for this): Codex and opencode both read `AGENTS.md`, so a project carrying both gets one file serving two harnesses; and opencode reads `CLAUDE.md` as well, so a project carrying Claude Code *and* opencode would load the convention twice. `entryFilesFor` and `harnessesSharingEntryFile` are what 2.2 renders from.
- [x] 2.2 (TDD) Render the convention through the profile, and prove no rendered file for one harness names another's directory. Test-first because that is the failure that ships quietly: a skill that tells a Codex user to look in `.claude/` is wrong in a way nothing errors on
  - **Red observed** before any implementation: 12 assertion failures in `tests/render.spec.ts` against signature-only stubs in `src/render.ts`. The 6 that passed against the stubs are the ones asserting *absence*, which an empty result satisfies — worth naming, because a suite where a third of the cases pass on nothing is a suite that would have been read as mostly-green.
  - `renderConvention` returns `path -> content` and writes nothing. Separating rendering from writing is what lets 2.2 assert over every rendered byte with no temporary directory, and what gives 5.1 something to hash a file against.
  - **The `AGENTS.md` collision is decided, not discovered.** Codex and opencode share the filename, so a project carrying both gets one file that lists each harness's skills directory on its own line. And because opencode reads `CLAUDE.md` too, a project carrying Claude Code beside either of them would otherwise load the whole convention twice in one session — so `CLAUDE.md` becomes a pointer carrying `@AGENTS.md`, which is the answer Claude Code's own reference gives for a repository that already has an `AGENTS.md`. Read from the source, not invented.
  - **An existing test caught a real regression**, which is the entire argument for identifying the covering tests before writing anything: `install.spec.ts` asserts the entry file *links each skill by path*, and the first rendering named only the directory. The rule survives, now rendered through the profile.
  - `claude-md.ts` no longer generates anything — it renders through the profile and writes. One generator, three renderings, per `adr:0024`.
- [x] 2.3 (Unit) `ow init` with a harness named — `--claude`, `--codex`, `--opencode`, and more than one accepted — scaffolds it and asks nothing
  - A flag per harness rather than `--harness <name>` repeated: the set is closed and small, and a flag that spells the answer is the one a person guesses right first time.
  - **`ow.json` gains `harnesses`, and the schema is closed** — so this is a deliberate widening rather than a key that slipped in. It is normalised on read (fixed order, no duplicates) because the file is committed and therefore arrives from a `git clone`; two projects choosing the same set now produce byte-identical settings, which is what stops 5.1 reporting a diff nobody made.
  - **Naming a harness adds it; naming none keeps what the project already is.** Re-running `ow init` has always meant "make this project current", so reading silence as "none" would strip a project of its convention on an idempotent re-run. Adding rather than replacing is also what makes 5.4 a change to a list instead of a re-scaffold.
  - **Empty is a real state, not a missing one.** A project scaffolded before this key existed says `[]`, and that means Claude Code — what it actually has on disk — not "none wanted".
- [x] 2.4 (Unit) `ow init` with none named and a terminal attached opens a picker: the three harnesses, multi-select, nothing preselected. Multi-select is why this is a screen rather than a numbered prompt, and whatever it costs in dependencies is a `docs/stack.md` line like any other
  - `@inquirer/checkbox`, recorded in `docs/stack.md` with the argument for it. Reached only on the interactive path: naming a harness, or running headless, never loads it.
  - `hasTerminal` demands a TTY on **both** streams. Piped input with a terminal on stdout would sit waiting for keystrokes nobody is typing.
  - **Choosing nothing has its own message**, distinct from the headless refusal. They are different situations with different fixes — one is a script to edit, the other is a person who was just asked and answered "none" — and telling the second to pass a flag answers a question they did not ask.
- [x] 2.5 (Unit) `ow init` with none named and **no** terminal refuses, and names the flags. It does not guess — see below
  - The refusal says *why* it refuses, not only what to type. The reason is the whole decision: a wrong scaffold is discovered by a colleague next week, not by the person who ran the command.
  - **This is the breaking change the plan called one.** Four existing tests in `main.spec.ts` now pass `--claude`, which is exactly the migration a script has to make.
- [x] 2.6 (Unit) The launcher and first run offer the same choice as a form, not a picker — the desktop has no terminal, and 8.12 already learned that lesson when a chain of `prompt()` calls answered nothing in a packaged build. Same scaffolder underneath, because a project is the same project whichever door it came through
  - A fifth first-run step, before the language, because it decides which entry files the language is then written into. It cannot be left with nothing chosen — the same refusal the CLI makes headless.
  - **The renderer may not value-import `@open-wiki/access`** (a value import pulls `node:fs` into the browser bundle; the lint rule caught it). So `renderer/harnesses.ts` mirrors the profile's display data, exactly as `languages.ts` already does — and `harness-form.spec.ts` asserts the mirror matches `PROFILES`, because a mirror nobody checks is two answers to one question.
  - The harnesses are validated at the IPC boundary rather than trusted: everything crossing it arrives as `unknown`, and an unrecognised harness reaching the scaffolder would be a directory no harness ever reads.
- [x] 2.7 (Unit) The generated entry file carries the same content under whichever name, including the content language of 8.12 — and is regenerated per harness when that setting changes, since it is generated and the skills are not
  - `setLanguage` regenerates every entry file the project carries, not `CLAUDE.md` alone. A Codex project would otherwise keep an `AGENTS.md` naming the old language while `ow.json` said another — and the entry file is what the agent reads, so the file would win and the setting would look broken.
  - `claude-md.ts` keeps `writeClaudeMd` as `writeEntryFiles` with one harness, so there is one write path rather than two.

## What group 2's review turned up, and what it moved

Both review gates ran on group 2 and between them found four things worth naming here,
because three of them changed code outside group 2's own tasks.

**The gate was never installed.** `ow init` wrote `.claude/hooks/hooks.json` from task 9.5
of [[open-wiki]] onward. Claude Code does not read that file — a project's hooks live under
a `hooks` key in `.claude/settings.json`, and a standalone `hooks/hooks.json` is a plugin's
mechanism resolved inside the plugin's own directory. So the write gate this product's
safety argument rests on has never engaged, and every `ow init` reported installing it. It
surfaced because a reviewer asked for the citation behind `harness.ts`'s Claude Code gate
field and there was none — the one field on that page with no source. Fixed here rather
than deferred: group 2 is what turned the path into a written promise of protection.
`writeHooks` now merges into the settings file and **refuses** one it cannot parse rather
than replacing it, because that file is the user's and carries their permissions.

**Task 3.3 came forward.** `isConfigWrite` guarded `.claude/`, `.mcp.json` and `CLAUDE.md`.
Group 2 made `AGENTS.md`, `.codex/` and `.opencode/` real, and a security review traced the
consequence: in a project scaffolded for Claude Code *and* Codex, an agent running under
Claude's gate could rewrite the convention text Codex loads next session as trusted
instructions, and the gate would answer "allow". That is a cross-harness injection primitive
reachable with no group-3 work at all, so the refusal is now derived from `managedPaths` for
**every** harness — including ones this project does not record, since `ow.json` is
committed too and dropping a harness from it must not unlock its directory.

**A link is never a file this product writes.** `seedWiki` learned in [[open-wiki]] 1.3 that
`existsSync` follows a dangling symlink and answers "nothing there"; `scaffoldSkills` and
the entry-file writer had the old pattern, and group 2 had just pointed both at twice as
many directories. `refuseSymlink` is now in `paths.ts` and applied at every writer.

**And one regression of my own**, caught by the code review: reading "a project with no
harnesses recorded" off the same test as "a project that does not exist" made a headless
`ow init --language pt-BR` refuse against every project created before this feature. The
plan's breaking change was that a *new* project must name a harness — never that an existing
one loses its idempotent re-run.

## 3 — The gate, per harness

- [x] 3.1 (Unit) Scaffold the strongest interception 1.1 found for each harness, and where there is none, scaffold nothing and say so rather than writing a file that looks like a gate and is not
  - `writeGate` installs **only** what this project's harnesses read. It was `writeHooks` unconditionally, so a Codex-only project got a `.claude/settings.json` written into it — a file for a harness nobody asked for, which is this plan's own bug pointing the other way.
  - **Codex's matcher ports unchanged and its hook output is the same envelope.** Codex names its file-editing tool `apply_patch` but accepts `Write` and `Edit` as matcher aliases "for compatibility with hook configurations that describe edits using Claude Code-style names" (`codex-rs/core/src/tools/hook_names.rs`), and answers the same `{"hookSpecificOutput":{"permissionDecision":"deny"}}` (`codex-rs/hooks/src/events/pre_tool_use.rs`). One handler serves both harnesses.
  - **What does not port is the payload.** `apply_patch`'s `tool_input` is `{ command: <raw patch text> }`, command-shaped like `Bash`. `gate/patch.ts` reads the targets out of it, **both ends of a `Move to:` included** — a gate reading only the first would let a page arrive in `wiki/` unvalidated. A patch it cannot parse is refused: unknown is not "touches nothing", and a guard that fails open on malformed input is one that is stepped around with malformed input.
  - opencode's plugin hooks `permission.ask`, never `tool.execute.before` — the latter returns `Promise<void>` and carries only `args`, so a plugin written against it would silently permit everything. The guarded paths are rendered into the plugin as data, from the same `managedPaths` the in-process guard derives from, because that file runs inside opencode with no relationship to our `node_modules`.
  - `GATES_INSTALLED` names all three, changed in this commit rather than ahead of it.
  - **A path is not a string, and both new arms got that wrong first.** A security review confirmed by execution that `src/../wiki/evil.md` walked through each of them: the Codex arm classified the raw parser output with a `startsWith("wiki/")` of its own, and the generated opencode plugin hand-rolled a prefix comparison that also failed open on a trailing separator in `directory` or no `directory` at all. Both now resolve before classifying — the Codex arm by reusing `assertWithin` and `gatedPageRel`, which is what the `Write`/`Edit` arm has always used, and the plugin through `node:path` and `fileURLToPath`. **Reimplementing an audited classifier was the mistake in both cases**, and two classifiers for one question is how they come to disagree.
  - The plugin distinguishes *outside this project* from *could not be resolved*: the first is left alone, because a gate denying every edit elsewhere on the disk would be a general-purpose blocker nobody asked for, and the second is denied, because a check that did not run is not a pass.
  - A project scaffolded before the previous branch has a stale `.claude/hooks/hooks.json` that does nothing. Removing it belongs to `ow update` (5.1), the verb that knows what this product wrote.
- [x] 3.2 (Unit) The `ow write` verb is the documented path wherever hooks are absent, and the convention text says which regime this project is under — a user who believes they are protected and is not is worse off than one who knows they are not
  - **The rule cuts both ways, and the second way nearly shipped**: a gate that is *not* installed must not be described as though it were, which is what group 2's first rendering did for Codex and opencode until a security review caught it.
  - `GateProfile.completes` is the honest distinction. **The refusal is the same strength everywhere; the convenience is not.** Nothing unvalidated reaches `wiki/` under any harness — but Claude Code's hook receives the whole content and answers `updatedInput`, so a page is *completed*, while Codex is handed a patch and opencode only paths. Under those two `ow write` is how a page lands rather than one way among several, and both the entry file and the skill say so rather than leaving it to be discovered from a denial.
  - The skill is one text for every harness, so it states the rule generally and points at the entry file for which regime applies. `SKILLS_VERSION` went to `0.5.0`, which is what makes `ow init` report the older copies instead of silently leaving them.
- [x] 3.3 (Unit) 9.6's refusal — no agent-mediated write reaches `.claude/`, `.mcp.json` or `CLAUDE.md` — extends to every harness's equivalent paths. The reason is unchanged and applies exactly: it is the gate's own configuration, and a write path that reaches it edits away its own restraint through a change that reads as documentation
  - **Done in group 2, because group 2 is what opened the hole.** A security review traced it: with `AGENTS.md` and `.codex/skills/` scaffolded but unguarded, an agent under Claude Code's gate could rewrite what Codex reads next session as instructions. Leaving that to a later group would have shipped the primitive and the fix separately.
  - Derived from `managedPaths`, not a second list — a hand-kept copy is the one that goes stale, and it would go stale in the direction of permitting more. Adding a harness to `harness.ts` guards it by the act of adding it.
  - **Guarded for every harness, whatever this project records.** `ow.json` arrives with a clone like everything else, so a project that quietly dropped `codex` from its list would otherwise unlock `.codex/`.
  - The whole dot-directory is guarded, not only the files this product writes in it. Deriving from `managedPaths` alone *narrowed* the guard on the first attempt — `.claude/settings.local.json` and `.claude/agents/` fell out of it — and a widening that quietly drops coverage is worse than no widening.

## 4 — MCP configuration, per harness

- [x] 4.1 (Unit) `ow consult add` writes to the configuration each harness actually reads, at the shape it actually reads — today it writes `.mcp.json` and nothing else. `adr:0018` made the entry an HTTP URL with a bearer token from the environment, so what varies per harness is the file and its schema, not the server
  - **This task's second sentence was false, and the developer was asked how to answer it.** `adr:0018` decided the entry carries a URL and `Authorization: Bearer ${OPEN_WIKI_TOKEN}`, served by a resident `ow serve` — and *that server does not exist*: no HTTP transport, no signing key, no token, and no task in any plan that builds one. `docs/stack.md` already recorded it as "accepted but not yet built". Writing a URL here would have pointed three harnesses at a port nothing listens on.
  - So this ports **what the product actually has** — the stdio entry — to three harnesses, which is 4.1's own opening clause. `adr:0018` stays unimplemented and is not reopened. When `ow serve` lands, the entry's *shape* changes in one function and the per-harness file and schema do not, which is the useful half of what this task claimed.
  - `.mcp.json` → `mcpServers`, `.codex/config.toml` → `[mcp_servers]` in TOML, `opencode.json` → `mcp`. The format is the profile's answer; a writer assuming JSON everywhere would produce a file Codex refuses to parse rather than one it ignores.
  - **Codex's config is edited, never rewritten.** `smol-toml` parses it to answer one question — is this valid TOML, and is our table already there — and the entry is *appended*. Round-tripping through a serialiser would return the file with every comment and ordering choice deleted, to add four lines to a config we do not own. Re-running replaces rather than duplicates, because TOML forbids defining one table twice: otherwise `ow consult add` run twice would break the very file it was asked to extend.
  - **A file that will not parse is refused, not reset** — the same correction `writeHooks` took in group 2, one level along: this code now writes `opencode.json`, which is somebody's whole opencode configuration rather than a file holding our entry alone.
  - **The first version hand-rolled a line scanner to strip a prior copy of the table, and a security review destroyed it.** Any line whose trimmed text equalled the heading was treated as that heading — including one inside a triple-quoted string, which is ordinary valid TOML. It deleted the closing quotes and every table after, and wrote the wreckage back; `UnparsableMcpConfigError` reported nothing, because it had checked the *original* text and the damage happened after. A scanner that understood strings and comments would have been a TOML lexer, which is **the same mistake group 3 made one file along**. So the text is no longer edited at all: identical entry → the file is not written; absent → the table is appended, which is valid TOML and keeps every comment; present but different → re-serialised from the parse, correct at the cost of formatting, and rare.
  - **"The shape it actually reads" is not just the file and the format, and the first version got that wrong for opencode.** The same `{ command, args }` object went to all three. opencode's local server is a discriminated union — `{ type: "local", command: [...whole argv] }`, no `args` field at all, and its own v1→v2 migration drops an entry carrying no `type`. So an opencode project got a well-formed file, in the right place, that opencode ignored: **this plan's exact bug, produced by the code written to end it.** The entry shape is the profile's answer now, like the file and the format. Codex's stdio transport really is `command: String` beside `args: Vec<String>` (`codex-rs/config/src/mcp_types.rs`), so only opencode differed.
  - **The test that let it ship asserted only that the key existed.** An assertion weak enough to pass on the right shape *and* the wrong one is worth no more than none, and it is the reason this reached review rather than a test run.
  - **A project name is validated before it reaches any config file**, by the rule the registry already had. This path registers nothing, so it never passed that check — and the review found a name carrying a control character producing a `.codex/config.toml` Codex refuses to load, losing every entry in it. `JSON.stringify` is not a TOML escaper: it leaves a raw DEL bare and TOML forbids it. There is now a real one as well, as the layer that would have made such a name harmless anyway.
- [x] 4.2 (Unit) A project configured for more than one harness gets the entry in each, from one source, so that adding a consulted project is one act rather than one per harness
  - One call writes every harness the project records, deduplicated by file. A user made to remember two configuration files would eventually update one, and a half-configured project is the silent failure this plan exists to end.

## 5 — `ow update`

- [x] 5.1 (TDD) Hash every managed file against what this build renders and against what the manifest records as last written, separating unchanged, updatable, and edited-by-the-user. Test-first: the whole value is in the third bucket, and a wrong answer there overwrites something somebody wrote by hand
  - **Red observed** before any implementation: 14 assertion failures in `tests/managed.spec.ts` against signature-only stubs. The 3 that passed assert *absence* and are satisfied by an empty result — worth naming, as in 2.2, because a suite where a fifth of the cases pass on nothing reads as mostly-green.
  - **Two comparisons, not one, is the whole design.** Disk against what this build renders says only "differs", and *differs* covers both "an older build wrote it" and "somebody edited it" — which want opposite treatment. Adding disk against *what we recorded writing* separates them, because only one of the two changes a file after we wrote it.
  - **A fifth bucket the task did not name: `unknown`.** A project scaffolded before the manifest existed has files we have no record of. Folding those into `updatable` would overwrite an edit in *every* such project on its first update — the exact loss this task exists to prevent, arriving through a missing record rather than a wrong comparison. `unknown` is never written over.
  - Only hashes are stored. A copy of every managed file in `.state` would be a second record of content the project already holds, and the copy is the one that goes stale.
  - **`recordManaged` was the one writer that had not learned the symlink lesson**, and a security review found it: `assertWithin` resolves a link and answers about its *target*, so a link planted at `.state/managed.json` passed it and the write landed on whatever it named. `refuseSymlink` now guards it, and `outcomeOf` guards the *read* path the same way — a file classified from one path and rewritten at another is the class of bug groups 3 and 4 each shipped once.
  - **The manifest is exactly as trusted as the repository, and that is now written down rather than assumed.** The same review asked what an attacker who forges a hash gains, and the honest answer is very little: somebody who can commit a forged hash can edit the convention file directly in the same commit, so it is no escalation; the forged path replaces the user's content with *this product's own rendered text* rather than anything the attacker chose; and `ow update` names every file it will rewrite before it rewrites it, so a re-labelled customisation appears in the list under the user's eyes. **Signing it was proposed and declined** — a key that travels with the repository signs nothing, and one that does not travel breaks the clone, which is the case this exists to serve.
  - `ow init` records what it wrote — and **only the files matching what it renders**, because `scaffoldSkills` overwrites nothing, so a skill it *skipped* is somebody else's content. Recording our hash for it would claim authorship of a file we did not write, and the first `ow update` would replace it.
  - **And `unknown` alone would have made this verb useless to everybody who already has a project.** No published build has ever written the manifest, so every managed file in every existing project is `unknown`, nothing is `updatable`, and `ow update` reported *nothing to do* while the skills really were behind — a review measured exactly that. So: the plan says `nothing to do safely` and names the files it cannot judge, and **`--adopt`** takes them over on the user's say-so. Opt-in, because `unknown` means precisely *we cannot tell whether you wrote this*; a flag the user passes after reading the list is a different act from the tool guessing for them.
- [x] 5.2 (Unit) An edited file is kept and named, never merged and never silently replaced, and stays recorded at the version last written — which is the base revision a three-way merge would need later
  - Kept means kept: no merge, no `.orig` beside it, no second prompt. **The recorded hash stays at the version this product last wrote**, which is the base revision — re-recording the user's content as ours would destroy the one fact a three-way merge needs *and* silently reclassify the file as `updatable`, turning "never touched" into "touched the second time".
  - Named rather than counted. "3 files kept" tells a user nothing they can act on.
- [x] 5.3 (Unit) Print the plan grouped by outcome and ask before applying, with the confirmation given up front for unattended callers and a mode that reports and stops
  - The plan prints **before** the write, on the applying path too. A verb that rewrites files in somebody's project and reports only afterwards is one they have to `git diff` to understand.
  - Grouped by outcome rather than listed by path, because the groups are what a user decides on. The `edited` group carries its reason in the heading — somebody who cannot see that list cannot tell their edits survived on purpose rather than by luck.
  - `--yes` is the confirmation up front, `--dry-run` reports and stops, and no terminal with neither flag is a refusal naming **both** — a caller with no terminal is as likely to want the report as the write.
  - **The ask was missing at first**, and a code review found it: refusing only when there was *no* terminal left the terminal case applying immediately, so "show me, then ask" was half implemented. There is a y/n now, defaulting to no — via `readline`, because this repo's own `docs/stack.md` line says `@inquirer/checkbox` earned its place for *multi-select*, which is the thing readline cannot do.
  - "nothing to do" is said outright rather than left to be inferred from an absent section — **except where files sit in `unknown`, where it would be a lie.** See 5.1's `--adopt`.
  - **`ow init`'s stale-skills notice now names `ow update` first.** It went on steering every reader toward `--refresh-skills`, which overwrites edits and all, after the careful verb existed — two verbs solving one problem with opposite guarantees and no cross-reference, which the review rightly refused to call a defensible split.
- [x] 5.4 (Unit) A project scaffolded for one harness can gain another through the same verb, which is what makes 2.3's plural choice something a user can change their mind about
  - `ow update --codex` adds Codex to a Claude Code project: its convention, its entry file, **and its gate**, which is not part of the rendered convention and had to be installed alongside. A convention with no gate beside it is half a scaffold.
  - Added, never replaced — in the settings and in the manifest both. A manifest replace would make every file of the untouched harness `unknown` on the next run, and `unknown` is never written, so the project would quietly stop being updatable at all.
  - The harnesses are recorded **after** the files land. Writing the list first and failing the write would leave a project claiming a harness whose convention never arrived, which is this plan's own bug.
  - **The gate is installed only for a harness this run is actually adding**, and getting that wrong was the worst defect of the group. It was installed for every *recorded* harness — and `writeOpencodePlugin` overwrites unconditionally, and the gate is not hash-tracked — so an ordinary update triggered by a stale skill somewhere else **silently destroyed a hand-edited opencode plugin**, which appeared in neither the plan nor the report. A code review reproduced it by execution. It is 5.2's promise broken through the one door that does not go past the planner, and it is why "the plan is what runs" has to mean *everything* the run writes.

---

## Notes

**Order.** 1.1 blocks group 3 entirely and informs group 2's profile. Nothing else is
sequenced.

**This is the second time this repository has needed a harness profile**, and the first
was `adr:0013` discovering that a `CLAUDE.md` outside the project does not load. Both
times the fact was only available by reading the tool rather than the documentation,
and both times reasoning about it produced a wrong answer first. That is the standing
lesson and 1.1 exists to honour it.

**What stays Claude Code's alone.** The plugin of 10.6 is Claude Code's packaging
format, and there is nothing to ship in its place for the others — the CLI already
covers them. Nothing here promises feature parity; it promises the convention is
readable and the gate's regime is stated.

**`scc` is a dependency of the methodology, not of the product.** Adopting
`spec-claude-code#6` in *this* repository — the sharpened review agents, the six-way
`update` — is a separate act, blocked on a release: the PR merged on 2026-08-02 and the
latest published version is v0.0.2 from 2026-08-01, which has neither. That is a
`scc update` to run when it ships, and it changes nothing a user of Open Wiki sees.
