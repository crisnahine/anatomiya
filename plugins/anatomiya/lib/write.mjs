import { lstatSync, mkdirSync, renameSync, rmdirSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { hasFile, renderArea, renderOverview, splitUncovered } from "./render.mjs";
import { FACTS_PATH, FACTS_SCHEMA, LAYOUT_PATH, readFacts, readLayout, factsJson, stampedLayout, previousBytes, putBack, writePair, writeTemp } from "./facts.mjs";
import { byCode } from "./paths.mjs";
import {
  REFRESH_STATE,
  RULES_DIR,
  STORE_DIR,
  areaFilename,
  auditRules,
  blockedOnTheWay,
  foldedOnto,
  isGeneratedName,
  isMapName,
  knownNames,
  leafReplaceable,
  outsideClaude,
  resolveInside,
  resolveRulesDir,
  resolveTargetDir,
  spelledOtherwise,
  stagedBy,
  stagedInStore,
  targetStatus,
} from "./rules.mjs";
import { TARGETS, TARGET_IDS, areaName, assertTargets, isClaude, overviewName } from "./targets.mjs";

/**
 * Write the map: plan it, and put it on disk unless this is a dry run.
 *
 * `targets` is the whole set of places it goes, by id, or null for the ones
 * already on. Claude Code's is in every set. `leaveAlone` is the other targets
 * to leave exactly as they are, for a caller that may not touch their files.
 */
export function writeMap(result, { dryRun = false, targets = null, leaveAlone = [] } = {}) {
  const plan = planMap(result, { targets, leaveAlone });
  return dryRun ? plan : commitMap(result.root, plan);
}

/**
 * The map, decided and rendered, with nothing created.
 *
 * Every body a write would put on disk comes back on the plan, because the one
 * caller that wanted the map without one had to derive it a second time, and a
 * second derivation of the same thing is a drift waiting for a field to move.
 */
export function planMap(result, { targets = null, leaveAlone = [] } = {}) {
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
  const others = otherTargets(result.root, targets, previous, leaveAlone);

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
  const rest = others.map((o) => (untouched(o) ? o : audited(o, scan)));

  const files = { uncovered, orphaned };
  const bodies = renderTarget(TARGETS.claude, claude, described, files);
  // Every other overview is laid out against what Claude Code's directory holds.
  const claudeFiles = overviewFiles(claude, files);

  return {
    write: [...bodies.keys()],
    remove: claude.stale,
    // The temporary files an earlier scan left in Claude Code's directory, removed with the rest.
    staged: claude.staged,
    // And the ones a scan or a refresh left in the store, where the record is megabytes on a large repository.
    storeStaged: blind ? [] : stagedInStore(storeDir, STORE_STAGED).filter(({ pid }) => !running(pid)).map(({ name }) => name),
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
      rest.map((o) => [o.target.id, untouched(o) ? untouchedPlan(o, recorded(previous, o.target)) : targetPlan(o, described, files, claudeFiles, recorded(previous, o.target))])
    ),
  };
}

/**
 * The Cursor and Copilot targets: what each one's own overview says, and
 * whether this scan writes it.
 *
 * One that could not be read is neither written nor cleared: off is what
 * removes a map, and nobody saw that it is off. One whose directory cannot be
 * written is found out at the audit and left the same way. Asking for it by name refuses
 * the scan instead, since writing the others and not that one is not what was
 * asked. So does leaving it out by name while the record names files of ours
 * there, which asks for a removal that cannot happen.
 */
function otherTargets(root, asked, previous, leaveAlone) {
  if (asked !== null) {
    if (!Array.isArray(asked)) throw new Error("targets is a list of names, or null for the ones already on");
    assertTargets(asked);
  }
  return TARGET_IDS.map((id) => TARGETS[id])
    .filter((target) => !isClaude(target))
    .map((target) => {
      const { state, reason = null, remedy } = targetStatus(root, target);
      const explicit = asked !== null;
      if (leaveAlone.includes(target.id)) return { target, state, reason, remedy, explicit, on: false, leftAlone: true };
      if (state !== "unknown") return { target, state, reason, explicit, on: explicit ? asked.includes(target.id) : state === "on" };
      if (asked?.includes(target.id)) {
        throw new Error(`${reason}, so ${target.dir} could not be written and nothing was written anywhere: ${remedy} and scan again`);
      }
      if (explicit && knownNames(previous, target)?.size) {
        throw new Error(`${reason}, so ${target.dir} could not be turned off and nothing was written anywhere: ${remedy} and scan again`);
      }
      return { target, state, reason, remedy, explicit, on: false };
    });
}

