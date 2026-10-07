import { lstatSync, mkdirSync, renameSync, rmdirSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { hasFile, renderArea, renderOverview, splitUncovered } from "./render.mjs";
import { FACTS_PATH, FACTS_SCHEMA, LAYOUT_PATH, readFacts, readLayout, factsJson, stampedLayout, previousBytes, putBack, writeTemp } from "./facts.mjs";
import { byCode } from "./paths.mjs";
import {
  RULES_DIR,
  STORE_DIR,
  areaFilename,
  auditRules,
  blockedOnTheWay,
  isGeneratedName,
  isMapName,
  knownNames,
  leafReplaceable,
  outsideClaude,
  resolveInside,
  resolveRulesDir,
  resolveTargetDir,
  spelledOtherwise,
  targetStatus,
} from "./rules.mjs";
import { TARGETS, TARGET_IDS, areaName, overviewName } from "./targets.mjs";

/**
 * Write the map: plan it, and put it on disk unless this is a dry run.
 *
 * `targets` is the whole set of places it goes, by id, or null for the ones
 * already on. Claude Code's is in every set.
 */
export function writeMap(result, { dryRun = false, targets = null } = {}) {
  const plan = planMap(result, { targets });
  return dryRun ? plan : commitMap(result.root, plan);
}

/**
 * The map, decided and rendered, with nothing created.
 *
 * Every body a write would put on disk comes back on the plan, because the one
 * caller that wanted the map without one had to derive it a second time, and a
 * second derivation of the same thing is a drift waiting for a field to move.
 */
export function planMap(result, { targets = null } = {}) {
  // Resolved before anything is rendered, and before a dry run answers: a plan
  // reporting a clean write that cannot happen is the one answer worse than the
  // failure.
  const { storeDir } = resolveDirs(result.root);
  // The record's and its layout file's names, the leaves here the map does not
  // audit. A directory committed at the record let a dry run say "would write"
  // and the scan die on a raw `EISDIR` out of the rename.
  for (const leaf of [FACTS_PATH, LAYOUT_PATH]) {
    if (!leafReplaceable(join(storeDir, basename(leaf)))) {
      throw new Error(`${leaf} is not a file, so the map could not be written: remove it and scan again`);
    }
  }
  // The facts on disk are the third fact ownership needs, and the record a held
  // area's file was derived from. Read before the new record replaces them, and
  // `null` when there is no record to read, which makes nothing removable.
  const previous = readFacts(result.root).facts;
  // After Claude Code's own directories: theirs is the refusal a scan has always
  // given, and the other targets can read as on or off while it does not resolve.
  const others = otherTargets(result.root, targets, previous);

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

  // Every directory is audited before any body is rendered: a name that cannot
  // be written refuses the scan, and 151 area bodies rendered to be discarded
  // is work a repository should not be able to ask for.
  const scan = { root: result.root, previous, blind, held, areas: withDirectives };
  const claude = auditTarget(TARGETS.claude, { on: true }, scan);
  const rest = others.map((o) => (o.state === "unknown" ? o : { ...o, ...auditTarget(o.target, o, scan) }));

  const files = { uncovered, orphaned };
  const bodies = renderTarget(TARGETS.claude, claude, described, files);

  return {
    write: [...bodies.keys()],
    remove: claude.stale,
    foreign: claude.foreign,
    unknown: claude.unknown,
    replaced: claude.replaced,
    unreadableRules: claude.unreadableRules,
    listed: claude.listed,
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
    // The same fields for each other directory, and why one was left alone.
    targets: Object.fromEntries(
      rest.map((o) => [o.target.id, o.state === "unknown" ? leftAlone(o, previous) : targetPlan(o, described, files)])
    ),
  };
}

/**
 * The Cursor and Copilot targets: what each one's own overview says, and
 * whether this scan writes it.
 *
 * One that could not be read is neither written nor cleared: off is what
 * removes a map, and nobody saw that it is off. Asking for it by name refuses
 * the scan instead, since writing the others and not that one is not what was
 * asked. So does leaving it out by name while the record names files of ours
 * there, which asks for a removal that cannot happen.
 */
function otherTargets(root, asked, previous) {
  if (asked !== null) {
    if (!Array.isArray(asked)) throw new Error("targets is a list of names, or null for the ones already on");
    const stranger = asked.find((id) => !TARGET_IDS.includes(id));
    if (stranger !== undefined) throw new Error(`unknown target: ${stranger}; the targets are ${TARGET_IDS.join(", ")}`);
  }
  return TARGET_IDS.map((id) => TARGETS[id])
    .filter((target) => !target.always)
    .map((target) => {
      const { state, reason = null, remedy } = targetStatus(root, target);
      const explicit = asked !== null;
      if (state !== "unknown") return { target, state, reason, explicit, on: explicit ? asked.includes(target.id) : state === "on" };
      if (asked?.includes(target.id)) {
        throw new Error(`${reason}, so ${target.dir} could not be written and nothing was written anywhere: ${remedy} and scan again`);
      }
      if (explicit && knownNames(previous, target)?.size) {
        throw new Error(`${reason}, so ${target.dir} could not be turned off and nothing was written anywhere: ${remedy} and scan again`);
      }
      return { target, state, reason, explicit, on: false };
    });
}

/**
 * What one directory holds against what this scan would put there, with
 * nothing rendered yet.
 *
 * A target that is not on plans no name, so every file of ours in its directory
 * is stale: that is turning it off.
 *
 * `explicit` is a caller that listed the targets, so this one was named or left
 * out on purpose, not found on or off.
 */
function auditTarget(target, { on, explicit = false }, { root, previous, blind, held, areas }) {
  const nameOf = (a) => areaName(target, a.id);
  const wanted = on && !blind ? areas.filter((a) => hasFile(a, target)) : [];
  // The names first, then the audit, then the bodies: what this run is about to
  // write decides which of the files already there are stale, and the overview
  // has to name the ones that are neither ours nor stale.
  const all = on && !blind ? [overviewName(target), ...wanted.map(nameOf)] : [];
  for (const name of all) {
    // A writer bug may not reach a hand-written file. Asserted here rather than
    // trusted because an area id happens to be a hex digest today.
    if (!isGeneratedName(name, target)) throw new Error(`refusing to write outside ${target.dir}: ${name}`);
  }

  const audit = auditRules(root, knownNames(previous, target), target);
  // Cursor's and Copilot's directories are where people write rules by hand, so
  // a file there that does not say this tool wrote it is never written over,
  // whatever its name. Named, the target cannot be written as asked and the
  // scan says so. Merely on, the file stays and its area has no file there. An
  // overview that stopped being ours after the target read as on refuses too.
  // A directory or a fifo at the name is the same answer: a refresh nobody is
  // watching may not stop over an entry in a directory another tool owns.
  const theirs = [audit.foreign, audit.unreadable, audit.occupied];
  // An entry spelled as a planned name in another case is that name on a volume
  // that folds case, so writing ours writes over it. Somebody's, whatever it says.
  const alias = (n) => spelledOtherwise(audit.entries, n);
  const taken = target.always ? [] : all.filter((n) => alias(n) !== undefined || theirs.some((list) => list.includes(n)));
  if (taken.length && (explicit || taken.includes(overviewName(target)))) {
    const at = alias(taken[0]) ?? taken[0];
    const what = at !== taken[0]
      ? "was not written by this tool"
      : audit.unreadable.includes(at)
        ? "could not be read"
        : audit.occupied.includes(at)
          ? "is not a file"
          : "was not written by this tool";
    throw new Error(
      `${target.dir}/${at} ${what}, so ${target.dir} could not be written and nothing was written anywhere: move or delete it and scan again`
    );
  }
  const aliases = taken.map(alias).filter((e) => e !== undefined);
  const names = all.filter((n) => !taken.includes(n));
  const filed = wanted.filter((a) => !taken.includes(nameOf(a)));
  const planned = new Set(names);
  const heldNames = new Set(held.map(nameOf));

  // A name we are about to write that is a directory, or a fifo, or anything
  // else `readdir` reports and `rename` refuses. `anatomiya-overview.md` is a
  // fixed name, so a repository can ship a directory called that and every scan
  // dies on EISDIR from inside the atomic replace.
  const occupied = names.filter((name) => audit.occupied.includes(name));
  if (occupied.length) {
    throw new Error(
      `${join(target.dir, occupied[0])} is not a file, so the map could not be written: remove it and scan again`
    );
  }

  // Ours, and this run is not rewriting it, so its area is gone or states
  // nothing now, unless it is held, which is this run not knowing. Everything
  // else in the directory is left where it is.
  //
  // A target left out by name is the exception to asking the record: a clone
  // can hold the files and not the store, and then no scan could turn it off.
  // The key decides there, for a name a scan gives a file: a copy somebody
  // kept under another name carries the key too.
  const mine = explicit && !on ? [...audit.ours, ...audit.unknown.filter((f) => isMapName(f, target))].sort() : audit.ours;
  const stale = blind ? [] : mine.filter((f) => !planned.has(f) && !heldNames.has(f));
  // Ours and held, so still ours after this run: the next record has to go on naming it.
  const kept = mine.filter((f) => !planned.has(f) && heldNames.has(f));
  // Claude Code's two directories were held to this before anything was read.
  if (!target.always && (names.length > 0 || stale.length > 0)) refuseNonDirectory(root, target.dir);

  return {
    filed,
    // The areas whose name somebody else's file holds, for the overview to leave out.
    left: wanted.filter((a) => taken.includes(nameOf(a))).map((a) => a.id),
    names,
    stale,
    kept,
    // Our prefix and our key, but no map on disk names it: an older build wrote
    // it, or the store was deleted. It still loads, so it is reported; it is not
    // removed, because two of the three facts is not ownership.
    unknown: audit.unknown.filter((f) => !planned.has(f) && !stale.includes(f) && !kept.includes(f) && !aliases.includes(f)),
    // Somebody else's, unless this run is writing over it, which it does in
    // Claude Code's directory alone. A generated name there is ours by
    // construction, so a hand-written file that took one is replaced rather
    // than left, and calling it a file this tool did not write would be false
    // about a file this run just replaced. It also moved the overview
    // between two scans of unchanged source, which is the one thing it may never
    // do: named on the first scan, ours and silent on the second.
    foreign: [...new Set([...audit.foreign.filter((f) => !planned.has(f)), ...taken.filter((n) => audit.occupied.includes(n)), ...aliases])].sort(),
    replaced: audit.foreign.filter((f) => planned.has(f)),
    // Whose these are was never established. They load, they are never removed,
    // and calling them somebody else's would assert authorship nobody checked.
    unreadableRules: audit.unreadable.filter((f) => !planned.has(f) && !aliases.includes(f)),
    listed: audit.listed,
  };
}

/** Every body one directory gets, by filename: none for a target that plans no name. */
function renderTarget(target, laid, described, files) {
  const bodies = new Map();
  if (laid.names.length === 0) return bodies;
  // The two kinds travel apart, because only one sentence is true of each
  // and the overview says both. Sorted, since `readdir` order is the
  // filesystem's and this file may not move between scans of unchanged
  // source.
  const others = {
    foreign: [...laid.foreign].sort(),
    unknown: [...laid.unknown].sort(),
    unreadable: [...laid.unreadableRules].sort(),
  };
  bodies.set(overviewName(target), renderOverview(described, { ...files, others, left: laid.left }, target));
  for (const a of laid.filed) {
    const body = renderArea(a, target);
    // The name was planned off the same question, so this is two answers to it.
    if (body === null) throw new Error(`${a.path} has no pattern ${target.reader} can be given, so its file could not be written`);
    bodies.set(areaName(target, a.id), body);
  }
  return bodies;
}

function targetPlan({ target, state, reason, on, explicit, ...laid }, described, files) {
  const bodies = renderTarget(target, laid, described, files);
  return {
    dir: target.dir,
    state,
    reason,
    on,
    write: [...bodies].map(([name, body]) => ({ name, body })),
    remove: laid.stale,
    foreign: laid.foreign,
    unknown: laid.unknown,
    replaced: laid.replaced,
    unreadableRules: laid.unreadableRules,
    listed: laid.listed,
    // The areas the overview there says no file covers.
    unfiled: bodies.size ? described.areas.filter((a) => !hasFile(a, target)).map((a) => a.path) : [],
    // Every file of ours the directory holds once this is committed, for the record.
    names: [...laid.names, ...laid.kept].sort(),
  };
}

// The record goes on naming what it named, or none of it could be removed once the directory reads again.
function leftAlone({ target, state, reason, on }, previous) {
  const none = { write: [], remove: [], foreign: [], unknown: [], replaced: [], unreadableRules: [], listed: false, unfiled: [] };
  return { dir: target.dir, state, reason, on, ...none, names: [...(knownNames(previous, target) ?? [])].sort() };
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
  // Asked again here for the same reason, and only of a directory this touches.
  const own = (id, t) => {
    const dir = resolveTargetDir(root, TARGETS[id]);
    if (dir === null) throw new Error(`${t.dir} is no longer a directory of this repository's own, so nothing was written`);
    return dir;
  };
  const others = Object.entries(plan.targets)
    .filter(([, t]) => t.write.length > 0 || t.remove.length > 0)
    .map(([id, t]) => ({ ...t, id, at: own(id, t) }));

  // Facts too, and with the rest: `check` reads facts.json, so new facts beside
  // the old files call a map fresh that the session holds an older scan of.
  const factsPath = join(storeDir, basename(FACTS_PATH));
  const staged = [];
  const made = [];
  try {
    for (const t of others) if (t.write.length > 0) makeOwnDirectory(t.at, t.dir, made);
    mkdirSync(rulesDir, { recursive: true });
    mkdirSync(storeDir, { recursive: true });

    const names = Object.fromEntries(Object.entries(plan.targets).map(([id, t]) => [id, t.names]));
    const recordTemp = writeTemp(factsPath, factsJson(plan.result, names));
    staged.push([recordTemp, factsPath]);
    // In the order they are renamed: the record, its layout file, then each directory in turn.
    const writes = [
      [join(storeDir, basename(LAYOUT_PATH)), stampedLayout(plan.result.layout, recordTemp)],
      ...[...plan.bodies].map(([name, body]) => [join(rulesDir, name), body]),
      ...others.flatMap((t) => t.write.map(({ name, body }) => [join(t.at, name), body])),
    ];
    for (const [path, body] of writes) staged.push([writeTemp(path, body), path]);
    const removals = [
      ...plan.remove.map((f) => join(rulesDir, f)),
      ...others.flatMap((t) => t.remove.map((f) => join(t.at, f))),
    ];
    // And once more with everything staged: writing the bodies is the long part,
    // and a link put at a directory meanwhile is where the renames would land.
    for (const t of others) own(t.id, t);
    // A removal has no temporary file beside it to hold it to the directory it
    // was planned in, so each one asks where that directory is now. A rename
    // asks too, and so refuses in a sentence where it would fail on an errno.
    const byDir = new Map(others.map((t) => [t.at, t]));
    const stillOwn = (path) => {
      const t = byDir.get(dirname(path));
      if (t) own(t.id, t);
    };
    replaceAll(staged, removals, { record: factsPath, was: readLayout(root) }, stillOwn);
  } catch (err) {
    for (const [tmp] of staged) quietUnlink(tmp);
    // Deepest first, and only while empty: `rmdir` refuses anything else.
    for (const dir of made.reverse()) quietRmdir(dir);
    throw err;
  }

  return plan;
}

/**
 * Make a target's directory one component at a time, each of them a directory
 * of the repository's own once it is there.
 *
 * Looked at again after the `mkdir`, because the path was resolved before it:
 * a link put there in between is where every file of this target would land.
 * `made` takes the ones this call created, for a rollback to take back out.
 */
function makeOwnDirectory(at, rel, made) {
  const parts = rel.split("/");
  let dir = join(at, ...parts.map(() => ".."));
  for (let i = 0; i < parts.length; i++) {
    dir = join(dir, parts[i]);
    try {
      mkdirSync(dir);
      made.push(dir);
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
    if (!lstatSync(dir).isDirectory()) {
      throw new Error(`${parts.slice(0, i + 1).join("/")} is not a directory, so nothing was written: remove it and scan again`);
    }
  }
}

/**
 * Rename every staged file into place and remove the orphans, or put back what
 * was there before the first one moved. `stillOwn` throws for a path whose
 * directory is no longer where the plan found it.
 *
 * A rename in a directory the temporary file was just created in still fails:
 * Windows refuses one over a file another process holds open.
 */
function replaceAll(staged, removals, pair, stillOwn) {
  // Read before the first rename, so the window between the facts and the last
  // file holds renames and nothing else.
  const before = new Map([...staged.map(([, path]) => path), ...removals].map((p) => [p, previousBytes(p)]));
  const undo = [];
  try {
    for (const [tmp, path] of staged) {
      stillOwn(path);
      renameSync(tmp, path);
      undo.push([path, before.get(path)]);
    }
    for (const path of removals) {
      const previous = before.get(path);
      stillOwn(path);
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
        // The layout file is stamped from the record alone, so only the
        // record's put-back writes it again. Nothing is put back through a
        // directory that stopped being the repository's own.
        stillOwn(path);
        putBack(path, previous, path === pair.record ? pair.was : null);
      } catch {}
    }
    throw err;
  }
}

function quietUnlink(path) {
  try {
    unlinkSync(path);
  } catch {}
}

function quietRmdir(path) {
  try {
    rmdirSync(path);
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
