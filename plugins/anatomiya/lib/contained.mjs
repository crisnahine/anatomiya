/**
 * A path inside the repository, and a read bounded by what this tool may hold:
 * lexical containment, then realpath on both sides, failing closed (F2), and a
 * head or a tail read through a typed handle with a byte cap (F17). Every
 * reader and writer of a repository-controlled path shares these, and nothing
 * here knows what the map is called or who owns a file in it: that is
 * `rules.mjs`, which reads this.
 */
import { accessSync, closeSync, constants, fstatSync, lstatSync, opendirSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { escapes } from "./paths.mjs";
import { TARGETS } from "./targets.mjs";

/**
 * A path resolved through every link and alias the OS keeps, or null where it
 * cannot be resolved at all.
 *
 * `realpathSync.native` where it exists, because on Windows it is the one that
 * expands an 8.3 short name: `tmpdir()` there answers `C:\Users\RUNNER~1\...`
 * while the compiler resolves the same file to the long form, and comparing
 * those two refused every file it discovered for itself.
 *
 * Null and not a throw, because the two callers want opposite things from a
 * failure and only one of them can have the lexical path: a reader deciding
 * where it is must refuse, and a reader comparing two paths may fall back.
 */
export function realpathOrNull(p) {
  try {
    return (realpathSync.native ?? realpathSync)(p);
  } catch {
    return null;
  }
}

/** The same, falling back to the lexical path: a path that does not exist is not a read. */
export const realpathOf = (p) => realpathOrNull(p) ?? resolve(p);

/** The native real path of the deepest part of `p` that exists, with the rest appended as written. */
export function nativeUpTo(p) {
  const real = realpathOrNull(p);
  if (real !== null) return real;
  const parent = dirname(p);
  return parent === p ? p : join(nativeUpTo(parent), basename(p));
}

export function resolveInside(root, relPath, { realpath = realpathSync } = {}) {
  const parts = relPath.split("/");
  // Plain `realpathSync` on both sides here, not the native form
  // `realpathOrNull` uses: this walk compares its own answers against each
  // other, and one side expanded to a Windows long name while the other kept an
  // 8.3 short one would fail to contain a path that is inside.
  let base;
  try {
    base = realpath(root);
  } catch {
    return null;
  }

  let at = base;
  // What the rest of the walk has to stay inside. The repository, until the
  // walk enters `.claude`, and from there `.claude` itself: measured, a
  // committed `.claude/anatomiya -> ../.git/hooks` resolves inside the
  // repository, and a scan wrote facts.json into .git/hooks.
  let fence = base;
  for (let i = 0; i < parts.length; i++) {
    const next = join(at, parts[i]);
    let real;
    try {
      real = realpath(next);
    } catch {
      // A dangling link resolves to nothing and is still a link: creating
      // through it lands wherever it points, the moment that exists.
      if (isLink(next)) return null;
      // Otherwise nothing is there yet, and the rest is ours to create under a
      // parent that already resolved inside.
      return join(at, ...parts.slice(i));
    }
    if (!contains(fence, real)) {
      // `.claude/rules` alone may lead elsewhere in the working tree, never into
      // the git directory: calcom/cal.diy commits `.claude/rules ->
      // ../agents/rules` to share one rules directory between agents, Claude
      // Code reads it through the link, and refused, the scan wrote nothing.
      const shared = i === 1 && `${parts[0]}/${parts[1]}` === TARGETS.claude.dir;
      if (!shared || !contains(base, real) || contains(join(base, ".git"), real)) return null;
      fence = real;
    }
    if (i === 0 && parts[0] === CLAUDE_DIR) {
      // `.claude` itself is the repository's own directory or it is refused: a
      // link to a directory elsewhere in the tree moves the fence with it.
      if (real !== next) return null;
      fence = real;
    }
    at = real;
  }
  return at;
}

const CLAUDE_DIR = ".claude";

/**
 * The refusal a caller prints for a path `resolveInside` answered null for,
 * which names the fence that path is held to.
 */
export const outsideClaude = (relPath) =>
  relPath === TARGETS.claude.dir || relPath.startsWith(`${TARGETS.claude.dir}/`)
    ? `${relPath} resolves where this tool does not write: outside the repository, into its git directory, or through a ${CLAUDE_DIR} that is a link`
    : `${relPath} resolves outside the repository's own ${CLAUDE_DIR} directory`;

/**
 * The first thing on the way down to a directory under the repository that
 * cannot hold it, as a sentence ending before the consequence, or null.
 *
 * Walked lexically, and named by the path the repository spells rather than
 * where it resolves. The resolved name was the one printed, so a committed
 * `.claude/rules -> ../README.md` read "README.md is not a directory ...
 * remove it and scan again", and an agent following that sentence deletes the
 * README. A link is said to be one, and what is to be removed is the link.
 *
 * The nearest directory that exists must also be writable and searchable: the first write
 * into it was a temp file's `open`, whose raw EACCES named a random temp path
 * after a dry run had said "would write". A superuser passes, as it writes.
 */
export function blockedOnTheWay(root, relPath) {
  const base = realpathOrNull(root) ?? resolve(root);
  const parts = relPath.split("/");
  let nearest = { name: "the repository root", at: base };
  for (let i = 1; i <= parts.length; i++) {
    const name = parts.slice(0, i).join("/");
    const at = join(base, ...parts.slice(0, i));
    let entry;
    try {
      entry = lstatSync(at);
    } catch {
      // Nothing there, so the rest is created; or the directory above cannot be
      // entered, which the check below names.
      break;
    }
    if (entry.isSymbolicLink()) {
      const stat = statSync(at, { throwIfNoEntry: false });
      if (!stat?.isDirectory()) {
        const real = realpathOrNull(at);
        const to = real === null ? "nothing" : relative(base, real).split(sep).join("/") || ".";
        return { name, sentence: `${name} is a link to ${to}, which is not a directory`, remedy: "replace the link with a directory" };
      }
    } else if (!entry.isDirectory()) {
      return { name, sentence: `${name} is not a directory`, remedy: "remove it" };
    }
    nearest = { name, at };
  }
  for (const [mode, is] of [[constants.W_OK, "is not writable"], [constants.X_OK, "cannot be entered"]]) {
    try {
      accessSync(nearest.at, mode);
    } catch {
      return { name: nearest.name, sentence: `${nearest.name} ${is}`, remedy: "fix its permissions" };
    }
  }
  return null;
}

/**
 * Whether an atomic replace can put a file at this path: nothing is there, or a
 * file, or a link, which the rename replaces as an entry. A directory is the
 * shape the rename refuses, with a raw `EISDIR` after a dry run said it would
 * write.
 */
export function leafReplaceable(path) {
  try {
    return !lstatSync(path).isDirectory();
  } catch {
    return true;
  }
}

/**
 * Whether the path is a symbolic link, false where even lstat is refused: a
 * directory this may not enter answers EACCES here as well as to realpath.
 */
export function isLink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

export function contains(base, target) {
  return !escapes(relative(base, target));
}

/** The first `most` names a directory lists, in the order it lists them, or none where it will not list: one that comes with the repository is never read whole. */
export function namesIn(dir, most) {
  const names = [];
  try {
    const listing = opendirSync(dir);
    try {
      for (let entry; names.length < most && (entry = listing.readSync()) !== null; ) names.push(entry.name);
    } finally {
      listing.closeSync();
    }
  } catch {
    return [];
  }
  return names;
}

/**
 * The first bytes of a file, `other` when the entry is not a regular file, and
 * `unreadable` when it could not be opened at all.
 *
 * `fstat` on the opened handle and not `lstat` on the path: a symlink to a real
 * `.md` loads into the agent exactly like a regular file and has to be reported
 * like one. What the type test is for is the shapes that cannot be read at all,
 * and it still answers false for a directory, a fifo and `/dev/zero`. Size is
 * the head cap's job.
 *
 * The ownership test reads from byte zero and is closed by the second
 * fence, so nothing past the frontmatter was ever the question. Read whole, one
 * tracked symlink to a large blob took a scan's peak resident size to 1.2 GB,
 * and pointed at `/dev/zero` the read never returned at all.
 *
 * The buffer is the smaller of the cap and the file, so an ordinary five-line
 * rule file costs five lines and only a large one pays the cap. `size` is the
 * file's bytes on disk: a cap asked of the decoded head counts each byte that
 * is not UTF-8 three times. Asked for a `whole` read, a file past the cap is
 * not read at all and comes back with a null head.
 */
export function readHead(path, bytes = HEAD_BYTES, { whole = false } = {}) {
  let fd;
  try {
    // Open first and stat the handle, so the file that is typed is the file
    // that is read: a stat on the path and then an open of the same path is
    // two lookups, and a symlink swapped between them reads something the type
    // test never saw. `O_NONBLOCK` keeps a fifo from blocking the open; it is
    // absent on Windows, where there is no fifo to block on, so it folds to 0.
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { kind: "other" };
    if (whole && stat.size > bytes) return { kind: "file", head: null, size: stat.size, mtimeMs: stat.mtimeMs };
    const want = Math.min(bytes, stat.size);
    if (want === 0) return { kind: "file", head: "", size: stat.size, mtimeMs: stat.mtimeMs };
    const buf = Buffer.alloc(want);
    // A read may return short, so it runs to the end of what was asked for.
    let read = 0;
    while (read < want) {
      const n = readSync(fd, buf, read, want - read, read);
      if (n === 0) break;
      read += n;
    }
    return { kind: "file", head: buf.subarray(0, read).toString("utf8"), size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    // A shape that will not open at all is still a shape, not an unreadable
    // file: a socket refuses everywhere, under an errno that differs per
    // platform, and a directory may on a platform that does not open one. So
    // the path is typed, and nothing is read after it: with no read there is
    // nothing for a swapped path to hand the wrong file to.
    try {
      if (!statSync(path).isFile()) return { kind: "other" };
    } catch {
      // The path is gone or unstattable: an unreadable file is the honest answer.
    }
    // Never an empty head. A file this tool cannot open is one whose ownership
    // it did not check, and answering "" put it through the frontmatter test as
    // if it had: a mode-000 area file of our own came back as somebody else's,
    // was named that way in the always-loaded overview, and could never re-enter
    // the removable set, so a stale map for a deleted directory loaded forever.
    return { kind: "unreadable" };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * The last `bytes` of a regular file, typed on the handle they are read from, or
 * null where it is not one or will not open. The same open `readHead` makes, for
 * its reason: a fifo would block a plain open.
 */
export function readTail(path, bytes) {
  return readTailOf(path, bytes)?.text ?? null;
}

/** The same tail, with the offsets in the file at which it starts and ends: a start of 0 is the whole file. */
export function readTailOf(path, bytes) {
  if (typeof path !== "string" || path === "") return null;
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile()) return null;
    const want = Math.min(bytes, stat.size);
    const buf = Buffer.alloc(want);
    const read = readSync(fd, buf, 0, want, stat.size - want);
    return { text: buf.subarray(0, read).toString("utf8"), start: stat.size - want, end: stat.size - want + read };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * How much of a rule file the ownership test may read.
 *
 * Sized by our own frontmatter, not by a guess about how long one should be: an
 * area's `paths` list is one line per pattern, and a cover needing 170 of them
 * is 14 KB on canvas-lms. Measured at 8 KB, that file's closing fence fell past
 * the head, so this tool's own output came back as a file it had not written:
 * never removable, and named as somebody else's in the always-loaded overview.
 *
 * A megabyte is far past any cover this tool generates and far short of a file
 * worth holding in memory. A frontmatter block longer than this is not one we
 * wrote, and failing to recognise it goes in the safe direction: not ours, so
 * left alone.
 */
export const HEAD_BYTES = 1024 * 1024;
