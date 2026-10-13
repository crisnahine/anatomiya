/**
 * A `git` ahead of the real one on this process's own PATH until the test ends,
 * for the readers that take no environment.
 *
 * `script` is shell run before the real git, with `$real` naming it and the
 * call's arguments in `$*` between two spaces. Each call is written down first,
 * and the answer is the calls made so far.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { needsPathControl, needsShebang } from "./platform.mjs";

export const needsGitStub = { ...needsShebang, ...needsPathControl };

export function gitAhead(t, script = "") {
  const bin = mkdtempSync(join(tmpdir(), "anatomiya-git-stub-"));
  const log = join(bin, "calls");
  const real = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
  writeFileSync(log, "");
  writeFileSync(join(bin, "git"), `#!/bin/sh\nreal='${real}'\necho " $* " >> '${log}'\n${script}\nexec "$real" "$@"\n`, { mode: 0o755 });
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  const calls = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  let restored = false;
  calls.restore = () => {
    if (restored) return;
    restored = true;
    process.env.PATH = path;
    // Retried: a read left behind a throw can still be writing its call down here.
    rmSync(bin, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  };
  t.after(calls.restore);
  return calls;
}

/**
 * The shell for a git that could not be asked `pattern` (a `case` pattern over
 * the arguments): it dies of a signal, which leaves no exit code, as a git
 * ended by its caller's clock does.
 */
export const unasked = (pattern) => `case " $* " in ${pattern}) kill -TERM $$;; esac`;

/** The shell for a git that answers `pattern` with exit `code` and nothing else. */
export const exits = (pattern, code) => `case " $* " in ${pattern}) exit ${code};; esac`;

/** The `case` pattern of the call that asks whether a commit named by its id is there. */
export const ASKS_BY_ID = `*' rev-parse --verify --quiet '${"[0-9a-f]".repeat(7)}*'^{commit} '*`;
