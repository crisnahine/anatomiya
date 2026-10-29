/**
 * Which checkout answers a hook's call, and from which map: the walk up from a
 * path to the nearest map a scan wrote (H40), the layout that checkout's record
 * holds, the checkouts directly below a session with no map of its own (A99),
 * and the one path a write is about (A44). The payload on the wire is
 * `payload.mjs`, the echo's text is `echo.mjs`, and the settings entry an older
 * version arranged is `settings.mjs`.
 */
import { lstatSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { isOwned, OVERVIEW_FILE, RULES_DIR } from "./rules.mjs";
import { HEAD_BYTES, nativeUpTo, readHead, realpathOrNull, resolveInside } from "./contained.mjs";
import { escapes } from "./paths.mjs";
import { FACTS_PATH, readLayout, readRecord, schemaProblem } from "./facts.mjs";
import { PATH_MOST } from "./payload.mjs";
import { mainCheckoutOf } from "./worktree.mjs";

/**
 * Whether anything is already at a path, a broken link and a path that cannot
 * be looked at both counted as taken.
 *
 * Those answer together because they fail the same way. `existsSync` swallowed
 * every error and said no, walking straight past a level it could not see;
 * `lstat` suppresses only ENOENT and throws the rest, and nothing between here
 * and the process catches it. Unreadable answering "taken" is the quiet
 * direction on both readers: the walk stops rather than claiming a map above,
 * and the notice says nothing rather than calling a file new.
 */
export function isPathTaken(path) {
  try {
    return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return true;
  }
}

function isBoundary(at) {
  return isPathTaken(join(at, ".git"));
}

/**
 * The nearest map at or above a directory, or null where there is none.
 *
 * A hook fires with the session's own working directory, which is wherever the
 * model happens to be, and the map is written once at the repository root.
 * Walked rather than asked of `git rev-parse`, which is what every other
 * command does: this runs on every tool call, and a subprocess per call to
 * learn a path already on disk is a subprocess per call. `dirname` is its own
 * fixed point at the filesystem root, which is what ends the loop.
 *
 * The walk ends at a boundary, so a submodule or a nested repository hears
 * nothing rather than the enclosing checkout's map, against a branch those
 * counts never described. A linked worktree hears its main checkout's, under
 * that checkout's name (`mainCheckoutOf`). Anything named `.git` is one, which is
 * the cheap side of asking the filesystem instead of git on every tool call.
 *
 * The starting directory is resolved through its links rather than around them,
 * which is F2's reasoning arriving at the read side: `resolve` normalises `..`
 * and follows no link, so a cwd reached through one walked the link's own
 * parents and stepped around every boundary beneath it. A cwd that will not
 * resolve answers no map, since a reader that cannot say where it is cannot say
 * the map above it is about the code there.
 */
export function ownMap(from) {
  // Through F2's containment, as `ownLayout` reads the record: a tracked
  // `.claude/rules` link to another checkout's rules delivered that map here,
  // stamped as this repository's own.
  const hit = walkUp(from, (at) => {
    const path = resolveInside(at, `${RULES_DIR}/${OVERVIEW_FILE}`);
    return path === null ? null : readOwned(path);
  });
  return hit && { map: hit.found, root: hit.at, from: hit.from };
}

/**
 * The walk `ownMap` describes, asking `read` at each level: the first answer
 * with the directory it came from, or null.
 *
 * At the boundary a linked worktree is answered by its main checkout, and
 * `from` names that checkout; `at` stays the worktree, since its files are what
 * a write lands among.
 */
function walkUp(from, read) {
  let at = realpathOrNull(resolve(from));
  if (at === null) return null;
  for (;;) {
    const found = read(at);
    if (found !== null) return { at, found, from: null };
    if (isBoundary(at)) {
      const main = mainCheckoutOf(at);
      const borrowed = main === null ? null : read(main);
      return borrowed === null ? null : { at, found: borrowed, from: main };
    }
    const up = dirname(at);
    if (up === at) return null;
    at = up;
  }
}

/**
 * The file's text, when this tool wrote it and it is no larger than one of ours.
 *
 * Through `readHead` rather than a plain read, because this runs on every turn
 * and every tool call and the path is whatever is sitting there: a named pipe
 * never returns at all, which is a session that never returns, and a file
 * carrying our frontmatter and five megabytes of anything else went into the
 * model's context whole. `readHead` opens non-blocking, types the shape before
 * reading a byte, and stops at the size this repository already decided a rule
 * file may be. One byte past the cap is enough to know the file is over it.
 *
 * Whose it is decides whether the walk stops here, not only whether it answers:
 * a hand-written file in a subdirectory used to silence the repository's own
 * map for every session under it.
 */
function readOwned(path) {
  const entry = readHead(path, HEAD_BYTES + 1);
  if (entry.kind !== "file" || entry.size > HEAD_BYTES) return null;
  return isOwned(entry.head) ? entry.head : null;
}

/**
 * The layout this repository recorded, walked up from here, or null.
 *
 * The same walk `ownMap` makes and stopping at the same boundary, so a hook
 * fired inside one checkout never answers out of another one's counts. Read
 * rather than parsed loosely: a record this cannot read is one it says nothing
 * about, which is the only safe answer on a path that runs per tool call.
 *
 * Through `readHead` for the reason `readOwned` is: a plain read blocks for
 * ever on a fifo and takes whatever size it finds, and this runs before every
 * write rather than once per scan.
 */
export function ownLayout(from) {
  // F2 again, and the reason `readFacts` already asks it: `join` resolves no
  // link, so a tracked `.claude/anatomiya -> /tmp/x` had a directory outside
  // the repository deciding what a write inside it was judged against.
  const hit = walkUp(from, (at) => {
    const path = resolveInside(at, FACTS_PATH);
    if (path === null) return null;
    // A layout file that answers is believed even when it says null: the
    // record it was stamped from says the same, and reading that is the cost.
    const stamped = readLayout(at, path);
    return stamped === null ? recordedLayout(path) : stamped.layout;
  });
  return hit && { root: hit.at, layout: hit.found, from: hit.from };
}

// More mapped checkouts than this side by side is a shelf of projects rather
// than one project split into a few, and the session has named none of them.
const CHILD_CHECKOUTS_MOST = 8;

/**
 * The checkouts directly below a directory that hold a map of their own, each
 * with the name it has there, or none where there are more than
 * `CHILD_CHECKOUTS_MOST`.
 *
 * For the hooks whose payload names no file, in a session started above its
 * checkouts: a project split into sibling repositories is opened from the
 * directory holding them, which has no map. The echo and the notice need none
 * of this, since their tool calls name the file. Only a checkout's own root
 * counts, so a `.claude` copied with no `.git` beside it opts nothing in, and
 * a link is not followed out of the directory.
 */
export function childLayouts(dir) {
  const at = realpathOrNull(resolve(dir));
  if (at === null) return [];
  let names;
  try {
    names = readdirSync(at, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
  const found = [];
  for (const name of names) {
    const child = join(at, name);
    if (!isBoundary(child) || !isPathTaken(join(child, FACTS_PATH))) continue;
    const own = ownLayout(child);
    if (own === null || own.from !== null || own.root !== child) continue;
    found.push({ ...own, name });
    if (found.length > CHILD_CHECKOUTS_MOST) return [];
  }
  return found;
}

/**
 * The layout inside a record, or null for anything that is not one.
 *
 * Held to the same schema gate `readFacts` applies, and for its reason: fields
 * move between versions, and a record read against a shape this build does not
 * know enforces a convention nobody stated. Without it `check` named the schema
 * and enforced nothing while the notice, one command over, spoke off the same
 * file.
 */
function recordedLayout(path) {
  // No record here, or one nobody can read. Both mean keep walking.
  const parsed = readRecord(path).record;
  return parsed !== null && schemaProblem(parsed) === null ? (parsed.layout ?? null) : null;
}

/**
 * Where each tool spells the path it is about to write.
 *
 * Measured on 2.1.250: `Write` and `Edit` carry `file_path`, `NotebookEdit`
 * carries `notebook_path`. A hook reading one key sees nothing on the other
 * tool and says nothing about it, which is the quietest way to be wrong.
 *
 * A notebook cannot produce a notice today, since `.ipynb` is not one of the
 * extensions a test file is held to. It is read anyway: which key a tool spells
 * its target with is a fact about the wire, not about what a rule does with it,
 * and the day that extension is counted the hook already covers the tool.
 */
const TARGET_KEY = { Write: "file_path", Edit: "file_path", NotebookEdit: "notebook_path" };

/**
 * Whether a directory under this repository already holds a file the caller
 * calls a test.
 *
 * A directory that is not there holds nothing, which is the ordinary answer for
 * a path a change is inventing. Anything else that goes wrong answers that it
 * does hold one, because this decides whether a finding is printed and a
 * directory nobody could list is not evidence that it is empty (C33): a
 * `spec/mailers` at mode 111, with a sibling spec in it the whole time, was
 * reported as holding no other test.
 */
export function holdsTestIn(root, isTest) {
  return (dir) => {
    let names;
    try {
      names = readdirSync(join(root, dir));
    } catch (err) {
      return err.code !== "ENOENT";
    }
    return names.some((name) => isTest(dir ? `${dir}/${name}` : name));
  };
}

/**
 * Where each tool spells the place it is about.
 *
 * Measured on 2.1.251, off captured payloads rather than off the tool
 * definitions: `Read`, `Write` and `Edit` carry `file_path`, `NotebookEdit`
 * carries `notebook_path`, and `Glob` and `Grep` carry `path`, which is
 * optional on both. `Bash`, `Agent`, `WebFetch` and `ToolSearch` name no place
 * at all, and for `Bash` nothing in the payload says which file a redirect
 * touched. Those have only the working directory, which for a shell is the
 * right base anyway.
 */
const ABOUT_KEY = {
  Read: "file_path",
  Write: "file_path",
  Edit: "file_path",
  NotebookEdit: "notebook_path",
  Glob: "path",
  Grep: "path",
};

/**
 * The deepest directory on the way to a path that is actually there.
 *
 * One walk for three shapes, rather than a branch per tool. A file answers with
 * its parent. A directory answers with itself, which is what `Glob` and `Grep`
 * name, and taking the parent of one at a repository root would answer from the
 * directory holding every checkout. A path a write is about to invent answers
 * with the nearest ancestor that exists, since it has no directory of its own
 * yet and the walk needs somewhere real to start.
 */
function deepestDir(path) {
  // Gated on what the walk actually runs on, which is the target and the base
  // joined. Gating the target alone was got round by a short target and a long
  // `cwd` in the same payload, at 10.5s: the payload carries both fields and
  // one bound has to cover whatever they make between them.
  if (path.length > PATH_MOST) return null;
  let at = path;
  for (;;) {
    if (isDir(at)) return at;
    const up = dirname(at);
    if (up === at) return null;
    at = up;
  }
}

/** Whether a path is a directory, following a link to one, never throwing. */
function isDir(path) {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}

/**
 * Whether a directory sits inside a checkout of its own.
 *
 * What separates "this call belongs to a repository that has nothing to say"
 * from "this call belongs to no repository at all". Only the second may be
 * answered from somewhere else: a nested checkout with no map, or one whose map
 * is empty, is a repository, and handing it the enclosing one's counts is the
 * thing the boundary walk above exists to refuse.
 */
export function inCheckout(from) {
  let at = realpathOrNull(resolve(from));
  if (at === null) return false;
  for (;;) {
    if (isBoundary(at)) return true;
    const up = dirname(at);
    if (up === at) return false;
    at = up;
  }
}

/**
 * The directory a path in this payload is read against, or null where there is
 * none to read it against.
 *
 * The payload's own first, for the reason `aboutDir` records below.
 *
 * Spelled here rather than at each reader because they have to pick the same
 * one for a single payload: apart, the root was resolved from a relative target
 * that the other then measured as outside it, and the hook said nothing about a
 * write it had already located. The fallback may be absent, since
 * `process.cwd()` refuses once the directory a session started in is unlinked,
 * so this answers null and both callers take it.
 */
export function baseIn(payload, fallback) {
  const here = typeof payload?.cwd === "string" && payload.cwd ? payload.cwd : fallback;
  // Absolute or nothing: `resolve` reaches `process.cwd()` for any argument
  // list with nothing absolute in it, which is the one call this path may not
  // make. A relative base would throw there in the removed-worktree case and
  // silently answer against the hook process's own directory in every other,
  // which is the thing reading the payload's own is here to avoid.
  return typeof here === "string" && isAbsolute(here) ? here : null;
}

/**
 * The directory the tool call is about, or null where the payload names none.
 *
 * A hook fires with the session's working directory, which says where a shell
 * happens to be rather than what the call is about. Two checkouts side by side
 * are the case that separates them: a walk up from the working directory finds
 * a map, stops, and answers for the wrong one, under the line saying it was
 * counted from this repository's own code.
 *
 * Where the payload names no place, its own `cwd` answers rather than this
 * process's. Measured on 2.1.251, that field follows the agent: one `cd` in a
 * Bash call moved it for every payload after, and nothing tells this process.
 * For a shell it is the right base anyway, and for a `Glob` with no `path` it
 * is what the tool itself used. `baseIn` picks it, for both readers at once.
 */
export function aboutDir(payload, fallback) {
  const here = baseIn(payload, fallback);
  const key = ABOUT_KEY[payload?.tool_name];
  const raw = key ? payload?.tool_input?.[key] : null;
  // Read against the directory the payload names, because the tool read it
  // against that one: nothing normalises `tool_input` on the way here, and a
  // relative path was measured arriving raw. A reader that refuses one falls
  // back to the shell without saying so.
  if (typeof raw === "string" && raw) {
    // The same pair `targetIn` refuses below, and for a reason that only shows
    // on this side: `resolve` reads its arguments from the right and stops at
    // the first absolute one, so it never looks at an absent base behind one,
    // while a relative path leaves it looking and it throws. The throw reached
    // the guard in the bin, which answers the empty object, so a payload naming
    // a live file cost the turn its map.
    if (!isAbsolute(raw) && here === null) return null;
    return deepestDir(resolve(here ?? "/", raw));
  }
  return here === null ? null : deepestDir(resolve(here));
}

/**
 * The path this call is about, relative to the repository, or null.
 *
 * Null for anything that lands outside, which is the safe direction: this
 * repository has nothing to say about another one's file. The containment test
 * is a segment test rather than a prefix one, so a file named `..keep` beside
 * the root is inside it.
 *
 * The base a relative path is read against is the payload's own directory, the
 * same one `aboutDir` uses, falling back to what the caller passes. A payload
 * carrying neither leaves a relative path unreadable, and unreadable is silence.
 */
export function targetIn(payload, root, from) {
  const key = TARGET_KEY[payload?.tool_name];
  const raw = key ? payload?.tool_input?.[key] : null;
  if (typeof raw !== "string" || !raw) return null;
  const here = baseIn(payload, from);
  if (!isAbsolute(raw) && here === null) return null;
  const target = resolve(here ?? "/", raw);
  // The same bound the map's reader takes, and for the same reason one segment
  // deeper: `nativeUpTo` recurses per segment, so a path the other refuses in
  // milliseconds was a stack overflow here. Both fields make the path, so the
  // bound is on what they made.
  if (target.length > PATH_MOST) return null;
  // Both sides resolved through their links: the root arrives resolved, and a payload carrying `/tmp/x`
  // against a root reading `/private/tmp/x` looked like another repository's file. The write has not
  // happened yet, so only the part of the target that exists is resolved.
  const rel = relative(nativeUpTo(resolve(root)), nativeUpTo(target));
  if (!rel || escapes(rel)) return null;
  // Only where a backslash is the separator: on POSIX it is a legal filename
  // character, and splitting on it named a different file.
  return sep === "\\" ? rel.split("\\").join("/") : rel;
}
