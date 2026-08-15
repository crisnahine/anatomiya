import { mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { renderArea, renderOverview, splitUncovered } from "./render.mjs";
import { readFacts, writeFacts, atomic } from "./facts.mjs";
import {
  RULES_DIR,
  STORE_DIR,
  OVERVIEW_FILE,
  areaFilename,
  auditRules,
  isGeneratedName,
  knownNames,
  resolveInside,
  resolveRulesDir,
} from "./rules.mjs";

/**
 * Write the map.
 *
 * The invariant: no rendered file exists that is not derivable from the facts
 * on disk. So facts are written first, rendering reads only what is on disk,
 * and orphans are removed last.
 */
export function writeMap(result, { dryRun = false } = {}) {
  // Resolved, never joined. A tracked `.claude -> ../victim` survives a
  // clone, and `join` normalises `..` without following a link, so every write,
  // every removal and `facts.json` itself landed in a directory the repository
  // does not own. Fail closed: a map that cannot be written where it belongs is
  // not written anywhere.
  const rulesDir = resolveRulesDir(result.root);
  if (rulesDir === null) {
    throw new Error(
      `${RULES_DIR} resolves outside the repository, so nothing was written: this is a symlink in the working tree`
    );
  }
  const storeDir = resolveInside(result.root, STORE_DIR);
  if (storeDir === null) {
    throw new Error(
      `${STORE_DIR} resolves outside the repository, so nothing was written: this is a symlink in the working tree`
    );
  }

  const withDirectives = result.areas.filter((a) => a.dimensions.length > 0);
  const uncovered = result.corpus.files - result.areas.reduce((s, a) => s + a.fileCount, 0);
  // Of those, the ones discovery found nowhere to put. The remainder sit in an
  // area that was discovered and then dropped for counting nothing, which is a
  // parse failure or a language with no dimension, not a directory too small.
  const { orphaned } = splitUncovered(uncovered, result.corpus.orphaned ?? uncovered);

  // A run that read no file of a language cannot describe this repository, so it
  // does not write over a run that could. Every file of that language is charged
  // as a failure, every area it held counts nothing and would be removed as
  // gone, and the overview would be rewritten to claim zero areas beside area
  // files that still load. `env -i PATH=/usr/bin:/bin` on a Rails repository is
  // the whole of it: three correct area files deleted in the same run that
  // reports it could not read one.
  //
  // Nothing rather than a subset, which is what a truncated corpus already gets.
  // A repository holding none of a language is not blind to it, so an empty
  // corpus still writes and still cleans up.
  const unreadable = result.parse.unreadable || [];
  const blind = unreadable.length > 0;

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

  // The third fact ownership needs. Read before the new record replaces it,
  // and `null` when there is no record to read, which makes nothing removable.
  const audit = auditRules(result.root, knownNames(readFacts(result.root).facts));
  // A name we are about to write that is a directory, or a fifo, or anything
  // else `readdir` reports and `rename` refuses. `anatomiya-overview.md` is a
  // fixed name, so a repository can ship a directory called that and every scan
  // dies on EISDIR from inside the atomic replace.
  // Thrown before anything is rendered, and before a dry run answers: a dry run
  // reporting a clean plan for a write that cannot happen is the one answer
  // worse than the failure, and 151 area bodies rendered to be discarded is
  // work a repository should not be able to ask for.
  const occupied = [...planned].filter((name) => audit.occupied.includes(name));
  if (occupied.length) {
    throw new Error(
      `${join(RULES_DIR, occupied[0])} is not a file, so the map could not be written: remove it and scan again`
    );
  }

  // Ours, and this run is not rewriting it, so its area is gone or states
  // nothing now. Everything else in the directory is left where it is.
  const stale = blind ? [] : audit.ours.filter((f) => !planned.has(f));
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
    bodies.set(OVERVIEW_FILE, renderOverview(result, { uncovered, orphaned, others }));
    for (const a of withDirectives) bodies.set(areaFilename(a), renderArea(a));
  }

  const plan = {
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
  };

  if (dryRun) return plan;

  mkdirSync(rulesDir, { recursive: true });
  mkdirSync(storeDir, { recursive: true });

  // Facts too. Keeping the rendered files while replacing what they were
  // derived from breaks the invariant above, and `check` reads facts.json.
  if (!blind) writeFacts(result.root, result);
  for (const [name, body] of bodies) atomic(join(rulesDir, name), body);
  for (const f of stale) {
    try {
      unlinkSync(join(rulesDir, f));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }

  return plan;
}
