/**
 * `.claude/rules/`, the one place a file in it is decided to be ours, and the
 * path resolution every reader and writer of it shares.
 *
 * The directory is a *repository* directory, so a clone can ship a rule file
 * with no `paths` key that loads unconditionally from the moment of clone, in
 * our house style, forever. Two surfaces have to answer for that: the writer,
 * which may only remove what it wrote, and the check, which reports whatever
 * else is loading. They used to answer differently, and the disagreement was in
 * the direction that deletes.
 *
 * Ownership is three facts, or the file is left alone: our filename
 * prefix, our frontmatter key, and the map on disk naming it. The prefix alone
 * is a filename anyone can type; the frontmatter alone is a file an older build
 * wrote and this one knows nothing about.
 */
import { accessSync, closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, isAbsolute, resolve, sep } from "node:path";

import { TARGETS, areaName, overviewName } from "./targets.mjs";

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

export const RULES_DIR = TARGETS.claude.dir;
export const STORE_DIR = ".claude/anatomiya";
/** What the refresh worker last did, relative to the repository root. */
export const REFRESH_STATE = `${STORE_DIR}/refresh.json`;
// The one write outside the two above (A25). Here rather than beside the hook
// that writes it, because this module is where every path a scan touches is
// spelled, and the exclude line below has to be the same string.
export const SETTINGS_PATH = ".claude/settings.local.json";
export const GENERATOR = "anatomiya";
export const PREFIX = "anatomiya-";
export const OVERVIEW_FILE = overviewName(TARGETS.claude);

export function areaFilename(area) {
  return areaName(TARGETS.claude, area.id);
}

/**
 * Ownership is the frontmatter key, not the filename.
 *
 * The prefix earns its place for one job only: a single line in the git common
 * dir's `info/exclude` hides every generated file. It is not the ownership
 * test, because a hand-written file can take that name.
 */
export function isOwned(text) {
  if (typeof text !== "string" || text === "") return false;
  // By hand, a line at a time, and never past the head a reader takes. It was
  // one regex whose lazy line group re-tried every line after every candidate
  // key: a file opening with `---` and repeating `generator: anatomiya` with no
  // closing fence took 24 s at 32,000 lines, and a 1 MB overview of that shape
  // held the echo hook for 50,621 ms against its 5 s timeout. Each line is
  // looked at once here.
  //
  // Anchored to the start of the file, not to any line: a hand-written note with
  // a horizontal rule above a line reading `generator: anatomiya` is not
  // frontmatter, and matching it would put that file on the removal list.
  //
  // The block ends at the first fence after the opening one. Reading on past it
  // read two blocks as a single long one, and a file opening with somebody
  // else's `description:` block and carrying our key further down came back as
  // ours: a file this tool would then remove.
  const end = Math.min(text.length, HEAD_BYTES);
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let opened = false;
  let keyed = false;
  while (at < end) {
    const nl = text.indexOf("\n", at);
    const last = nl === -1 || nl >= end;
    const line = text.slice(at, last ? end : nl);
    at = last ? end : nl + 1;
    const bare = line.endsWith("\r") ? line.slice(0, -1) : line;
    // A break the pattern would not cross is still one: `.` stopped at a lone
    // carriage return and at the two Unicode separators, so a block holding one
    // was never frontmatter.
    if (/[\r\u2028\u2029]/.test(bare)) return false;
    if (FENCE.test(bare)) {
      if (opened) return keyed;
      opened = true;
      continue;
    }
    if (!opened) return false;
    // The key line ends in a line break, as a key with a fence after it does.
    if (!last && KEY.test(bare)) keyed = true;
  }
  return false;
}

const FENCE = /^---[ \t]*$/;
const KEY = /^generator:[ \t]*anatomiya[ \t]*$/;

/**
 * A name this tool may write, checked rather than assumed.
 *
 * Every write lands under this one directory, so a hand-written `CLAUDE.md`
 * cannot be reached by a writer bug however an area name is derived. A bare
 * name with our prefix and no separator in it is the whole rule, and it is
 * asserted at the moment the plan is built rather than trusted because today's
 * area id happens to be a hex digest.
 */
export function isGeneratedName(name, target = TARGETS.claude) {
  return (
    typeof name === "string" &&
    name.startsWith(PREFIX) &&
    name.endsWith(target.ext) &&
    name.length > PREFIX.length + target.ext.length &&
    !/[\\/\0]/.test(name)
  );
}

/**
 * The filenames the map on disk says this build wrote, or `null` when there is
 * no map to ask.
 *
 * `null` is not an empty set: an empty set says the last scan wrote nothing,
 * and no scan writes nothing. Without the record the third fact is unavailable,
 * so nothing is removable. The same for a Cursor or Copilot directory the
 * record does not name.
 */
export function knownNames(facts, target = TARGETS.claude) {
  if (!facts || !Array.isArray(facts.areas)) return null;
  if (target.id !== TARGETS.claude.id) {
    // Stored rather than derived: a target has no file for an area it cannot spell.
    const listed = facts.targets?.[target.id];
    return Array.isArray(listed) ? new Set(listed.filter((n) => isGeneratedName(n, target))) : null;
  }
  const names = new Set([OVERVIEW_FILE]);
  for (const a of facts.areas) {
    if (a && typeof a.id === "string") names.add(areaFilename(a));
  }
  return names;
}

