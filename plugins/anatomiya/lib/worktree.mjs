/** Where a linked git worktree came from. */
import { basename, dirname, join, resolve } from "node:path";

import { readHead, realpathOrNull } from "./rules.mjs";

/** How much of a pointer file is read: the longest path a filesystem opens. */
const POINTER_MOST = 4096;

/**
 * The main checkout of the linked worktree rooted here, or null for anything else.
 *
 * A worktree carries only what is tracked, so where `.claude/` is ignored every
 * worktree of a scanned checkout has no map, and the hooks fell silent in the
 * place a session branches off to do its work. Its main checkout is the same
 * repository with the same history, so its counts are the nearest ones there
 * are, and they are handed over under their own name rather than as this
 * checkout's.
 *
 * Read off the files `git worktree add` writes rather than asked of git, for
 * the reason the walk is: a subprocess per tool call. The registration has to
 * sit in the main repository's own `worktrees/` and point back at this marker,
 * so neither a copied `.git` file nor one shipped beside a forged registration
 * reaches another repository's record. A submodule's git directory has no
 * `commondir`, and a git directory not named `.git` (a bare repository, or one
 * moved out with `--separate-git-dir`) names no checkout, so all three keep the
 * boundary's silence. A `core.worktree` redirect is not read either, so the
 * checkout named is the one `git worktree list` prints.
 */
export function mainCheckoutOf(at) {
  const marker = join(at, ".git");
  const link = readHead(marker, POINTER_MOST);
  // Git reads the first line and nothing after it.
  const gitdir = link.kind === "file" ? /^gitdir: (.+)/.exec(link.head.split("\n")[0])?.[1]?.trim() : null;
  if (!gitdir) return null;
  // Both files inside are read against the registration as it was spelled,
  // which is what git does: through a link, `../..` lands somewhere else.
  const own = resolve(at, gitdir);
  const common = readHead(join(own, "commondir"), POINTER_MOST);
  const back = readHead(join(own, "gitdir"), POINTER_MOST);
  if (common.kind !== "file" || back.kind !== "file") return null;
  const here = realpathOrNull(marker);
  if (here === null || realpathOrNull(resolve(own, back.head.trim())) !== here) return null;
  const commonDir = realpathOrNull(resolve(own, common.head.trim()));
  if (commonDir === null) return null;
  const registered = realpathOrNull(own);
  if (registered === null || dirname(registered) !== realpathOrNull(join(commonDir, "worktrees"))) return null;
  return basename(commonDir) === ".git" ? dirname(commonDir) : null;
}
