/**
 * `.claude/rules/`, the one place a file in it is decided to be ours, and the
 * state of each target directory the map is written to.
 *
 * The directory is a *repository* directory, so a clone can ship a rule file
 * with no `paths` key that loads unconditionally from the moment of clone, in
 * our house style, forever. Two surfaces have to answer for that: the writer,
 * which may only remove what it wrote, and the check, which reports whatever
 * else is loading. They used to answer differently, and the disagreement was in
 * the direction that deletes.
 *
 * Ownership is three facts, or the file is left alone: our filename
 * prefix, our frontmatter key, and the map on disk naming it, as a file it
 * holds or one it was about to remove. The prefix alone
 * is a filename anyone can type; the frontmatter alone is a file an older build
 * wrote and this one knows nothing about.
 *
 * How a path is held inside the repository and read bounded is `contained.mjs`,
 * which this reads and which knows nothing of the map.
 */
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { folded } from "./paths.mjs";
import { HEAD_BYTES, contains, isLink, nativeUpTo, readHead, realpathOrNull, resolveInside } from "./contained.mjs";
import { GENERATOR, PREFIX, TARGETS, areaName, isClaude, overviewName } from "./targets.mjs";
import { isFileAt, stager } from "./store.mjs";

export const RULES_DIR = TARGETS.claude.dir;

export const STORE_DIR = ".claude/anatomiya";

/** The code index `find` reads, in the store. Here so the end-of-turn hook can ask whether it exists without loading the index. */
export const INDEX_FILE = "index.json.gz";

/** What the refresh worker last did, relative to the repository root. */
export const REFRESH_STATE = `${STORE_DIR}/refresh.json`;

/** The lock one refresh worker at a time holds, relative to the repository root. */
export const REFRESH_LOCK = `${STORE_DIR}/refresh.lock`;

/** The lock a scan holds while it replaces the map, relative to the repository root. */
export const COMMIT_LOCK = `${STORE_DIR}/commit.lock`;

// The one write outside the two above (A25). Here rather than beside the hook
// that writes it, because this module is where every path a scan touches is
// spelled, and the exclude line below has to be the same string.
export const SETTINGS_PATH = ".claude/settings.local.json";

export { GENERATOR, PREFIX };

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

const KEY = new RegExp(`^generator:[ \\t]*${GENERATOR}[ \\t]*$`);

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
 * A name a scan gives a file: the overview's, or an area's eight hex digits.
 *
 * Narrower than the rule above, for the two directories people write in by
 * hand. A copy somebody kept of a generated file carries the key and the
 * prefix, so there only a name this tool can produce is its to remove.
 */
export function isMapName(name, target = TARGETS.claude) {
  if (!isGeneratedName(name, target)) return false;
  return name === overviewName(target) || AREA_STEM.test(name.slice(0, -target.ext.length));
}

const AREA_STEM = new RegExp(`^${PREFIX}area-[0-9a-f]{8}$`);

/**
 * The process that staged a temporary file of the map's, read off the file's
 * name, or null for any other name: a name a scan gives a file in this
 * directory, then what the stager adds to it.
 */
export function stagedBy(name, target = TARGETS.claude) {
  return stager(name, (staged) => isMapName(staged, target));
}

/**
 * The entry a write to `name` may land on: one spelled otherwise that a volume
 * folding case would answer with, or null. A listing that holds `name`
 * itself has none, since no volume that folds can list both spellings.
 */
export const spelledOtherwise = (entries, name) =>
  entries.includes(name) ? null : (entries.find((e) => folded(e) === folded(name)) ?? null);

/**
 * The entries that are one of `names` on this volume: each spelled otherwise,
 * where the listing does not hold the name and the volume answers for it with
 * that entry. A volume that keeps case apart answers for no name its listing lacks.
 *
 * One pass over the listing, which comes with the repository: asked a name at
 * a time, 500 names against 100,000 entries took 3.4 s.
 */
