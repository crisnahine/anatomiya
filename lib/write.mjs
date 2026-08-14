import { mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderArea, renderOverview, areaFilename, isOwned, PREFIX } from "./render.mjs";

const RULES = ".claude/rules";
const STORE = ".claude/anatomiya";

/** Write to a temp path in the same directory, then rename, so a crash never leaves half a file. */
function atomic(path, body) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, body);
  try {
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw err;
  }
}

/**
 * Write the map.
 *
 * The invariant: no rendered file exists that is not derivable from the facts
 * on disk. So facts are written first, rendering reads only what is on disk,
 * and orphans are removed last.
 */
export function writeMap(result, { dryRun = false } = {}) {
  const rulesDir = join(result.root, RULES);
  const storeDir = join(result.root, STORE);

  const withDirectives = result.areas.filter((a) => a.dimensions.length > 0);
  const uncovered = result.corpus.files - result.areas.reduce((s, a) => s + a.fileCount, 0);

  const planned = new Map();
  planned.set("anatomiya-overview.md", renderOverview(result, { uncovered }));
  for (const a of withDirectives) planned.set(areaFilename(a), renderArea(a));

  const existing = existsSync(rulesDir)
    ? readdirSync(rulesDir).filter((f) => f.startsWith(PREFIX) && f.endsWith(".md"))
    : [];

  // Removal needs all three: our prefix, our frontmatter key, and being absent
  // from this scan. A prefixed file we did not write is reported, not deleted.
  const stale = [];
  const foreign = [];
  for (const f of existing) {
    if (planned.has(f)) continue;
    const body = safeRead(join(rulesDir, f));
    (isOwned(body) ? stale : foreign).push(f);
  }

  // Any file in .claude/rules/ that is not ours at all still reaches the agent.
  // It is a repository directory, so a clone can ship one, and a rule file with
  // no `paths` key loads on every turn from the moment of clone.
  const unattributed = existsSync(rulesDir)
    ? readdirSync(rulesDir).filter((f) => f.endsWith(".md") && !f.startsWith(PREFIX))
    : [];

  const plan = {
    write: [...planned.keys()],
    remove: stale,
    foreign,
    unattributed,
    uncovered,
  };

  if (dryRun) return plan;

  mkdirSync(rulesDir, { recursive: true });
  mkdirSync(storeDir, { recursive: true });

  atomic(join(storeDir, "facts.json"), JSON.stringify(facts(result), null, 2) + "\n");
  for (const [name, body] of planned) atomic(join(rulesDir, name), body);
  for (const f of stale) {
    try {
      unlinkSync(join(rulesDir, f));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }

  return plan;
}

function facts(result) {
  return {
    // 2 adds the polarity fields. A reader of the older shape sees no `states`
    // and falls back to `directive`, which is the claim side and is what every
    // schema-1 record meant. 3 replaces the single `glob` with the `globs` an
    // area actually delivers on.
    schema: 3,
    root: result.root,
    scannedAt: result.scannedAt,
    corpus: result.corpus,
    parse: result.parse,
    suppressAll: result.suppressAll,
    areas: result.areas.map((a) => ({
      id: a.id,
      path: a.path,
      globs: a.globs,
      fileCount: a.fileCount,
      dimensions: a.dimensions.map((d) => ({
        key: d.key,
        precision: d.precision,
        applicability: d.applicability,
        candidates: d.candidates,
        conforming: d.conforming,
        authors: d.authors,
        // The bound and the bar are artifacts of our own confidence policy, so
        // they go to the machine record and never spend a line in a rendered
        // file a human audits by opening the sites it counts.
        authorsRequired: d.authorsRequired,
        ratio: Number.isFinite(d.ratio) ? Number(d.ratio.toFixed(4)) : 0,
        bound: Number.isFinite(d.bound) ? Number(d.bound.toFixed(4)) : 0,
        directive: d.directive,
        gate: d.gate,
        exceptions: d.exceptions,
        // Polarity is the one thing the rendered file deliberately does not
        // say, so this record is the only place the check can learn which of
        // the two sentences an area was handed (C6).
        ...counterFacts(d),
        ...baselineFacts(d.baseline),
      })),
    })),
  };
}

/**
 * `states` is written for every dimension, because "not stated" and "stated on
 * the other side" are different facts and a missing field reads as the first.
 * The counter's own counts and sentence only exist for a dimension permitted
 * one, so a one-sided dimension costs nothing here.
 */
function counterFacts(d) {
  const out = { states: d.states ?? (d.directive ? "claim" : null) };
  if (typeof d.counterClaim !== "string") return out;
  return {
    ...out,
    counterClaim: d.counterClaim,
    counterRatio: Number.isFinite(d.counterRatio) ? Number(d.counterRatio.toFixed(4)) : 0,
    counterBound: Number.isFinite(d.counterBound) ? Number(d.counterBound.toFixed(4)) : 0,
    counterGate: d.counterGate ?? null,
    counterExceptions: d.counterExceptions || [],
  };
}

/**
 * The check reads `dim.baseline` to decide MUST-FIX, so a dimension that lost
 * its baseline counts on the way to disk can never exceed FIX (D6). Absent from
 * the scan means absent from the facts: a zeroed stand-in would read as a
 * baseline that measured nothing conforming.
 */
function baselineFacts(base) {
  if (!base) return {};
  return {
    baseline: {
      candidates: base.candidates ?? 0,
      conforming: base.conforming ?? 0,
      exceptions: base.exceptions ?? [],
      ...(base.counterExceptions ? { counterExceptions: base.counterExceptions } : {}),
    },
  };
}

function safeRead(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

export const EXCLUDE_LINES = [
  `${RULES}/${PREFIX}*.md`,
  `${STORE}/`,
];