/**
 * One other target with its directory audited, or as unknown where the
 * directory cannot be written and this scan was not told to write it.
 */
function audited(o, scan) {
  const laid = auditTarget(o.target, o, scan);
  if (!laid.blocked) return { ...o, ...laid };
  const { sentence, remedy } = laid.blocked;
  return { ...o, state: "unknown", on: false, reason: sentence, remedy, unwritable: true };
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
  // An entry spelled as a planned name in another case, with nothing at the name
  // itself, may be that name on this volume, so writing ours may write over it.
  // Somebody's, whatever it says.
  const alias = (n) => spelledOtherwise(audit.entries, n);
  const taken = isClaude(target) ? [] : all.filter((n) => alias(n) !== null || theirs.some((list) => list.includes(n)));
  if (taken.length && (explicit || taken.includes(overviewName(target)))) {
    const at = alias(taken[0]) ?? taken[0];
    // An entry spelled otherwise is somebody's, whatever it is.
    const shape = at !== taken[0] ? null : audit.unreadable.includes(at) ? "could not be read" : audit.occupied.includes(at) ? "is not a file" : null;
    const what = shape ?? "was not written by this tool";
    throw new Error(
      `${target.dir}/${at} ${what}, so ${target.dir} could not be written and nothing was written anywhere: move or delete it and scan again`
    );
  }
  const aliases = taken.map(alias).filter((e) => e !== null);
  const names = all.filter((n) => !taken.includes(n));
  const filed = wanted.filter((a) => !taken.includes(nameOf(a)));
  const planned = new Set(names);
  // An entry a volume that folds case answers a planned name with is the file
  // at that name, so this run writes over it. In Claude Code's directory alone:
  // anywhere else a name with such an entry is taken, and not planned.
  const landed = new Set(foldedOnto(audit.dir, audit.entries, names));
  const written = (f) => planned.has(f) || landed.has(f);
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
  // nothing now, unless it is held, which is this run not knowing. A target
  // that is off keeps none of ours, so what is held has no say there.
  // Everything else in the directory is left where it is.
  //
  // A target left out by name is the exception to asking the record: a clone
  // can hold the files and not the record, and then no scan could turn it off.
  // The key decides there, for a name a scan gives a file: a copy somebody
  // kept under another name carries the key too.
  const mine = explicit && !on ? [...audit.ours, ...audit.unknown.filter((f) => isMapName(f, target))].sort() : audit.ours;
  const stale = blind ? [] : mine.filter((f) => !planned.has(f) && (!on || !heldNames.has(f)));
  // Ours and held, so still ours after this run: the next record has to go on naming it.
  const kept = mine.filter((f) => !planned.has(f) && !stale.includes(f) && heldNames.has(f));
  // A scan that stopped while this directory was swapped for a link missed its
  // own temporary files, and nothing else knows their names: 66 stayed in one
  // directory after 8 such scans. Removed wherever this scan writes or removes,
  // and where a target was left out by name, since off is none of this tool's
  // files. One whose stager is still running is a scan about to rename it.
  const cleans = on || explicit || stale.length > 0;
  const staged = blind || !cleans ? [] : audit.staged.filter((f) => !running(stagedBy(f, target)));
  // Claude Code's two directories were held to this before anything was read.
  if (!isClaude(target) && (names.length > 0 || stale.length > 0 || staged.length > 0)) {
    // Named, the target cannot be written as asked, and the scan says so.
    // Found on, it is another tool's directory, and a permission on it may not
    // stop Claude Code's map: nothing there is written or removed.
    if (explicit) refuseNonDirectory(root, target.dir);
    const blocked = blockedOnTheWay(root, target.dir);
    if (blocked !== null) return { blocked };
  }

  return {
    filed,
    // On with no flag and no file of ours on record: the overview somebody committed is all that asked.
    first: !isClaude(target) && on && !explicit && !knownNames(previous, target)?.size,
    // The areas whose name somebody else's file holds, and the held ones this
    // directory has no file of, for the overview to leave out.
    left: [...wanted.filter((a) => taken.includes(nameOf(a))), ...held.filter((a) => !kept.includes(nameOf(a)))].map((a) => a.id),
    names,
    stale,
    staged,
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
    //
    // In another tool's directory a directory or a fifo under this tool's
    // prefix is somebody's entry as a link there is, planned name or not: a
    // target turned off plans no name and still leaves the entry behind.
    foreign: [...new Set([...audit.foreign.filter((f) => !written(f)), ...(isClaude(target) ? [] : audit.occupied), ...aliases])].sort(),
    replaced: audit.foreign.filter(written),
    // Whose these are was never established. They load, they are never removed,
    // and calling them somebody else's would assert authorship nobody checked.
    unreadableRules: audit.unreadable.filter((f) => !written(f) && !aliases.includes(f)),
    listed: audit.listed,
  };
}