export function foldedOnto(dir, entries, names) {
  const listed = new Set(entries);
  const spelled = new Map();
  for (const e of entries) {
    const key = folded(e);
    if (!spelled.has(key)) spelled.set(key, []);
    spelled.get(key).push(e);
  }
  return names.flatMap((n) => {
    const it = listed.has(n) || !spelled.has(folded(n)) ? null : entryAt(dir, n);
    return it === null ? [] : spelled.get(folded(n)).filter((e) => sameEntry(it, entryAt(dir, e))).slice(0, 1);
  });
}

// `folded` is JavaScript's fold and a volume has its own: a dotless i goes onto
// `i` here and stays apart on APFS. So which entry a name is gets asked of the
// volume. A file under two links, or on a volume that numbers no file, is
// nobody's to tell apart, and reads as no entry.
function entryAt(dir, name) {
  try {
    const { dev, ino, nlink } = lstatSync(join(dir, name), { bigint: true });
    return nlink === 1n && ino !== 0n ? { dev, ino } : null;
  } catch {
    return null;
  }
}

const sameEntry = (a, b) => a !== null && b !== null && a.dev === b.dev && a.ino === b.ino;

/**
 * What the record on disk says of one directory: `names`, the files the map
 * there holds, or `null` where there is no map to ask, and `removing`, the
 * files the scan that wrote it was about to remove, an empty set where it names
 * none, which is every record written before the list.
 *
 * `null` is not an empty set: an empty set says the last scan wrote nothing,
 * and no scan writes nothing. Without the record the third fact is unavailable,
 * so nothing is removable. The same for a Cursor or Copilot directory the
 * record does not name, until a scan is told by name to leave that target out.
 * The record is renamed before the first removal, so a scan killed between the
 * two leaves a record that no longer names the file it was removing, and only
 * `removing` says the file is still ours to remove.
 */
export function recordFor(facts, target = TARGETS.claude) {
  return { names: knownNames(facts, target), removing: pendingNames(facts, target) };
}

function knownNames(facts, target) {
  if (!facts || !Array.isArray(facts.areas)) return null;
  if (!isClaude(target)) {
    // Stored rather than derived: a target has no file for an area it cannot spell.
    const listed = facts.targets?.[target.id];
    return Array.isArray(listed) ? new Set(listed.filter((n) => isMapName(n, target))) : null;
  }
  const names = new Set([OVERVIEW_FILE]);
  for (const a of facts.areas) {
    if (a && typeof a.id === "string") names.add(areaFilename(a));
  }
  return names;
}

function pendingNames(facts, target) {
  const listed = facts?.removing?.[target.id];
  return new Set(Array.isArray(listed) ? listed.filter((n) => isMapName(n, target)) : []);
}

/**
 * Every `.md` in the rules directory, split by which of the three facts it
 * carries (A3), as `facts`, the record on disk, names this directory's files.
 * In a Cursor or Copilot directory, only the names under our prefix: the rest is
 * that tool's own rules, which are meant to be there.
 *
 *   ours      all three, the map holding it, so this tool may replace or remove it
 *   removing  all three, the scan that wrote the map about to remove it, so the
 *             next scan removes it
 *   unknown   our prefix and our key, and the record names it neither way
 *   foreign   anything else: someone else's context, loading on every turn
 *
 * Sorted, because two surfaces render this list and the overview has to be
 * byte-stable across scans with no source change. `readdir` order is the
 * filesystem's.
 */
