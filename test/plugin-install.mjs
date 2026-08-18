import { mkdtempSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The plugin's own code with no `node_modules` beside it, which is what a
 * marketplace install actually looks like: `/plugin install` copies the files
 * and does not run `npm install`.
 *
 * Shared, because two suites need the same shape: the binary refusing to scan
 * without a parser, and setup deciding there is something to install.
 *
 * Returns the directory to run `bin/anatomiya.mjs` out of, which is also what
 * `pluginRoot()` answers for a module loaded from it.
 */
export function installWithoutDependencies(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-install-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const root = fileURLToPath(new URL("..", import.meta.url));
  for (const part of ["lib", "bin"]) cpSync(join(root, part), join(dir, part), { recursive: true });
  cpSync(join(root, "package.json"), join(dir, "package.json"));
  return dir;
}
