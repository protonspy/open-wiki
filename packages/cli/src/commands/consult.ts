import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `ow consult add <name>` — write a consulting entry into this project's
 * `.mcp.json` that names the *other* project, not its path (plan 9.8). The file
 * is then committable and portable: `ow mcp` resolves the name to a path
 * through the registry on whichever machine runs it.
 */
export function runConsultAdd(projectRoot: string, name: string): string {
  const file = join(projectRoot, ".mcp.json");
  let doc: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(file)) {
    try {
      doc = JSON.parse(readFileSync(file, "utf8")) as { mcpServers?: Record<string, unknown> };
    } catch {
      doc = {};
    }
  }
  doc.mcpServers ??= {};
  const key = `open-wiki-${name}`;
  doc.mcpServers[key] = {
    command: "ow",
    args: ["mcp", "--project", name, "--read-only"],
  };
  writeFileSync(file, JSON.stringify(doc, null, 2) + "\n", "utf8");
  return key;
}