export function auditRules(root, facts = null, target = TARGETS.claude) {
  const { names: known, removing: going } = recordFor(facts, target);
  const out = {
    ours: [],
    removing: [],
    unknown: [],
    foreign: [],
    unreadable: [],
    occupied: [],
    // Every name the listing holds, as the directory spells it.
    entries: [],
    // The regular files a scan staged here and neither renamed nor removed.
    staged: [],
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
  out.entries = names;
  // Asked of the entry itself: a link, a directory or a fifo under such a name is somebody's.
  out.staged = names.filter((n) => stagedBy(n, target) !== null && isFileAt(join(dir, n))).sort();

  const read = (n) => n.endsWith(target.ext) && (isClaude(target) || n.startsWith(PREFIX));
  const listed = new Set(names);
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
    const theirLink = !isClaude(target) && isLink(join(dir, name));
    // In Claude Code's directory a generated name is this tool's by construction,
    // and on a volume that folds case an entry spelled as one in another case is
    // the file at that name: ours under the map's name where it carries the key.
    const lower = folded(name);
    const isMapped = isClaude(target) && isMapName(lower, target) && !listed.has(lower) && sameEntry(entryAt(dir, name), entryAt(dir, lower));
    const mapped = isMapped ? lower : name;
    if (!mapped.startsWith(PREFIX) || !isOwned(entry.head) || theirLink) {
      out.foreign.push(name);
      continue;
    }
    if (known?.has(mapped)) out.ours.push(mapped);
    else if (going.has(mapped)) out.removing.push(mapped);
    else out.unknown.push(mapped);
  }
  out.ours.sort();
  out.removing.sort();
  out.unknown.sort();
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
  if (isClaude(target)) return { dir: resolveRulesDir(root) };
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
      return blocked(`${name} is ${entry.isSymbolicLink() ? "a link" : "not a directory"}`, `make ${name} a directory of this repository`);
    }
    at = next;
  }
  return { dir: at };
}

const blocked = (reason, remedy) => ({ dir: null, reason, remedy });

const UNREAD = "make it readable";

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
 * is, and what a person does about it: the one remedy every sentence about it
 * gives.
 */
export function targetStatus(root, target) {
  if (isClaude(target)) return { state: "on" };
  const { dir, reason, remedy } = locateTarget(root, target);
  if (dir === null) return { state: "unknown", reason, remedy };
  const path = join(dir, overviewName(target));
  const said = `${target.dir}/${overviewName(target)}`;
  const unknown = (what, remedy = `move or delete ${said}`) => ({ state: "unknown", reason: `${said} ${what}`, remedy });
  let entry;
  try {
    entry = lstatSync(path);
  } catch (err) {
    return err.code === "ENOENT" ? { state: "off" } : unknown("could not be read", UNREAD);
  }
  if (!entry.isFile()) return unknown(entry.isSymbolicLink() ? "is a link" : "is not a file");
  const read = readHead(path);
  if (read.kind !== "file") return unknown("could not be read", UNREAD);
  // A volume that folds case answers for an entry spelled another way, and that one is somebody's.
  return { state: isOwned(read.head) && listsExactly(dir, overviewName(target)) ? "on" : "off" };
}

/**
 * One target directory as every reader composes it (A104, A105): `targetStatus`'s
 * state, reason and remedy, whether the record names the target's overview
 * among the files to remove (`turningOff`), and whether the record names any
 * file of the target's at all (`recorded`), which is what makes an unknown
 * directory one that still loads. The writer, the check and the doctor read
 * this one, so "off at the next scan" has one spelling.
 */
export function targetView(root, facts, target) {
  const status = targetStatus(root, target);
  return { ...status, turningOff: status.state === "on" && turningOff(facts, target), recorded: (recordFor(facts, target).names?.size ?? 0) > 0 };
}

/** Whether the record names a target's own overview among the files it was about to remove, which makes it off at the next scan. */
export function turningOff(facts, target) {
  return pendingNames(facts, target).has(overviewName(target));
}

// True where the directory cannot be listed: the `lstat` is then all there is to go on.
function listsExactly(dir, name) {
  try {
    return readdirSync(dir).includes(name);
  } catch {
    return true;
  }
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

// Everything a scan can leave in the working tree, so the one documented
// exclude covers all of it. `settings.local.json` was on this list while the
// scan installed its re-delivery hook there; the plugin declares that itself
// now, and a scan takes the old entry out rather than writing one.
export const EXCLUDE_LINES = [
  `${RULES_DIR}/${PREFIX}*.md`,
  `${STORE_DIR}/`,
  ...Object.values(TARGETS).filter((t) => !isClaude(t)).map((t) => `${t.dir}/${PREFIX}*${t.ext}`),
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
