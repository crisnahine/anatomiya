/**
 * Repositories and linked worktrees, the way `git init` and `git worktree add`
 * leave them.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Git in a directory, with an identity so a commit works on a bare runner. */
export const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.email=t@t.test", "-c", "user.name=T", ...args], { cwd, stdio: "pipe" });

/**
 * A directory removed after the test, spelled as the code resolves it: the
 * native form, which is the long name on Windows where the other keeps 8.3.
 */
export function scratch(t, prefix = "anatomiya-wt-") {
  const dir = mkdtempSync(join(realpathSync.native(tmpdir()), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** One commit of one tracked file, so a worktree can be added; nothing else is tracked. */
export function initWithCommit(dir) {
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, "init", "-q");
  git(dir, "add", "a.txt");
  git(dir, "commit", "-qm", "init");
  return dir;
}

/** A linked worktree of `main` at `at`, on a new branch when one is named and detached otherwise. */
export function addWorktree(main, at, branch = null) {
  git(main, "worktree", "add", "-q", ...(branch === null ? ["--detach"] : ["-b", branch]), at);
  return at;
}

/**
 * Replace a file's contents. Git on Windows marks a worktree's `.git` file
 * hidden, and opening a hidden file to truncate it is refused with EPERM.
 */
export function rewrite(path, text) {
  rmSync(path, { force: true });
  writeFileSync(path, text);
}