/** What one directory's overview is told about that directory, beside the counts every overview carries. */
function overviewFiles(laid, files) {
  // The two kinds travel apart, because only one sentence is true of each
  // and the overview says both. Sorted, since `readdir` order is the
  // filesystem's and this file may not move between scans of unchanged
  // source.
  const others = {
    foreign: [...laid.foreign].sort(),
    unknown: [...laid.unknown].sort(),
    unreadable: [...laid.unreadableRules].sort(),
  };
  return { ...files, others, left: laid.left };
}

/** Every body one directory gets, by filename: none for a target that plans no name. */
function renderTarget(target, laid, described, files, claudeFiles = overviewFiles(laid, files)) {
  const bodies = new Map();
  if (laid.names.length === 0) return bodies;
  bodies.set(overviewName(target), renderOverview(described, overviewFiles(laid, files), target, claudeFiles));
  for (const a of laid.filed) {
    const body = renderArea(a, target);
    // The name was planned off the same question, so this is two answers to it.
    if (body === null) throw new Error(`${a.path} has no pattern ${target.reader} can be given, so its file could not be written`);
    bodies.set(areaName(target, a.id), body);
  }
  return bodies;
}

function targetPlan({ target, state, reason, on, explicit, ...laid }, described, files, claudeFiles, was) {
  const bodies = renderTarget(target, laid, described, files, claudeFiles);
  return {
    dir: target.dir,
    state,
    reason,
    on,
    // Whether the scan was told this target by name, and the files the record
    // names there now: what a write that a locked file stops is decided by and falls back to.
    named: explicit,
    was,
    first: laid.first,
    write: [...bodies].map(([name, body]) => ({ name, body })),
    // A temporary file an earlier scan left is counted with what this one removes.
    remove: [...laid.stale, ...laid.staged],
    foreign: laid.foreign,
    unknown: laid.unknown,
    unreadableRules: laid.unreadableRules,
    // The areas the overview there says no file covers.
    unfiled: bodies.size ? described.areas.filter((a) => !hasFile(a, target)).map((a) => a.path) : [],
    // Every file of ours the directory holds once this is committed, for the record.
    names: [...laid.names, ...laid.kept].sort(),
  };
}

// The record goes on naming what it named, or none of it could be removed once the directory reads again.
function untouchedPlan({ target, state, reason, remedy, on, leftAlone, unwritable }, was) {
  const none = { first: false, write: [], remove: [], foreign: [], unknown: [], unreadableRules: [], unfiled: [] };
  return { dir: target.dir, state, reason, ...(remedy ? { remedy } : {}), on, ...(leftAlone ? { leftAlone } : {}), ...(unwritable ? { unwritable } : {}), ...none, names: was };
}

// The files of ours the record on disk names in one directory, sorted.
const recorded = (previous, target) => [...(knownNames(previous, target) ?? [])].sort();

