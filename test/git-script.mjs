/**
 * A git scripted in git's place inside this process until the test ends, which
 * every reader in `git.mjs` asks first: on every platform, where the git on PATH
 * of `git-stub.mjs` needs a shell to run. A child process this one starts asks
 * the real git.
 *
 * `script(args, line, cwd)` answers one call with `{ code, stdout, stderr }`,
 * `{ signal }`, a promise of either, or null for git itself, `line` being the
 * arguments between two spaces, as the stub's `case` patterns read them, and
 * `cwd` the directory git is asked in. Each call is written down first, and the
 * answer is the calls made so far. A blob reader reads one call at a time while
 * a script stands in, so its batch child is never what a script answers.
 */
import { answerWith } from "../plugins/anatomiya/lib/git.mjs";

export function scriptGit(t, script = () => null) {
  const calls = [];
  const restore = answerWith((args, { cwd }) => {
    const line = ` ${args.join(" ")} `;
    calls.push(line);
    return script(args, line, cwd);
  });
  t.after(restore);
  const read = () => [...calls];
  read.restore = restore;
  return read;
}

/** A git ended by a signal before it answered where `matches(line)`, as one past its clock is. */
export const unaskedWhere = (matches) => (_args, line) => (matches(line) ? { signal: "SIGTERM" } : null);

/** A git ended on the `nth` call that `matches`, and on no other. */
export function unaskedOn(matches, nth) {
  let seen = 0;
  return unaskedWhere((line) => matches(line) && ++seen === nth);
}

/** A git that exits `code` with nothing printed where `matches(line)`. */
export const exitsWhere = (matches, code) => (_args, line) => (matches(line) ? { code } : null);

/** The call that asks whether a commit named by its id is there. */
export const asksById = (line) => / rev-parse --verify --quiet [0-9a-f]{7}[^ ]*\^\{commit\} /.test(line);
