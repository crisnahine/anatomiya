import { closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { renderArea, renderOverview, splitUncovered } from "./render.mjs";
import { FACTS_PATH, FACTS_SCHEMA, LAYOUT_PATH, readFacts, factsJson, layoutJson, atomic, writeTemp } from "./facts.mjs";
import { byCode } from "./paths.mjs";
import {
  RULES_DIR,
  STORE_DIR,
  OVERVIEW_FILE,
  areaFilename,
  auditRules,
  blockedOnTheWay,
  isGeneratedName,
  knownNames,
  leafReplaceable,
  outsideClaude,
  resolveInside,
  resolveRulesDir,
} from "./rules.mjs";

/** Write the map: plan it, and put it on disk unless this is a dry run. */
export function writeMap(result, { dryRun = false } = {}) {
  const plan = planMap(result);
  return dryRun ? plan : commitMap(result.root, plan);
}

/**
 * The map, decided and rendered, with nothing created.
 *
 * Every body a write would put on disk comes back on the plan, because the one
 * caller that wanted the map without one had to derive it a second time, and a
 * second derivation of the same thing is a drift waiting for a field to move.
 */
export function planMap(result) {
  // Resolved before anything is rendered, and before a dry run answers: a plan
  // reporting a clean write that cannot happen is the one answer worse than the
  // failure.
  const { storeDir } = resolveDirs(result.root);
  // The record's own name, the one leaf here the map does not audit. A directory
  // committed at it let a dry run say "would write" and the scan die on a raw
  // `EISDIR` out of the rename.
  for (const leaf of [FACTS_PATH, LAYOUT_PATH]) {
    if (!leafReplaceable(join(storeDir, basename(leaf)))) {
      throw new Error(`${leaf} is not a file, so the map could not be written: remove it and scan again`);
    }
  }

  const withDirectives = result.areas.filter((a) => a.dimensions.length > 0);

  // A run that read no file of a language cannot describe what that language
  // holds, so it does not write over a run that could. Every file of it is
  // charged as a failure, every area holding one counts nothing and would be
  // removed as gone. `env -i PATH=/usr/bin:/bin` on a Rails repository is the
  // whole of it: three correct area files deleted in the same run that reports
  // it could not read one.
  //
  // Decided per language (B41). The scan holds every area that has a file of
  // such a language in it, and those are neither written nor removed, while
  // everything else is written as usual: a TypeScript repository with one
  // Gemfile got no map at all on a machine without Ruby. Only a run that read
  // no file of any language writes nothing, since the overview would then be
  // rewritten from nothing beside area files that still load. A result that
  // does not say which areas its unread language touched cannot be written in
  // part, so it is blind whole. A repository holding none of a language is not
  // blind to it, so an empty corpus still writes and still cleans up.
  const unreadable = result.parse.unreadable || [];
  const blind = unreadable.length > 0 && (result.held === undefined || result.readNothing === true);
  const held = blind ? [] : result.held ?? [];
  const heldNames = new Set(held.map(areaFilename));

  // The facts on disk are the third fact ownership needs, and the record a held
  // area's file was derived from. Read before the new record replaces them, and
  // `null` when there is no record to read, which makes nothing removable.
  const previous = readFacts(result.root).facts;
  // A held area keeps the record its file was rendered from, or the check reads
  // a map without it and the file loads with nothing on disk deriving it. Only
  // from a record of this build's own shape: an older one read into this one
  // would be stamped with a schema it was not written under.
  const carried =
    previous?.schema === FACTS_SCHEMA
      ? previous.areas.filter((a) => isWholeArea(a) && heldNames.has(areaFilename(a)))
      : [];
  const described = carried.length
    ? { ...result, areas: [...result.areas, ...carried].sort((a, b) => byCode(a.path, b.path)) }
    : result;

  // A held area whose record was carried still describes its files, so they
  // are not uncovered. One with no record to carry describes nothing this run.
  const carriedIds = new Set(carried.map((a) => a.id));
  const heldCovered = held.filter((a) => carriedIds.has(a.id)).reduce((s, a) => s + a.fileCount, 0);
  const uncovered = result.corpus.files - result.areas.reduce((s, a) => s + a.fileCount, 0) - heldCovered;
  // Of those, the ones discovery found nowhere to put. The remainder sit in an
  // area that was discovered and then dropped for counting nothing, which is a
  // parse failure or a language with no dimension, not a directory too small.
  const { orphaned } = splitUncovered(uncovered, result.corpus.orphaned ?? uncovered);

  // The names first, then the audit, then the bodies: what this run is about to
  // write decides which of the files already there are stale, and the overview
  // has to name the ones that are neither ours nor stale.
  const names = blind ? [] : [OVERVIEW_FILE, ...withDirectives.map(areaFilename)];
  for (const name of names) {
    // A writer bug may not reach a hand-written file. Asserted here rather than
    // trusted because an area id happens to be a hex digest today.
    if (!isGeneratedName(name)) throw new Error(`refusing to write outside ${RULES_DIR}: ${name}`);
  }
  const planned = new Set(names);

  const audit = auditRules(result.root, knownNames(previous));
  // A name we are about to write that is a directory, or a fifo, or anything
  // else `readdir` reports and `rename` refuses. `anatomiya-overview.md` is a
  // fixed name, so a repository can ship a directory called that and every scan
  // dies on EISDIR from inside the atomic replace.
  // Thrown here, before the bodies below and before a dry run answers, because
  // 151 area bodies rendered to be discarded is work a repository should not be
  // able to ask for.
  const occupied = [...planned].filter((name) => audit.occupied.includes(name));
  if (occupied.length) {
    throw new Error(
      `${join(RULES_DIR, occupied[0])} is not a file, so the map could not be written: remove it and scan again`
    );
  }

  // Ours, and this run is not rewriting it, so its area is gone or states
  // nothing now, unless it is held, which is this run not knowing. Everything
  // else in the directory is left where it is.
  const stale = blind ? [] : audit.ours.filter((f) => !planned.has(f) && !heldNames.has(f));
  // Our prefix and our key, but no map on disk names it: an older build wrote
  // it, or the store was deleted. It still loads, so it is reported; it is not
  // removed, because two of the three facts is not ownership.
  const unknown = audit.unknown.filter((f) => !planned.has(f));
  // Somebody else's, unless this run is writing over it. A generated name is
  // ours by construction, so a hand-written file that took one is replaced
  // rather than left, and calling it a file this tool did not write would be
  // false about a file this run just replaced. It also moved the overview
  // between two scans of unchanged source, which is the one thing it may never
  // do: named on the first scan, ours and silent on the second.
  const foreign = audit.foreign.filter((f) => !planned.has(f));
  const replaced = audit.foreign.filter((f) => planned.has(f));
  // Whose these are was never established. They load, they are never removed,
  // and calling them somebody else's would assert authorship nobody checked.
  const unreadableRules = audit.unreadable.filter((f) => !planned.has(f));

  const bodies = new Map();
  if (!blind) {
    // The two kinds travel apart, because only one sentence is true of each
    // and the overview says both. Sorted, since `readdir` order is the
    // filesystem's and this file may not move between scans of unchanged
    // source.
    const others = {
      foreign: [...foreign].sort(),
      unknown: [...unknown].sort(),
      unreadable: [...unreadableRules].sort(),
    };
    bodies.set(OVERVIEW_FILE, renderOverview(described, { uncovered, orphaned, others }));
    for (const a of withDirectives) bodies.set(areaFilename(a), renderArea(a));
  }

  return {
    write: [...bodies.keys()],
    remove: stale,
    foreign,
    unknown,
    replaced,
    unreadableRules,
    listed: audit.listed,
    uncovered,
    orphaned,
    unreadable,
    // The area files left as the last scan that could read them wrote them.
    held: carried.map(areaFilename),
    bodies,
    blind,
    root: result.root,
    // The scan itself, with any held area's carried record beside the ones it
    // measured, because the facts record is derived from the whole of it and
    // the committer is handed a plan rather than a scan.
    result: described,
  };
}

/**
 * Whether a held area's record on disk is whole enough to carry.
 *
 * The record is committed, so it is the repository's to edit, and what a carried
 * area goes through next is the overview's renderer and the record's own writer,
 * both of which read every dimension. Only the array was checked, and
 * `dimensions: [null]` took the scan down with "Cannot read properties of null
 * (reading 'states')". An area that is not whole is not carried: it is then held
 * with no record, which the overview already counts as uncovered.
 */
function isWholeArea(a) {
  return isPlain(a)
    && typeof a.id === "string"
    && typeof a.path === "string"
    && Number.isFinite(a.fileCount)
    && Array.isArray(a.dimensions)
    && a.dimensions.every(isWholeDimension);
}

function isWholeDimension(d) {
  return isPlain(d)
    && typeof d.key === "string"
    && Number.isFinite(d.candidates)
    && Number.isFinite(d.conforming)
    && Array.isArray(d.exceptions)
    && (d.states === undefined || d.states === null || d.states === "claim" || d.states === "counter")
    && (d.counterClaim === undefined || typeof d.counterClaim === "string")
    && (d.counterExceptions === undefined || Array.isArray(d.counterExceptions))
    && (d.baseline === undefined || isPlain(d.baseline));
}

const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * The filesystem half: the directories, the facts, the bodies, the removals.
 *
 * The invariant: no rendered file exists that is not derivable from the facts
 * on disk, and no facts sit beside rendered files of another scan. So every
 * byte is written to a temporary file before anything is replaced, the facts
 * are replaced first and orphans removed last, and a failure part way puts
 * back what was there. A process killed between two renames can still leave
 * both, which is the one window left.
 */
export function commitMap(root, plan) {
  // One root or none. The record is written under this one and stamped with the
  // plan's, so two roots put one repository's facts in another under its name.
  if (root !== plan.root) {
    throw new Error(`the plan was made for ${plan.root}, so nothing was written to ${root}`);
  }
  // Before the directories, not after. A blind run writes nothing, removes
  // nothing and replaces no facts, so creating the two directories left an
  // empty map behind on every scan a container without the interpreter ran:
  // "nothing was written" and a `.claude/rules` that was not there before.
  if (plan.blind) return plan;

  const { rulesDir, storeDir } = resolveDirs(root);

  mkdirSync(rulesDir, { recursive: true });
  mkdirSync(storeDir, { recursive: true });

  // Facts too, and with the rest: `check` reads facts.json, so new facts beside
  // the old files call a map fresh that the session holds an older scan of.
  const record = factsJson(plan.result);
  // The layout file after the record: `readLayout` refuses one older than it.
  const writes = [
    [join(storeDir, basename(FACTS_PATH)), record],
    [join(storeDir, basename(LAYOUT_PATH)), layoutJson(plan.result, record)],
    ...[...plan.bodies].map(([name, body]) => [join(rulesDir, name), body]),
  ];
  const staged = [];
  try {
    for (const [path, body] of writes) staged.push([writeTemp(path, body), path]);
    replaceAll(staged, plan.remove.map((f) => join(rulesDir, f)));
  } catch (err) {
    for (const [tmp] of staged) quietUnlink(tmp);
    throw err;
  }

  return plan;
}

/**
 * Rename every staged file into place and remove the orphans, or put back what
 * was there before the first one moved.
 *
 * A rename in a directory the temporary file was just created in still fails:
 * Windows refuses one over a file another process holds open.
 */
function replaceAll(staged, removals) {
  // Read before the first rename, so the window between the facts and the last
  // file holds renames and nothing else.
  const before = new Map([...staged.map(([, path]) => path), ...removals].map((p) => [p, previousBytes(p)]));
  const undo = [];
  try {
    for (const [tmp, path] of staged) {
      renameSync(tmp, path);
      undo.push([path, before.get(path)]);
    }
    for (const path of removals) {
      const previous = before.get(path);
      try {
        unlinkSync(path);
      } catch (err) {
        if (err.code === "ENOENT") continue;
        throw err;
      }
      undo.push([path, previous]);
    }
  } catch (err) {
    for (const [path, previous] of undo.reverse()) {
      try {
        if (previous === null) unlinkSync(path);
        else if (previous !== undefined) atomic(path, previous);
      } catch {}
    }
    throw err;
  }
}

/** A regular file's bytes, `null` where nothing is, `undefined` where they cannot be put back. */
function previousBytes(path) {
  let fd;
  try {
    // Opened then typed through the handle, so the file read is the file typed;
    // O_NOFOLLOW refuses a link the way lstat did.
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    return fstatSync(fd).isFile() ? readFileSync(fd) : undefined;
  } catch (err) {
    return err.code === "ENOENT" ? null : undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function quietUnlink(path) {
  try {
    unlinkSync(path);
  } catch {}
}

/**
 * The two directories the map lives in, resolved and never joined.
 *
 * A tracked `.claude -> ../victim` survives a clone, and `join` normalises `..`
 * without following a link, so every write, every removal and `facts.json`
 * itself landed in a directory the repository does not own. Fail closed: a map
 * that cannot be written where it belongs is not written anywhere. Asked twice,
 * because the answer that matters is the one the tree gives at the write.
 */
function resolveDirs(root) {
  const rulesDir = resolveRulesDir(root);
  if (rulesDir === null) {
    throw new Error(`${outsideClaude(RULES_DIR)}, so nothing was written: this is a symlink in the working tree`);
  }
  const storeDir = resolveInside(root, STORE_DIR);
  if (storeDir === null) {
    throw new Error(`${outsideClaude(STORE_DIR)}, so nothing was written: this is a symlink in the working tree`);
  }
  for (const rel of [RULES_DIR, STORE_DIR]) refuseNonDirectory(root, rel);
  return { rulesDir, storeDir };
}

/**
 * Refuse a map directory that a file already holds, that sits under one, or
 * that this process cannot write.
 *
 * Resolving says where the directory is, not that it can be one there: a
 * regular file at `.claude/rules` let a dry run print "would write 2 files"
 * while the real scan died on a raw `EEXIST` out of `mkdir`, and a file at
 * `.claude` did the same with `ENOTDIR`. The nearest thing that exists on the
 * way down to the directory has to be a directory, and the path that is not is
 * named by the repository's own spelling of it, since it is the one to remove.
 * A link is named as one and the link is what goes: the resolved name was
 * printed once, and `.claude/rules -> ../README.md` told the reader to remove
 * the README.
 */
function refuseNonDirectory(root, rel) {
  const blocked = blockedOnTheWay(root, rel);
  if (blocked === null) return;
  throw new Error(`${blocked.sentence}, so the map could not be written: ${blocked.remedy} and scan again`);
}