/**
 * Every `.md` in the rules directory, split by which of the three facts it
 * carries. In a Cursor or Copilot directory, only the names under our prefix:
 * the rest is that tool's own rules, which are meant to be there.
 *
 *   ours     all three, so this tool may replace or remove it
 *   unknown  our prefix and our key, but the map does not name it
 *   foreign  anything else: someone else's context, loading on every turn
 *
 * Sorted, because two surfaces render this list and the overview has to be
 * byte-stable across scans with no source change. `readdir` order is the
 * filesystem's.
 */
export function auditRules(root, known = null, target = TARGETS.claude) {
  const out = {
    ours: [],
    unknown: [],
    foreign: [],
    unreadable: [],
    occupied: [],
    dir: null,
    escaped: false,
    // Whether the directory could be listed at all. `false` beside four empty
    // lists is a directory nobody looked in, and reporting that as one holding
    // nothing foreign is the same lie the escape branch exists to refuse.
    listed: false,
  };

  const dir = resolveTargetDir(root, target);
  if (dir === null) return { ...out, escaped: true };
  out.dir = dir;

  let names;
  try {
    names = readdirSync(dir);
  } catch (err) {
    // A directory that is not there is not one this tool could not read: every
    // first scan finds no rules directory, and reporting that as a failed
    // listing put "could not be listed" on the summary of every first run.
    // Nothing is there, which is an answer; anything else is not.
    if (err.code === "ENOENT") return { ...out, listed: true };
    return out;
  }
  out.listed = true;

  const read = (n) => n.endsWith(target.ext) && (target.id === TARGETS.claude.id || n.startsWith(PREFIX));
  for (const name of names.filter(read).sort()) {
    const entry = readHead(join(dir, name));
    // A name `readdir` reports that is not a regular file is not a rule file.
    // The type is asked on the opened handle, before any content is read. It
    // is still recorded: the writer has to know when one of them holds a name
    // it is about to write, since `rename` refuses the same shapes `open` does.
    if (entry.kind === "other") {
      out.occupied.push(name);
      continue;
    }
    // Whose it is was never established, so it is neither ours nor somebody
    // else's. It loads either way, and it is never removed.
    if (entry.kind === "unreadable") {
      out.unreadable.push(name);
      continue;
    }
    // A link too, in a directory another tool reads: this tool writes files
    // there, so a link is somebody's own entry whatever it leads to.
    const theirLink = target.id !== TARGETS.claude.id && isLink(join(dir, name));
    if (!name.startsWith(PREFIX) || !isOwned(entry.head) || theirLink) {
      out.foreign.push(name);
      continue;
    }
    if (known && known.has(name)) out.ours.push(name);
    else out.unknown.push(name);
  }
  return out;
}

/**
 * Where a directory under the repository actually is, or `null` when that turns
 * out to be outside it.
 *
 * Both directories this tool writes go through it, because one link at
 * `.claude` escapes with the map and with `facts.json` together.
 *
 * Lexical containment is not containment: `join` normalises `..` and resolves
 * no link, so a tracked `.claude -> ../victim` (git mode 120000, which survives
 * a clone) put this tool's writes, its removals and its `facts.json` in a
 * directory the repository does not own, and named that directory's files in
 * the always-loaded overview. The containment rule was applied to the corpus
 * read and to nothing
 * else.
 *
 * The deepest existing ancestor is what gets resolved, since the directory
 * itself usually does not exist yet on a first scan and `realpath` needs
 * something that does. A link anywhere along the way lands the resolved path
 * outside, which is the whole test.
 */
export function resolveRulesDir(root) {
  return resolveInside(root, RULES_DIR);
}

/**
 * Where one target's directory is, or `null` where this tool does not write.
 *
 * Claude Code's is the rules directory above, link exception included. The
 * other two get no exception: every component is a directory of the
 * repository's own or is not there yet. `.github` holds workflows, so a link at
 * it that resolves inside the tree is still somewhere a map must not land.
 */
export function resolveTargetDir(root, target) {
  return locateTarget(root, target).dir;
}

// The directory, or the path in the way and what it is, for a reader to act on.
function locateTarget(root, target) {
  if (target.id === TARGETS.claude.id) return { dir: resolveRulesDir(root) };
  const own = ownDirectory(root, target.dir);
  if (own.dir === null) return own;
  // A `.claude/rules` link can lead here, and Claude Code would then load this target's files as its own.
  const rules = resolveRulesDir(root);
  if (rules === null) return own;
  // In the native form: the plain one keeps a link's own case on a volume that folds it.
  const [a, b] = [nativeUpTo(rules), nativeUpTo(own.dir)];
  return contains(a, b) || contains(b, a)
    ? blocked(`${RULES_DIR} is a link into the same place as ${target.dir}`, `point ${RULES_DIR} somewhere else`)
    : own;
}

