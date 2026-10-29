/**
 * How far a finding is trusted, which slot speaks for its path, and the one
 * shape every finding has (H24, H46, H62): the two ladders with their shared
 * rungs in one order, "counted in an area above" spelled once, and the finding
 * record with every field present. Read by the check's producers and by the
 * placement rule, and tested as a table without a repository.
 */
import { areaLabel, globsReach, underArea } from "./areas.mjs";
import { CHANGE_MOST } from "./cochange.mjs";
import { nameText, sanitisePath } from "./encode.mjs";
import { GATES, wilsonLower } from "./gates.mjs";
import { extOrName } from "./paths.mjs";
import { scopeOf, statedSide } from "./slot.mjs";

/** An area as the map names it, quoted where the map quotes it. */
export const areaName = (path) => areaLabel(path, (p) => nameText(sanitisePath(p)));

/** The nearest enclosing area that states this dimension, and where it was counted. */
function ancestorSlot(ancestorsOf, area, key) {
  for (const up of ancestorsOf(area)) {
    const d = (up.dimensions || []).find((x) => x.key === key);
    if (d && statedSide(d).states !== null) return { dim: d, from: up.path };
  }
  return null;
}

/**
 * Which slot speaks for a path on a row: the area's own, or the nearest
 * enclosing area's that states one, as `{ dim, from }`, `from` null for the
 * area's own and the enclosing area's path otherwise; null where no area was
 * measured or none states the row (H24). A slot the area does not hold is a
 * construct its baseline never saw, not a convention the map measured and said
 * nothing about, so the enclosing area that measured a population this
 * directory sits inside is the one to ask.
 */
export function slotFor(area, key, ancestorsOf) {
  const own = area && (area.dimensions || []).find((d) => d.key === key);
  if (own) return { dim: own, from: null };
  const up = area ? ancestorSlot(ancestorsOf, area, key) : null;
  return up ? { dim: up.dim, from: up.from } : null;
}

// A slot whose scope names the kinds it was counted over was never counted over
// a file of another kind, so it raises nothing there at any severity (C57).
export const outsideScope = (dim, path) => scopeOf(dim)?.includes(extOrName(path)) === false;

/** The verdict on a site whose claim was counted in an enclosing area: capped at FIX, since that area's file is not delivered here (H24). */
export const countedIn = (from) => ({ severity: "FIX", reason: `counted in ${areaName(from)}, which this directory sits inside` });

/**
 * The verdict on a site of a row: counted in an enclosing area at FIX, else the
 * ladder below, withheld from MUST-FIX where the area's own globs never
 * delivered the claim to this path (H46). No slot at all is the NIT the
 * ladder's first rung names.
 */
export function verdictFor(file, slot, { area, capped = null, dropped = false }) {
  if (slot?.from) return countedIn(slot.from);
  const away = slot !== null && area && !globsReach(area.globs, file.path);
  return cappedAway(severityFor(file, { dim: slot?.dim, capped, dropped }), away, area, file.path);
}

/** A verdict withheld from MUST-FIX where the area's own globs never delivered the claim to this path (H46). */
export const deliveredOr = (verdict, area, path) => cappedAway(verdict, area && !globsReach(area.globs, path), area, path);

/**
 * MUST-FIX withheld from a path the area's own globs never deliver to, and
 * every other verdict left alone. MUST-FIX means the map told this file's
 * author and they are the first to break it; here the map did not tell.
 */
function cappedAway(verdict, away, area, path) {
  if (!away || verdict.severity !== "MUST-FIX") return verdict;
  // Which of the two the globs missed, asked by moving the file's own name up
  // to the area's directory: reached there, the directory is what they do not
  // cover; missed there too, the name is. One sentence for both told a `.tsx`
  // sitting in the area's own directory that it sat inside that directory.
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (globsReach(area.globs, underArea(area.path, name))) return countedIn(area.path);
  const type = name.lastIndexOf(".") > 0 ? `${name.slice(name.lastIndexOf("."))} files` : name;
  return { severity: "FIX", reason: `the area file for ${areaName(area.path)} does not reach ${type}, so this claim was never delivered here` };
}

/**
 * A site's place on the ladder, from a site nothing was counted about up to a
 * site whose area's baseline was perfect. The rungs every producer shares,
 * the area file having no room and this run's own cap, sit above the counts.
 */
