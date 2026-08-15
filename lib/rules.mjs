/**
 * `.claude/rules/`, and the one place a file in it is decided to be ours.
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
import { closeSync, lstatSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, isAbsolute, sep } from "node:path";

export const RULES_DIR = ".claude/rules";
export const STORE_DIR = ".claude/anatomiya";
export const GENERATOR = "anatomiya";
export const PREFIX = "anatomiya-";
export const OVERVIEW_FILE = `${PREFIX}overview.md`;

export function areaFilename(area) {
  return `${PREFIX}area-${area.id}.md`;
}

/**
 * Ownership is the frontmatter key, not the filename.
 *
 * The prefix earns its place for one job only: a single line in the git common
 * dir's `info/exclude` hides every generated file. It is not the ownership
 * test, because a hand-written file can take that name.
 */
export function isOwned(text) {
  // Anchored to the start of the file, not to any line: a hand-written note with
  // a horizontal rule above a line reading `generator: anatomiya` is not
  // frontmatter, and matching it would put that file on the removal list.
  return /^\uFEFF?---\r?\n(?:.*\r?\n)*?generator:[ \t]*anatomiya[ \t]*\r?\n(?:.*\r?\n)*?---[ \t]*(?:\r?\n|$)/.test(
    text || ""
  );
}

/**
 * A name this tool may write, checked rather than assumed.
 *
 * Every write lands under this one directory, so a hand-written `CLAUDE.md`
 * cannot be reached by a writer bug however an area name is derived. A bare
 * name with our prefix and no separator in it is the whole rule, and it is
 * asserted at the moment the plan is built rather than trusted because today's
 * area id happens to be a hex digest.
 */
export function isGeneratedName(name) {
  return (
    typeof name === "string" &&
    name.startsWith(PREFIX) &&
    name.endsWith(".md") &&
    name.length > PREFIX.length + 3 &&
    !/[\\/\0]/.test(name)
  );
}

/**
 * The filenames the map on disk says this build wrote, or `null` when there is
 * no map to ask.
 *
 * `null` is not an empty set: an empty set says the last scan wrote nothing,
 * and no scan writes nothing. Without the record the third fact is unavailable,
 * so nothing is removable.
 */
export function knownNames(facts) {
  if (!facts || !Array.isArray(facts.areas)) return null;
  const names = new Set([OVERVIEW_FILE]);
  for (const a of facts.areas) {
    if (a && typeof a.id === "string") names.add(areaFilename(a));
  }
  return names;
}

/**
 * Every `.md` in the rules directory, split by which of the three facts it
 * carries.
 *
 *   ours     all three, so this tool may replace or remove it
 *   unknown  our prefix and our key, but the map does not name it
 *   foreign  anything else: someone else's context, loading on every turn
 *
 * Sorted, because two surfaces render this list and the overview has to be
 * byte-stable across scans with no source change. `readdir` order is the
 * filesystem's.
 */
export function auditRules(root, known = null) {
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

  const dir = resolveRulesDir(root);
  if (dir === null) return { ...out, escaped: true };
  out.dir = dir;

  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  out.listed = true;

  for (const name of names.filter((n) => n.endsWith(".md")).sort()) {
    const entry = readHead(join(dir, name));
    // A name `readdir` reports that is not a regular file is not a rule file. A
    // directory called `x.md` throws EISDIR on open and a fifo blocks on it, so
    // the type is asked before the content. It is still recorded: the writer has
    // to know when one of them holds a name it is about to write, since `rename`
    // refuses the same shapes `open` does.
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
    if (!name.startsWith(PREFIX) || !isOwned(entry.head)) {
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

export function resolveInside(root, relPath) {
  const parts = relPath.split("/");
  let base;
  try {
    base = realpathSync(root);
  } catch {
    return null;
  }

  let at = base;
  for (let i = 0; i < parts.length; i++) {
    const next = join(at, parts[i]);
    let real;
    try {
      real = realpathSync(next);
    } catch {
      // A dangling link resolves to nothing and is still a link: creating
      // through it lands wherever it points, the moment that exists.
      if (isLink(next)) return null;
      // Otherwise nothing is there yet, and the rest is ours to create under a
      // parent that already resolved inside.
      return join(at, ...parts.slice(i));
    }
    if (!contains(base, real)) return null;
    at = real;
  }
  return at;
}

function isLink(path) {
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
 * The first bytes of a file, or `null` when it is not a regular file.
 *
 * `stat` and not `lstat`: a symlink to a real `.md` loads into the agent exactly
 * like a regular file and has to be reported like one. What the type test is
 * for is the shapes that cannot be read at all, and `stat` still answers false
 * for a directory, a fifo and `/dev/zero`. Size is the head cap's job.
 *
 * The ownership test is a regex anchored to byte zero and closed by the second
 * fence, so nothing past the frontmatter was ever the question. Read whole, one
 * tracked symlink to a large blob took a scan's peak resident size to 1.2 GB,
 * and pointed at `/dev/zero` the read never returned at all.
 *
 * The buffer is the smaller of the cap and the file, so an ordinary five-line
 * rule file costs five lines and only a large one pays the cap.
 */
function readHead(path, bytes = HEAD_BYTES) {
  let fd;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return { kind: "other" };
    const want = Math.min(bytes, stat.size);
    if (want === 0) return { kind: "file", head: "" };
    fd = openSync(path, "r");
    const buf = Buffer.alloc(want);
    const read = readSync(fd, buf, 0, want, 0);
    return { kind: "file", head: buf.subarray(0, read).toString("utf8") };
  } catch {
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

export const EXCLUDE_LINES = [`${RULES_DIR}/${PREFIX}*.md`, `${STORE_DIR}/`];

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
