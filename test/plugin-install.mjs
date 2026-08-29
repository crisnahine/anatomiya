import { mkdtempSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ANATOMIYA } from "../scripts/plugins.mjs";

/**
 * The plugin's own code with no `node_modules` beside it, which is what a
 * install that did not run looks like. `/plugin install` does run `npm ci` in
 * a plugin's own directory, but only where it finds a lockfile beside the
 * manifest, and a copy without one is what a failed or skipped install leaves.
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

  // The plugin's own directory is what the marketplace copies, so the fixture
  // copies out of there rather than out of the repository around it.
  for (const part of ["lib", "bin"]) cpSync(join(ANATOMIYA, part), join(dir, part), { recursive: true });
  cpSync(join(ANATOMIYA, "package.json"), join(dir, "package.json"));
  return dir;
}