// The files a scan and a refresh stage in the store, by name.
const STORE_STAGED = [FACTS_PATH, LAYOUT_PATH, REFRESH_STATE].map((path) => basename(path));

// Nobody read it, or the caller said to leave it alone: neither is written, cleared or turned off.
const untouched = (o) => o.state === "unknown" || o.leftAlone === true;

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
  const own = (id, t, did) => {
    const dir = resolveTargetDir(root, TARGETS[id]);
    if (dir === null) throw movedAway(t.dir, did);
    return dir;
  };
  const all = Object.entries(plan.targets)
    .filter(([, t]) => t.write.length > 0 || t.remove.length > 0)
    .map(([id, t]) => ({ ...t, id, at: own(id, t, UNTOUCHED) }));

  // Facts too, and with the rest: `check` reads facts.json, so new facts beside
  // the old files call a map fresh that the session holds an older scan of.
  const factsPath = join(storeDir, basename(FACTS_PATH));
  const staged = [];
  const theirs = [];
  const made = [];
  try {
    for (const t of all) if (t.write.length > 0) makeOwnDirectory(t.at, t.dir, made);
    mkdirSync(rulesDir, { recursive: true });
    mkdirSync(storeDir, { recursive: true });

    // Ahead of the record, which names what each directory holds once this is done. A directory nobody named that
    // takes no new file is stopped as a locked file stops it, one step sooner: `access` passed it at the audit, and on
    // Windows that call reads no ACL.
    const refused = new Map();
    for (const t of all) {
      const from = theirs.length;
      try {
        for (const { name, body } of t.write) theirs.push([stage(join(t.at, name), body, t.dir), join(t.at, name)]);
      } catch (err) {
        if (!err.unstaged || t.named) throw err;
        for (const [tmp] of theirs.splice(from)) quietUnlink(tmp);
        refused.set(t.id, err.unstaged);
      }
    }
    const others = all.filter((t) => !refused.has(t.id));

    const names = Object.fromEntries(Object.entries(plan.targets).map(([id, t]) => [id, refused.has(id) ? t.was : t.names]));
    const recordTemp = stage(factsPath, factsJson(plan.result, names), STORE_DIR);
    staged.push([recordTemp, factsPath]);
    // In the order they are renamed: the record, its layout file, then each directory in turn.
    staged.push([stage(join(storeDir, basename(LAYOUT_PATH)), stampedLayout(plan.result.layout, recordTemp), STORE_DIR), join(storeDir, basename(LAYOUT_PATH))]);
    for (const [name, body] of plan.bodies) staged.push([stage(join(rulesDir, name), body, RULES_DIR), join(rulesDir, name)]);
    const removals = [
      ...plan.storeStaged.map((f) => join(storeDir, f)),
      ...[...plan.remove, ...plan.staged].map((f) => join(rulesDir, f)),
      ...others.flatMap((t) => t.remove.map((f) => join(t.at, f))),
    ];
    // A temporary file holds nothing worth putting back, and its size is whatever
    // the repository made it: 1.5 GB sparse at such a name took a scan to 1,535 MB.
    const leftover = new Set([
      ...plan.storeStaged.map((f) => join(storeDir, f)),
      ...plan.staged.map((f) => join(rulesDir, f)),
      ...others.flatMap((t) => t.remove.filter((f) => stagedBy(f, TARGETS[t.id]) !== null).map((f) => join(t.at, f))),
    ]);
    // And once more with everything staged: writing the bodies is the long part,
    // and a link put at a directory meanwhile is where the renames would land.
    for (const t of others) own(t.id, t, UNTOUCHED);
    // A removal has no temporary file beside it to hold it to the directory it
    // was planned in, so each one asks where that directory is now. A rename
    // asks too, and so refuses in a sentence where it would fail on an errno.
    const byDir = new Map(others.map((t) => [t.at, t]));
    const stillOwn = (path) => {
      const t = byDir.get(dirname(path));
      if (t) own(t.id, t, PUT_BACK);
    };
    // Each file by the repository's own spelling of where it is, for a refusal to name.
    const spelled = new Map([[rulesDir, RULES_DIR], [storeDir, STORE_DIR], ...others.map((t) => [t.at, t.dir])]);
    const said = (path) => `${spelled.get(dirname(path))}/${basename(path)}`;
    // Another tool's directory that nobody named, where a locked file costs that directory alone.
    const spared = (path) => {
      const t = byDir.get(dirname(path));
      return t !== undefined && !t.named ? t : null;
    };
    // The record once more, naming in each such directory the files it held and is about to hold again.
    const settle = (stopped) => {
      const kept = Object.fromEntries(Object.entries(names).map(([id, now]) => [id, stopped.has(id) ? plan.targets[id].was : now]));
      writePair(storeDir, factsJson(plan.result, kept), plan.result.layout);
    };
    const left = [];
    const stopped = replaceAll([...staged, ...theirs], removals, { record: factsPath, was: readLayout(root), leftover, left, spared, settle }, stillOwn, said);
    if (stopped.size === 0 && refused.size === 0 && left.length === 0) return plan;
    const leftIn = (dir) => left.filter((path) => dirname(path) === dir).map((path) => basename(path));
    const without = (names, gone) => names.filter((name) => !gone.includes(name));
    const unwritten = (remedy) => ([id, reason]) => [id, untouchedPlan({ target: TARGETS[id], state: "unknown", reason, remedy, on: false, unwritable: true }, plan.targets[id].was)];
    // A leftover that would not go is one more entry the directory holds that this scan neither wrote nor removed.
    const littered = others
      .filter((t) => !stopped.has(t.id) && leftIn(t.at).length > 0)
      .map((t) => [t.id, { ...plan.targets[t.id], remove: without(t.remove, leftIn(t.at)), foreign: [...t.foreign, ...leftIn(t.at)].sort() }]);
    const [inRules, inStore] = [leftIn(rulesDir), leftIn(storeDir)];
    return {
      ...plan,
      ...(inRules.length > 0 ? { staged: without(plan.staged, inRules), stagedLeft: inRules } : {}),
      ...(inStore.length > 0 ? { storeStaged: without(plan.storeStaged, inStore), storeStagedLeft: inStore } : {}),
      targets: { ...plan.targets, ...Object.fromEntries([...littered, ...[...refused].map(unwritten(PERMIT)), ...[...stopped].map(unwritten(UNLOCK))]) },
    };
  } catch (err) {
    for (const [tmp] of [...staged, ...theirs]) quietUnlink(tmp);
    // Deepest first, and only while empty: `rmdir` refuses anything else.
    for (const dir of made.reverse()) quietRmdir(dir);
    throw err;
  }
}

