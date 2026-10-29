/**
 * A git repository a test makes, the one way (G22): a scratch directory under
 * the native temp path, `git init` on `main` with signing off, both handed to
 * git through `GIT_CONFIG_COUNT` so the machine's `init.defaultBranch` and
 * `commit.gpgsign` never reach it, and an identity set in the repository so a
 * test may change the author per commit. Removed after the test.
 *
 * Fifteen test files spelled their own copy, and the copies drifted on the
 * three settings `docs/releasing.md` names as having broken CI: `-b main` in
 * fourteen of them, signing off in four, a raw `tmpdir()` against the native
 * path in most.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { removeTree } from "./platform.mjs";

/** `env` with these config entries after whatever `GIT_CONFIG_COUNT` it already carries, so they win. */
export function gitEnv(env, entries) {
  const given = String(env.GIT_CONFIG_COUNT ?? "").trim();
  const count = /^\d+$/.test(given) ? Number(given) : 0;
  const out = { ...env, GIT_CONFIG_COUNT: String(count + entries.length) };
  entries.forEach(([key, value], i) => {
    out[`GIT_CONFIG_KEY_${count + i}`] = key;
    out[`GIT_CONFIG_VALUE_${count + i}`] = value;
  });
  return out;
}

/**
 * The repository: `dir`, `git` (its output as text), the `env` every git here
 * runs with, `write(rel, body)`, `author(email)`, `commit(message)` answering
 * the new head, and `read(rel)`. `body` is what `write` puts in a file given no
 * text; `init` is handed to `git init`; `at` makes the repository at a path the
 * test owns instead of a scratch directory.
 */
export function repository(t, { prefix = "anatomiya-repo-", branch = "main", init = [], email = "t@t.test", name = "T", at = null, body = (rel) => `${rel}\n` } = {}) {
  const dir = at ?? mkdtempSync(join(realpathSync.native(tmpdir()), prefix));
  if (at === null) t.after(() => removeTree(dir));
  else mkdirSync(dir, { recursive: true });
  const env = gitEnv(process.env, [["init.defaultBranch", branch], ["commit.gpgsign", "false"]]);
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe", env }).toString();
  git("init", "-q", ...init);
  const author = (address, as = address.split("@")[0]) => {
    git("config", "user.email", address);
    git("config", "user.name", as);
  };
  author(email, name);
  const write = (rel, text = body(rel)) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  const commit = (message = "commit") => {
    git("add", "-A");
    git("commit", "-qm", message);
    return git("rev-parse", "HEAD").trim();
  };
  const read = (rel) => readFileSync(join(dir, rel), "utf8");
  return { dir, git, env, write, author, commit, read };
}