export function severityFor(file, { dim, capped = null, dropped = false }) {
  if (!dim) return { severity: "NIT", reason: "no convention counted here" };
  const side = statedSide(dim);
  if (side.states === null) {
    return { severity: "NIT", reason: `no convention stated here (${side.gate || dim.gate || "suppressed"})` };
  }
  // The gates stated it and the file had no room for its block, so the agent
  // got at most the sentence under the notice, with no counts to weigh it by.
  // MUST-FIX means the map told them and they are the first to break it. Same
  // ladder position staleness and a partial predicate already occupy.
  const rung = cappedRung({ dropped, capped });
  if (rung) return rung;
  if (dim.precision !== "precise") {
    return { severity: "FIX", reason: "partial predicate: some sites are not visible statically" };
  }
  if (isException(dim, side, file)) {
    return { severity: "FIX", reason: "the map already names this file as an exception" };
  }

  const base = baselineSide(dim, side);
  if (!base) return { severity: "FIX", reason: "no baseline population recorded" };
  // A claim the map stated on the rest of the repository's confidence rather
  // than on this area's own sample. It is a real claim and it is enforced, but
  // not at the severity that means "this branch is the first violation in this
  // area's history", which is a statement about this area's sample alone.
  if (side.borrowed) {
    return {
      severity: "FIX",
      reason: `${base.conforming} of ${base.candidates} baseline sites here, on a claim the rest of the repository carries`,
    };
  }
  // The same bound the scan states a directive on, or the check would enforce
  // at top severity a claim the scan considered too thin to make.
  if (wilsonLower(base.conforming, base.candidates) < GATES.minRatio) {
    return {
      severity: "FIX",
      reason: `${base.conforming} of ${base.candidates} baseline sites is thin`,
    };
  }
  if (base.conforming !== base.candidates) {
    return {
      severity: "FIX",
      reason: `${base.conforming} of ${base.candidates} baseline sites conform`,
    };
  }
  return {
    severity: "MUST-FIX",
    reason: `all ${base.candidates} baseline sites conform`,
  };
}

/**
 * A co-change claim's place on the ladder. MUST-FIX only off a pinned tip, since
 * off the base or HEAD the agent's own merged work is in the count it is graded
 * by, and only for a record no change the claim was counted over contradicts.
 * The shared rungs are asked in the ladder's order too: the area file's room
 * first, then this run's cap, with the size of the change between them.
 */
export function cochangeSeverity(claim, { from, area, dropped, capped, size }) {
  if (from !== "pin") return { severity: "FIX", reason: "no baseline population recorded" };
  if (area === null) return { severity: "FIX", reason: "no area file carries this claim" };
  const rung = cappedRung({ dropped });
  if (rung) return rung;
  if (size > CHANGE_MOST) {
    return { severity: "FIX", reason: `this branch touches ${size} files, more than any change this claim was counted over` };
  }
  const run = cappedRung({ capped });
  if (run) return run;
  // Spelled out rather than built, so the documents gate reads both reasons.
  if (claim.conforming !== claim.candidates) {
    return { severity: "FIX", reason: `${claim.conforming} of the last ${claim.candidates} changes that added one` };
  }
  return { severity: "MUST-FIX", reason: `all ${claim.candidates} of the last ${claim.candidates} changes that added one` };
}

/**
 * The rungs every finding shares above its own counts: the area file had no
 * room for its claim, or this run could not answer for its comparison.
 */
function cappedRung({ dropped = false, capped = null }) {
  if (dropped === "named") return { severity: "FIX", reason: "the area file names this claim without its counts" };
  if (dropped) return { severity: "FIX", reason: "the area file had no room to state this claim" };
  if (capped) return { severity: "FIX", reason: `capped by this run: ${capped}` };
  return null;
}

/**
 * The baseline counts for the side the map actually stated. Reading the stored
 * pair on a counter area would measure the sentence the agent was never given,
 * and an area at 1 of 200 would come back as the strongest possible evidence
 * for the claim it suppressed.
 */
function baselineSide(dim, side) {
  const base = dim.baseline;
  if (!base) return null;
  if (side.side !== "counter") return base;
  const candidates = base.candidates ?? 0;
  return {
    candidates,
    conforming: candidates - (base.conforming ?? 0),
    exceptions: base.counterExceptions || [],
  };
}

function isException(dim, side, file) {
  const base = dim.baseline;
  const fromBaseline = side.side === "counter" ? (base && base.counterExceptions) || [] : (base && base.exceptions) || [];
  const listed = [...(side.exceptions || []), ...fromBaseline];
  return listed.some((e) => e && (e.path === file.path || e.path === file.oldPath));
}

/**
 * The fields every finding carries, in the order the writers read them: a
 * producer that left one out handed a writer `undefined` where the record
 * promised null. `toldInClaim` and `turnsOn` ride on top where a producer has
 * them, and nothing else does.
 */
export const FINDING_FIELDS = ["severity", "reason", "path", "oldPath", "line", "area", "dimension", "claim", "precision", "where", "companion", "snippet"];

/** One finding, every field present and the optional ones null. */
export function findingOf({ severity, reason, path, oldPath = null, line, area = null, dimension, claim, toldInClaim, precision, where = null, companion = null, snippet = null, turnsOn, ...rest }) {
  for (const key of Object.keys(rest)) throw new TypeError(`a finding carries no ${key}`);
  // One order for every producer: `toldInClaim` beside the claim it speaks for, `turnsOn` last.
  return {
    severity,
    reason,
    path,
    oldPath,
    line,
    area,
    dimension,
    claim,
    ...(toldInClaim === undefined ? {} : { toldInClaim }),
    precision,
    where,
    companion,
    snippet,
    ...(turnsOn === undefined ? {} : { turnsOn }),
  };
}
