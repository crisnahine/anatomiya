/**
 * What a script settles from its own command line before it does any work:
 * whether it was the file run, its flags, and the corpus and output it names.
 *
 * Lives here rather than in `lib/`, because nothing the plugin ships needs it:
 * `plugins/anatomiya/bin/anatomiya.mjs` runs at module scope on purpose.
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

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
 */
export function invokedAs(url) {
  if (!process.argv[1]) return false;
  return realOf(fileURLToPath(url)) === realOf(resolve(process.argv[1]));
}

/**
 * The path behind the links, or the path itself where there is nothing to
 * resolve. Exported because `scripts/claude-build.mjs` asks the same question
 * of the build it finds on PATH, and two spellings of one try/catch is two
 * places to answer it differently.
 */
export function realOf(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * The repositories a corpus run covers, or the names `--only` asked for that
 * the corpus does not hold.
 *
 * A typo used to select nothing and print `0 of 0 repositories passed`, which
 * is exit 0 and reads as an acceptance of a corpus the run never opened.
 */
export function selectRepos(repos, only, nameOf = (r) => r.name) {
  if (only === null) return { repos };
  const wanted = only.split(",");
  const missing = wanted.filter((name) => !repos.some((r) => nameOf(r) === name));
  if (missing.length) return { error: `--only ${only}: the corpus holds no repository named ${missing.join(", ")}` };
  return { repos: repos.filter((r) => wanted.includes(nameOf(r))) };
}

/**
 * Whether the run may write where `--md` points.
 *
 * The target is written whole, and what usually sits there is a run of record
 * somebody merged into a document by hand. `--force` is how a rerun says it
 * meant that file.
 */
export function checkOutput(path, force, exists) {
  if (path === null || force || !exists) return null;
  return `${path} is already there, and this run writes its --md target whole; pass --force to write over it`;
}

/**
 * A script's flags and positionals as `util.parseArgs` reads them, or `{ error,
 * code }` naming the first thing refused.
 *
 * Strict, so an unknown flag and a flag with no value are refused, and so is a
 * value that starts with a dash unless it is written `--flag=-x`: a typo taken
 * as a value is how a release once wrote its notes to a file named after the
 * flag it meant.
 */
export function readArgv(argv, options, { positionals = false } = {}) {
  try {
    return parseArgs({ args: argv, options, allowPositionals: positionals, strict: true });
  } catch (err) {
    return { error: err.message, code: err.code };
  }
}