const UNTOUCHED = "stopped before writing anything there";
const PUT_BACK = "stopped and put back what it had replaced";

// What a rename or a removal answers where it is not allowed. On Windows: `EPERM` for a target held open or
// read-only, `EBUSY` for a sharing violation. Elsewhere: `EPERM` for an immutable file, `EACCES` for a directory
// that cannot be written.
const LOCKED = ["EPERM", "EACCES", "EBUSY"];

// `locked` carries the sentence's first half, for the rollback to say what it put back.
function lockedFile(err, at, verb) {
  if (!LOCKED.includes(err.code)) return err;
  return Object.assign(new Error(err.message, { cause: err }), { locked: `${at} could not be ${verb} (${err.code})` });
}

const UNLOCK = "close what holds it or change its mode";
const PERMIT = "fix its permissions";

/**
 * `writeTemp`, with a create the directory refuses said as what it is. `unstaged` carries the sentence's first half,
 * for a directory nobody named to be left with.
 */
function stage(path, body, dir) {
  try {
    return writeTemp(path, body);
  } catch (err) {
    if (!LOCKED.includes(err.code)) throw err;
    const unstaged = `a file could not be created in ${dir} (${err.code})`;
    throw Object.assign(new Error(`${unstaged}, so nothing was written: ${PERMIT} and scan again`, { cause: err }), { unstaged });
  }
}

const lockedSentence = (locked, did) => `${locked}, so the scan ${did}: the file is locked or read-only, so ${UNLOCK}, then scan again`;