function ownDirectory(root, relPath) {
  let at;
  try {
    at = realpathSync(root);
  } catch {
    return blocked("the repository root could not be read", UNREAD);
  }
  const parts = relPath.split("/");
  for (let i = 0; i < parts.length; i++) {
    const next = join(at, parts[i]);
    const name = parts.slice(0, i + 1).join("/");
    let entry;
    try {
      entry = lstatSync(next);
    } catch (err) {
      // Only a name with nothing at it is ours to create.
      if (err.code === "ENOENT") return { dir: join(at, ...parts.slice(i)) };
      return blocked(`${name} could not be read`, UNREAD);
    }
    // Asked of the entry itself, so a link to a directory is a link.
    if (!entry.isDirectory()) {
      return entry.isSymbolicLink()
        ? blocked(`${name} is a link`, "replace the link with a directory")
        : blocked(`${name} is not a directory`, "remove it");
    }
    at = next;
  }
  return { dir: at };
}

const blocked = (reason, remedy) => ({ dir: null, reason, remedy });
const UNREAD = "fix its permissions";

/**
 * Whether a scan keeps writing this target: `on`, `off` or `unknown`.
 *
 * Claude Code's is always on. Another is on while its own overview is a file
 * this tool wrote, so nothing is remembered anywhere else. It is off only where
 * that was seen: nothing at the name, or a file somebody else wrote. Anything
 * that could not be read is unknown, because off is what removes a map.
 */
export function targetState(root, target) {
  return targetStatus(root, target).state;
}

/**
 * The same, and for an unknown one the path that made it so, what that path
 * is, and what a person does about it.
 */
export function targetStatus(root, target) {
  if (target.always) return { state: "on" };
  const { dir, reason, remedy } = locateTarget(root, target);
  if (dir === null) return { state: "unknown", reason, remedy };
  const path = join(dir, overviewName(target));
  const unknown = (what, remedy) => ({ state: "unknown", reason: `${target.dir}/${overviewName(target)} ${what}`, remedy });
  let entry;
  try {
    entry = lstatSync(path);
  } catch (err) {
    return err.code === "ENOENT" ? { state: "off" } : unknown("could not be read", UNREAD);
  }
  if (!entry.isFile()) return entry.isSymbolicLink() ? unknown("is a link", "remove the link") : unknown("is not a file", "remove it");
  const read = readHead(path);
  if (read.kind !== "file") return unknown("could not be read", UNREAD);
  return { state: isOwned(read.head) ? "on" : "off" };
}

/**
 * The rules directory as git spells it: `.claude/rules`, or where a
 * `.claude/rules` link leads. Git matches no pathspec and no ignore pattern
 * past a symlink, so a map written through the link is listed under the
 * target only.
 */
export function trackedRulesDir(root) {
  const real = resolveRulesDir(root);
  const base = realpathOrNull(root);
  if (base === null || real === null) return RULES_DIR;
  // The native form spells the case on disk, as git does, where the plain form
  // keeps the link text's: pathspecs match case-sensitively even under core.ignorecase.
  const onDisk = nativeUpTo(real);
  if (!onDisk.startsWith(base + sep)) return RULES_DIR;
  return relative(base, onDisk).split(sep).join("/");
}

/** The native real path of the deepest part of `p` that exists, with the rest appended as written. */
function nativeUpTo(p) {
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
      const shared = i === 1 && `${parts[0]}/${parts[1]}` === RULES_DIR;
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
  relPath === RULES_DIR || relPath.startsWith(`${RULES_DIR}/`)
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

function contains(base, target) {
  const rel = relative(base, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
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
 * is not UTF-8 three times.
 */
export function readHead(path, bytes = HEAD_BYTES) {
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
  if (typeof path !== "string" || path === "") return null;
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile()) return null;
    const want = Math.min(bytes, stat.size);
    const buf = Buffer.alloc(want);
    const read = readSync(fd, buf, 0, want, stat.size - want);
    return buf.subarray(0, read).toString("utf8");
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

// Everything a scan can leave in the working tree, so the one documented
// exclude covers all of it. `settings.local.json` was on this list while the
// scan installed its re-delivery hook there; the plugin declares that itself
// now, and a scan takes the old entry out rather than writing one.
export const EXCLUDE_LINES = [
  `${RULES_DIR}/${PREFIX}*.md`,
  `${STORE_DIR}/`,
  ...[TARGETS.cursor, TARGETS.copilot].map((t) => `${t.dir}/${PREFIX}*${t.ext}`),
];

/**
 * How many rule files a surface names before it counts them.
 *
 * Past a handful the fact is that the directory is somebody else's, and the
 * names stop being the useful part. Two numbers, because the budgets differ:
 * the overview is loaded on every turn and pays for its lines forever, while
 * the report and the summary are read once.
 */
export const LISTED = { overview: 6, report: 20 };

/**
 * Split a list into the names to show and the count left over.
 *
 * Here rather than in each surface, because the arithmetic was written three
 * times and the cap twice, and a listing that says "and 0 more" or drops a name
 * without counting it is the kind of thing only one of the three would get
 * wrong.
 */
export function listSome(names, cap) {
  return { shown: names.slice(0, cap), rest: Math.max(0, names.length - cap) };
}
