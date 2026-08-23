/**
 * Whether a module is the file this process was told to run.
 *
 * Compared through the real path on both sides. `import.meta.url` is always
 * resolved and `process.argv[1]` is whatever the caller spelled, so a plain
 * equality answers no for every invocation whose path holds a symlink, and a
 * script guarded by it runs nothing and exits 0. That is a pass nobody asked
 * for on a gate, and a measurement that silently did not happen on the rest.
 * `os.tmpdir()` on macOS is such a path, which is how a test harness reaches
 * it without trying.
 *
 * Lives here rather than in `lib/`, because nothing the plugin ships needs it:
 * `plugins/anatomiya/bin/anatomiya.mjs` runs at module scope on purpose. The second plugin keeps
 * its own copy in `plugins/ultracode-anywhere/hooks/hook-io.mjs`, since a plugin may
 * not run a file outside its own root, and `test/entry.test.mjs` holds the two
 * to the same rule.
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function invokedAs(url) {
  if (!process.argv[1]) return false;
  return realOf(fileURLToPath(url)) === realOf(resolve(process.argv[1]));
}

/** The path behind the links, or the path itself where there is nothing to resolve. */
function realOf(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