// `moved` names the directory, for the rollback to say what it could not reach.
function movedAway(dir, did) {
  const sentence = `${dir} was replaced by something else while the map was being written, so the scan ${did}: look at what is at ${dir} now, then scan again`;
  return Object.assign(new Error(sentence), { moved: dir });
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
 * directory is no longer where the plan found it. A path in `pair.leftover` is
 * removed unread and never put back, and one whose removal fails goes on
 * `pair.left` and stops nothing.
 *
 * A rename in a directory the temporary file was just created in still fails:
 * Windows refuses one over a file another process holds open. `said` names a
 * path for the sentence that failure gets.
 *
 * Where `pair.spared` answers for the path with a target, that failure stops
 * the target's directory alone: `pair.settle` writes the record again to name
 * what that directory held, then what was replaced there is put back and
 * nothing more is done there. A
 * permission in a directory another tool owns may not stop Claude Code's map.
 * Answers the targets stopped that way, each with what stopped it.
 */
function replaceAll(staged, removals, pair, stillOwn, said) {
  // Read before the first rename, so the window between the facts and the last
  // file holds renames and nothing else.
  const kept = removals.filter((path) => !pair.leftover.has(path));
  const before = new Map([...staged.map(([, path]) => path), ...kept].map((p) => [p, previousBytes(p)]));
  const undo = [];
  const stopped = new Map();
  const past = (path) => stopped.has(pair.spared(path)?.id);
  // Put one directory back and go on without it, or throw for the whole scan to be put back.
  const stop = (err, path) => {
    const t = pair.spared(path);
    if (t === null || !err.locked) throw err;
    // The record first, so a process killed from here on leaves one that names the files the directory holds.
    try {
      pair.settle(new Set([...stopped.keys(), t.id]));
    } catch (failed) {
      throw lockedFile(failed, said(pair.record), "replaced");
    }
    for (let i = undo.length - 1; i >= 0; i--) {
      const [done, previous] = undo[i];
      if (pair.spared(done) !== t) continue;
      try {
        stillOwn(done);
        putBack(done, previous, null);
      } catch {
        // Not as it was, so not a directory to go on without.
        throw err;
      }
      undo.splice(i, 1);
    }
    for (const [tmp, to] of staged) if (pair.spared(to) === t) quietUnlink(tmp);
    stopped.set(t.id, err.locked);
  };
  try {
    for (const [tmp, path] of staged) {
      if (past(path)) continue;
      stillOwn(path);
      try {
        renameSync(tmp, path);
      } catch (err) {
        // A directory swapped since the look above fails here on an errno, so it is asked once more.
        stillOwn(path);
        stop(lockedFile(err, said(path), "replaced"), path);
        continue;
      }
      undo.push([path, before.get(path)]);
    }
    for (const path of removals) {
      if (past(path)) continue;
      stillOwn(path);
      try {
        unlinkSync(path);
      } catch (err) {
        if (err.code === "ENOENT") continue;
        // Litter, and never a reason to stop: one that will not go stays, and the scan says how many did.
        if (pair.leftover.has(path)) {
          pair.left.push(path);
          continue;
        }
        stop(lockedFile(err, said(path), "removed"), path);
        continue;
      }
      // A leftover has no bytes here, which the put-back reads as one to leave gone.
      undo.push([path, before.get(path)]);
    }
    return stopped;
  } catch (err) {
    let lost = 0;
    for (const [path, previous] of undo.reverse()) {
      try {
        // The layout file is stamped from the record alone, so only the
        // record's put-back writes it again. Nothing is put back through a
        // directory that stopped being the repository's own.
        stillOwn(path);
        putBack(path, previous, path === pair.record ? pair.was : null);
      } catch {
        lost++;
      }
    }
    // What this run had already put in a directory went with it when it moved.
    if (err.moved && lost > 0) err.message = movedAway(err.moved, `${PUT_BACK} everywhere else`).message;
    if (err.locked) err.message = lockedSentence(err.locked, lost > 0 ? "stopped part way" : PUT_BACK);
    throw err;
  }
}

// Whether a process is there to be signalled. One this user may not signal is there.
function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
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
