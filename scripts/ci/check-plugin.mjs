/**
 * The plugin's own shape (plan 10.6).
 *
 *   node scripts/ci/check-plugin.mjs
 *
 * `claude plugin validate --strict` is the authority and CI runs it — but it
 * needs the CLI installed, and a check that silently passes when its tool is
 * missing is not a check. This is the floor underneath it: the two manifests
 * parse, they agree on the plugin's name and version, the source path the
 * marketplace names actually exists, and the two things `adr:0015` says must
 * *not* be in here are not in here.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function checkPlugin(repoRoot = root, read = defaultRead, exists = existsSync) {
  const problems = [];

  const marketplace = read(join(repoRoot, ".claude-plugin", "marketplace.json"));
  if (!marketplace)
    return {
      ok: false,
      problems: [".claude-plugin/marketplace.json is missing or will not parse"],
    };
  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
    problems.push("the marketplace lists no plugins");
    return { ok: false, problems };
  }
  // `claude plugin validate --strict` treats a missing description as an
  // error, and this is the floor underneath it — a check that only runs when
  // the CLI installs is a check that reports the tool's absence as success.
  if (!marketplace.description) {
    problems.push("the marketplace has no description — --strict treats that as an error");
  }

  for (const entry of marketplace.plugins) {
    const source = String(entry.source ?? "");
    if (!source.startsWith("./")) {
      problems.push(`plugin "${entry.name}" has a source that is not a path in this repository`);
      continue;
    }
    const dir = join(repoRoot, source);
    if (!exists(dir)) {
      problems.push(`plugin "${entry.name}" names ${source}, which is not there`);
      continue;
    }
    const manifest = read(join(dir, ".claude-plugin", "plugin.json"));
    if (!manifest) {
      problems.push(`${source}/.claude-plugin/plugin.json is missing or will not parse`);
      continue;
    }
    if (manifest.name !== entry.name) {
      problems.push(
        `${source} calls itself "${manifest.name}" and the marketplace calls it "${entry.name}"`,
      );
    }
    if (manifest.version !== entry.version) {
      problems.push(
        `${source} is version ${manifest.version} and the marketplace says ${entry.version}`,
      );
    }
    // `adr:0015-the-convention-ships-as-skills`: the skills have one home, and
    // it is `.claude/skills/` inside each project. A copy here would be a
    // second one, and two copies of a convention drift.
    if (exists(join(dir, "skills"))) {
      problems.push(
        `${source} ships skills — the convention has one home (adr:0015), and it is the project`,
      );
    }
    // A `.mcp.json`'s contents differ per user: it names *other* projects, by
    // name, on that person's machine.
    if (exists(join(dir, ".mcp.json"))) {
      problems.push(`${source} ships a .mcp.json — its contents differ per user`);
    }

    problems.push(...checkHooks(dir, source, read, exists, read(join(repoRoot, CLI_MANIFEST))));
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true };
}

export const CLI_MANIFEST = "packages/cli/package.json";

/**
 * The hook commands have to name the published package, at a pinned version.
 *
 * `npx -y @protonspy/open-wiki gate pre` resolves whatever is `latest` on the
 * registry — on **every page write**, which is the exact cost
 * `scripts/build-cli.mjs` exists to remove. It also defeats 10.3's whole point:
 * the installer and the npm package ship from one tag so they cannot skew, and
 * a hook that picks up `latest` skews by design.
 *
 * **Both halves come from the CLI's manifest**, never written out here. They
 * were a hardcoded string once, and it went stale the moment the package was
 * renamed — while still passing, because the old name is a substring of the new
 * one. A check that cannot tell `open-wiki` from `@protonspy/open-wiki` is a
 * check that would let a hook invoke a package nobody publishes.
 */
function checkHooks(dir, source, read, exists, cli) {
  const file = join(dir, "hooks", "hooks.json");
  if (!exists(file)) return [`${source} ships no hooks — the gate is what the plugin is for`];
  const doc = read(file);
  if (!doc) return [`${source}/hooks/hooks.json is missing or will not parse`];

  const problems = [];
  const version = cli?.version;
  const name = cli?.name;
  if (!name || !version) {
    return [`${CLI_MANIFEST} is missing or declares no name/version to pin hooks against`];
  }
  const entries = Object.values(doc.hooks ?? {}).flat();
  if (entries.length === 0) problems.push(`${source}/hooks/hooks.json declares no hooks`);
  for (const entry of entries) {
    for (const hook of entry?.hooks ?? []) {
      const command = String(hook.command ?? "");
      // Only the commands that invoke this product. Anything else in a hooks
      // file is somebody else's tool and none of this check's business.
      if (!/\bnpx\b/.test(command)) continue;
      if (!command.includes(`${name}@${version}`)) {
        problems.push(
          `${source} runs "${command}" — pin it to ${name}@${String(version)}, or a page write ` +
            `resolves whatever is latest on the registry`,
        );
      }
    }
  }
  return problems;
}

function defaultRead(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const result = checkPlugin();
  if (!result.ok) {
    for (const problem of result.problems) console.error(`plugin: ${problem}`);
    process.exit(1);
  }
  console.log("plugin: ok");
}
