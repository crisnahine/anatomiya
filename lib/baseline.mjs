import {
  changedSinceWorktree, diffRange, filesAt, isSha, resolveBaseRef, shaReachable,
} from "./git.mjs";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

import { areaOwner, dirCount } from "./areas.mjs";
import { langsIn } from "./corpus.mjs";
import { language } from "./langs.mjs";
import { readAtRevision } from "./revision.mjs";
import { plural } from "./render-layout.mjs";
import { encodePath } from "./encode.mjs";
import { applyPairings } from "./pairing.mjs";
import { atomic } from "./facts.mjs";

export const PIN_PATH = ".claude/anatomiya/baseline.json";
export const PIN_SCHEMA = 1;

/**
 * The pin: which files each area held at the moment a human accepted it.
 *
 * The file list is the whole point (E1). A baseline recomputed by re-running
 * today's glob against the old commit re-selects only the files that are still
 * there, so moving the violating files into a new directory or a denied one
 * lifts the baseline ratio to 1.00 with every other guard still holding.
 *
 * It deliberately stores no counts. There is nothing to fall back to when the
 * sha goes unreachable, and stored counts are exactly the numbers this guard
 * exists to verify (E3).
 */
export function buildPin(areas, { sha, corpus = null }) {
  if (!isSha(sha)) throw new Error(`baseline sha is not a sha: ${sha}`);
  return {
    schema: PIN_SCHEMA,
    sha,
    // The corpus size the layout was resolved from. The area floor is a step
    // function of it, so without it one added file re-partitions the repository
    // and every area reads as a population change.
    ...(Number.isFinite(corpus) ? { corpus } : {}),
    areas: [...areas]
      .map((a) => ({ id: a.id, path: a.path, files: a.files.map((f) => f.rel).sort() }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export function loadPin(root) {
  const path = join(root, PIN_PATH);
  if (!existsSync(path)) return null;
  try {
    const pin = JSON.parse(readFileSync(path, "utf8"));
    if (!pin || pin.schema !== PIN_SCHEMA || !isSha(pin.sha) || !Array.isArray(pin.areas)) return null;
    // A half-shaped area is a pin that reads as a smaller population than the
    // one a human accepted, which is the direction that manufactures claims.
    // Refusing the whole file drops to counts-only instead.
    if (!pin.areas.every(isPinnedArea)) return null;
    return pin;
  } catch {
    return null;
  }
}

function isPinnedArea(a) {
  return !!a
    && typeof a.path === "string" && a.path.length > 0
    && Array.isArray(a.files) && a.files.every((f) => typeof f === "string" && f.length > 0);
}

export function writePin(root, pin) {
  const path = join(root, PIN_PATH);
  mkdirSync(dirname(path), { recursive: true });
  atomic(path, JSON.stringify(pin, null, 2) + "\n");
  return path;
}

/**
 * What a re-pin would accept.
 *
 * Re-pinning is a separate command and nothing in the scan path calls this or
 * points a human at it (E5). An earlier design suggested re-pinning exactly
 * when post-baseline sites outnumbered baseline sites, which is the moment the
 * agent's own output is largest and the suggestion launders it.
 */
export function pinDelta(oldPin, newPin) {
  const before = oldPin ? indexAreas(oldPin) : new Map();
  const after = indexAreas(newPin);

  const areas = [];
  for (const [path, next] of after) {
    const prev = before.get(path);
    const added = [...next.files].filter((f) => !prev || !prev.files.has(f)).sort();
    const removed = prev ? [...prev.files].filter((f) => !next.files.has(f)).sort() : [];
    if (!prev || added.length || removed.length) {
      areas.push({ path, added, removed, isNew: !prev });
    }
  }
  for (const [path, prev] of before) {
    if (!after.has(path)) areas.push({ path, added: [], removed: [...prev.files].sort(), gone: true });
  }

  areas.sort((a, b) => a.path.localeCompare(b.path));
  return {
    from: oldPin ? oldPin.sha : null,
    to: newPin.sha,
    areas,
    addedFiles: areas.reduce((s, a) => s + a.added.length, 0),
    removedFiles: areas.reduce((s, a) => s + a.removed.length, 0),
  };
}

/**
 * The delta a re-pin prints before it writes. Facts only, no recommendation.
 *
 * The paths come out of the pin file, so they are repository-controlled and go
 * through the encoder like every other such value (F4).
 */
export function formatDelta(delta) {
  const lines = [
    delta.from
      ? `baseline ${short(delta.from)} -> ${short(delta.to)}`
      : `baseline pinned at ${short(delta.to)}`,
    // Both verbs, not just the noun: the first pass at this fixed the count and
    // left "1 file enter ... 1 leave it" on the line a human reads before
    // accepting a population.
    `${plural(delta.addedFiles, "file")} ${delta.addedFiles === 1 ? "enters" : "enter"} the baseline population, ` +
      `${delta.removedFiles} ${delta.removedFiles === 1 ? "leaves" : "leave"} it`,
    "",
  ];
  for (const a of delta.areas) {
    const tag = a.isNew ? " (new area)" : a.gone ? " (area gone)" : "";
    lines.push(`${encodePath(a.path)}${tag}  +${a.added.length} -${a.removed.length}`);
    for (const f of a.removed.slice(0, 5)) lines.push(`  - ${encodePath(f)}`);
    if (a.removed.length > 5) lines.push(`  - and ${a.removed.length - 5} more`);
  }
  return lines.join("\n");
}

function short(sha) {
  return sha ? sha.slice(0, 8) : "none";
}

function indexAreas(pin) {
  const m = new Map();
  for (const a of pin.areas) m.set(a.path, { id: a.id, path: a.path, files: new Set(a.files) });
  return m;
}

/* --- what the scan asks for --- */

/**
 * The baseline, resolved once, with the pin read here rather than by the caller.
 *
 * One of the two entry points this module offers the scan. The other is
 * `measure`. Everything else here is the check's or this module's own, so the
 * order these must be called in stays inside the module rather than in a caller.
 *
 * `partitionSize` is the corpus size the pin was taken over. The area floor is a
 * step function of it, so a caller deriving it from today's file count
 * re-partitions the repository on one added file, and every area then reads as
 * a population change against a pin that knew the old partition.
 */


/**
 * One record per area, carrying everything a verdict reads: what the map should
 * report about the population, the shape the gates measure against, the counts
 * the dimension had at the pin, and what closes the area before any gate is
 * asked at all.
 *
 * One record shape, so a caller reads a verdict's inputs without knowing how a
 * population is matched, which files were materialised, or in what order any of
 * it has to happen.
 */
export async function measure(root, state, areas, { headParsed = null, parse, reduce }) {
  const populations = new Map();
  if (!state.countsOnly) {
    for (const area of areas) populations.set(area.id, baselinePopulation(state, area));
  }
  const measured = await countAtPin(root, state, areas, populations, { headParsed, parse, reduce });

  const out = new Map();
  for (const area of areas) {
    const population = populations.get(area.id) ?? null;
    const baseline = measured.get(area.id) ?? null;
    const counted = baseline !== null && baseline.gate === null;
    out.set(area.id, {
      population: population
        ? { status: population.status, files: population.files.length, missing: population.missing.length }
        : { status: state.status, files: 0, missing: 0 },
      pinned: counted ? pinnedShape(population) : null,
      dims: counted ? baseline.dims : [],
      gate: areaBlock(state, population, baseline),
    });
  }
  out.truncated = Boolean(measured.truncated);
  return out;
}

/**
 * The pinned population's shape, which is what every count gate reads (D6).
 * Today's shape includes whatever the agent under review just wrote, and a
 * directive derived from that is the agent quoting itself back.
 *
 * Called a shape rather than a scope: CONTEXT.md keeps that word off both an
 * area and a population deliberately.
 */
function pinnedShape(population) {
  return {
    fileCount: population.files.length,
    dirCount: dirCount(population.files.map((f) => f.rel)),
    // The pinned path to the name the file carries today, so a gate reading the
    // pinned file list can still ask who wrote what is on disk now (E7).
    toCurrent: new Map(population.files.map((f) => [f.rel, f.currentRel ?? f.rel])),
  };
}

/**
 * What closes a whole area before any gate is consulted.
 *
 * An unreachable pin drops the whole scan to counts (E3). No pin at all is a
 * repository nobody has accepted a baseline for yet: the gates read the current
 * population, and with no baseline recorded the check phase cannot raise any
 * finding above FIX.
 */
function areaBlock(state, population, baseline) {
  if (state.status === "unreachable") return "unreachable";
  if (state.countsOnly) return null;
  if (!population) return state.status;
  if (baseline && baseline.gate) return baseline.gate;
  return population.directive ? null : population.status;
}

/**
 * Everything the scan needs to know about the baseline, resolved once.
 *
 * `countsOnly` is the hard stop: no pin, or a pinned sha this repository can no
 * longer reach, and every directive drops to counts (E3).
 */
export async function resolve(root, { pin = loadPin(root), baseRef = null } = {}) {
  // A pin handed in directly has not been through `loadPin`, and an area list
  // this cannot index is not a smaller baseline, it is no baseline.
  if (!pin || !Array.isArray(pin.areas) || !pin.areas.every(isPinnedArea)) {
    return state({ status: "unpinned", countsOnly: true });
  }

  const reachable = await shaReachable(root, pin.sha);
  if (!reachable) {
    return state({
      status: "unreachable",
      sha: pin.sha,
      countsOnly: true,
      areas: indexAreas(pin),
      partitionSize: pin.corpus,
    });
  }

  const areas = indexAreas(pin);
  const base = await resolveBaseRef(root, baseRef);

  // Two ranges, because they answer different questions. The rename map runs to
  // HEAD: the scan reads the files at HEAD, so a directory renamed on this very
  // branch has to be followed or the area reads as greenfield (E7). Drift runs
  // to the base ref and never to HEAD (E6).
  const identity = await diffRange(root, pin.sha, "HEAD");
  const moved = base.ok ? await diffRange(root, pin.sha, base.sha) : null;

  return state({
    status: "ok",
    partitionSize: pin.corpus,
    sha: pin.sha,
    countsOnly: false,
    areas,
    baseRef: base.ok ? { ref: base.ref, sha: base.sha, forkPoint: base.forkPoint } : null,
    baseRefReason: base.ok ? null : base.reason,
    renames: identity ? identity.renames : new Map(),
    drift: moved ? driftIn(areas, moved.changed) : null,
  });
}

function state(o) {
  return {
    // The corpus size the pin was taken over. The area floor is a step function
    // of it, so a caller deriving it from today's file count re-partitions the
    // repository on one added file, and every area then reads as a population
    // change against a pin that knew the old partition.
    partitionSize: Number.isFinite(o.partitionSize) ? o.partitionSize : null,
    status: o.status,
    sha: o.sha ?? null,
    countsOnly: o.countsOnly,
    areas: o.areas ?? new Map(),
    baseRef: o.baseRef ?? null,
    baseRefReason: o.baseRefReason ?? null,
    renames: o.renames ?? new Map(),
    drift: o.drift ?? null,
  };
}

/**
 * Drift is files changed inside mapped areas over `<baseline>..<base-ref>`
 * (E6). Files outside every mapped area are not drift: nothing claims them.
 */
function driftIn(areas, changed) {
  const byArea = new Map();
  let total = 0;
  for (const path of changed) {
    const owner = areaOwner(path, areas.keys());
    if (owner === null) continue;
    byArea.set(owner, (byArea.get(owner) || 0) + 1);
    total++;
  }
  return { total, byArea };
}

/**
 * The baseline population for one current area, and whether it may state
 * anything at all.
 *
 * Current paths are mapped back through the rename map first (E7). A path is
 * the key and a path cannot tell a rename from a delete-plus-add, so without
 * that step a renamed directory finds nothing at the baseline sha and silently
 * loses every claim it had.
 *
 * Statuses that block a directive:
 *   postdates-baseline  nothing in this area existed at the pin (E4). Greenfield
 *                       directories are where agents write most, and there the
 *                       baseline would be the agent's own output at 100%.
 *   population-change   a pinned file is no longer in this area (E1). Reported,
 *                       and suppressed until a human re-pins.
 */
export function baselinePopulation(state, area) {
  if (state.countsOnly) {
    return { status: state.status, directive: false, areaPath: null, files: [], missing: [], added: [] };
  }

  const currentByBaselinePath = new Map();
  for (const f of area.files) {
    currentByBaselinePath.set(state.renames.get(f.rel) ?? f.rel, f.rel);
  }

  const matched = bestMatch(state.areas, currentByBaselinePath);
  if (!matched) {
    return {
      status: "postdates-baseline",
      directive: false,
      areaPath: null,
      files: [],
      missing: [],
      added: [...currentByBaselinePath.values()],
    };
  }

  const missing = [...matched.files].filter((p) => !currentByBaselinePath.has(p)).sort();
  const added = [...currentByBaselinePath]
    .filter(([baselinePath]) => !matched.files.has(baselinePath))
    .map(([, current]) => current)
    .sort();

  return {
    status: missing.length ? "population-change" : "ok",
    directive: missing.length === 0,
    areaPath: matched.path,
    // The pinned list, not today's glob. This is the whole guard.
    files: [...matched.files].sort().map((rel) => ({
      rel,
      currentRel: currentByBaselinePath.get(rel) ?? null,
      lang: language(rel),
    })),
    missing,
    added,
  };
}

/**
 * The pinned area a current area descends from, by shared files rather than by
 * path, so a renamed directory still finds itself. An area split across two
 * current areas matches the same pin twice and both report a population change,
 * which is the conservative answer.
 */
function bestMatch(areas, currentByBaselinePath) {
  let best = null;
  let bestHits = 0;
  for (const entry of areas.values()) {
    let hits = 0;
    for (const path of currentByBaselinePath.keys()) if (entry.files.has(path)) hits++;
    if (hits > bestHits) {
      best = entry;
      bestHits = hits;
    }
  }
  return bestHits > 0 ? best : null;
}

/**
 * The baseline counts per area, read from the pinned file list at the pinned
 * commit (E1, E2).
 *
 * The parser and the reducer are handed in rather than imported, because both
 * carry scan-wide settings this module has no business knowing: which
 * frameworks the corpus shows, and what the Ruby guards were overridden to.
 * That injection is also what makes the reuse rule testable without running the
 * whole pipeline over a real repository.
 *
 * One materialisation and one parser pool for the whole repository: an area at
 * a time would fork a pool per area, which is the cost the single-pass corpus
 * scan exists to avoid.
 */
async function countAtPin(root, state, areas, populations, { headParsed = null, parse, reduce }) {
  // Named here rather than as a TypeError from inside the loop, after the blob
  // directory has already been created.
  if (typeof parse !== "function" || typeof reduce !== "function") {
    throw new TypeError("measure needs a parse and a reduce function");
  }
  const out = new Map();
  let truncated = false;
  if (state.countsOnly) return out;

  const wanted = new Map();
  for (const area of areas) {
    const population = populations.get(area.id);
    if (!population || !population.directive) continue;
    for (const f of population.files) if (!wanted.has(f.rel)) wanted.set(f.rel, f);
  }
  if (wanted.size === 0) return out;

  const { parsed, stale } = reuseUnchanged(await changedSinceWorktree(root, state.sha), wanted, headParsed);

  let blobs = null;
  try {
    if (stale.length) {
      // A blob that will not come back is a population problem rather than a
      // parse problem, so `missing` suppresses the way a population change does.
      blobs = await readAtRevision(root, state.sha, stale);
      const reparsed = await parse(blobs.files);
      for (const [rel, r] of reparsed.records) parsed.set(rel, r);
      // The baseline is a second corpus read, and F7 is about corpus reads
      // rather than about the working tree: a Ruby bridge that hit its per-line
      // guard here answered for part of the population, and a ratio over an
      // arbitrary subset is what the whole-map suppression exists to refuse.
      truncated = truncated || Boolean(reparsed.truncated);
    }

    // Against the pinned file list, never the working tree's. A branch that
    // deletes a companion changes the answer without touching the producer, and
    // the producer's bytes being unchanged is exactly why its corpus record was
    // reused here.
    //
    // A listing git would not produce is not a commit with no files in it, and
    // read as one every producer in the baseline scores zero: the obligation
    // then reads as a repository that has never written a companion, over the
    // population every gate is measured against. No listing, no obligation.
    const pinnedFiles = await filesAt(root, state.sha);
    if (pinnedFiles) {
      applyPairings(parsed, pinnedFiles, langsIn(areas.flatMap((a) => a.files)));
    }

    for (const area of areas) {
      const population = populations.get(area.id);
      if (!population || !population.directive) continue;

      const usable = [];
      let unread = 0;
      for (const f of population.files) {
        const p = parsed.get(f.rel);
        if (p && p.ok && p.hits) {
          usable.push(p);
          continue;
        }
        // The pinned blob could not be read. That closes the area unless the
        // file cannot be read today either, in which case it is a blind spot
        // this tool has always had rather than something the pin lost. React is
        // written in Flow, which oxc does not take: 287 of its files never
        // parse at the pin or today, and charging that as a change closed 507
        // of its 986 slots. A file that has become readable since the pin still
        // closes it, because the baseline is then missing sites today can see.
        // Only when the blob itself came back and the parser answered on it.
        // A blob nobody fetched was not read and rejected, it was never read:
        // `showBlob` refuses a file over the same cap the parser skips at, so
        // an oversize pinned file is missing here and skipped at HEAD, and
        // reading that pair as a blind spot let the area state a directive with
        // one file counted at neither revision and nothing saying so.
        const current = headParsed?.get(f.currentRel ?? f.rel) ?? null;
        if (p && current && current.ok !== true) continue;
        unread++;
      }

      // A baseline file that would not come back, or that this tool cannot read
      // at the pin though it can read it today, hides sites the other side can
      // see, and the sites it hides are the violating ones as often as the
      // conforming ones. That is a population this cannot count, handled like
      // any other population change: report and suppress.
      out.set(
        area.id,
        unread ? { gate: "population-change", dims: [] } : { gate: null, dims: reduce(area, usable) }
      );
    }
  } finally {
    blobs?.dispose();
  }
  out.truncated = truncated;
  return out;
}

/**
 * Split the baseline population into what the corpus pass already answered and
 * what still has to be read out of the pinned commit.
 *
 * A file absent from `changed` has the same bytes in the working tree as at the
 * pinned sha, so the corpus already parsed exactly the content the baseline
 * asks about. Re-reading it costs one `git cat-file` process per file: measured
 * at 6.9s against 1.4s to parse the whole corpus, on a repository where nothing
 * had changed.
 *
 * Reuse needs three things to hold, and anything short of all three
 * materialises instead: git answered at all, the path is not in the changed
 * set, and the path is the same on both sides, since a rename makes the corpus
 * entry a different file's parse.
 */
function reuseUnchanged(changed, wanted, headParsed) {
  const parsed = new Map();
  const stale = [];

  for (const f of wanted.values()) {
    const same = changed && !changed.has(f.rel) && (f.currentRel ?? f.rel) === f.rel;
    const hit = same && headParsed ? headParsed.get(f.rel) : null;
    if (hit && hit.ok) parsed.set(f.rel, hit);
    else stale.push(f);
  }

  return { parsed, stale };
}
