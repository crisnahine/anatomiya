/**
 * The machine record of every slot, and the one place its shape is known.
 *
 * The map is derivable from this file and the check reads it rather than the
 * rendered map, so writer and reader have to agree about the shape. They used to
 * agree by coincidence: the version lived in the writer, the rule for reading an
 * older record was copied into two modules, and the reader never looked at the
 * version at all.
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { resolveInside } from "./rules.mjs";

export const FACTS_PATH = ".claude/anatomiya/facts.json";

// 2 added the polarity fields. A reader of the older shape sees no `states` and
// falls back to `directive`, which is the claim side and is what every schema-1
// record meant. 3 replaced the single `glob` with the `globs` an area delivers
// on. 4 stores each of those in the two halves it is composed from, `dir` and
// `tail`, rather than joined: the join is a grammar, and a second reading of it
// is a second thing to keep in step. Nothing reads the globs back out of this
// record, so the older joined form needs no rule here. 5 adds `langFileCount`,
// the denominator the applicability gate divides by: it was computed, used to
// gate the claim, and dropped before the record was written, so the share that
// separates a narrow predicate from a rare construct could not be audited from
// disk. An older record carries no such field and reads as absent rather than
// as zero. A version this reader has not heard of is refused.
export const FACTS_SCHEMA = 5;

/**
 * Which of a dimension's two sentences an area is about, with the counts and
 * the exception list that belong to it.
 *
 * Here rather than in the renderer, because the renderer and the check must
 * never name different sides of the same dimension and only one of them is a
 * presentation decision. A suppressed dimension still picks a side, because
 * "2 of 61 sites" reads as a directory with no habit when it has a very strong
 * one that was merely too concentrated to state. An exact tie prefers the
 * claim, which keeps the choice a pure function of the counts (A5).
 *
 * A record written before the inverse existed carries no `states`, and
 * `undefined !== null` would mark every suppressed dimension as stated.
 */
export function statedSide(d) {
  const states = d.states ?? (d.directive ? "claim" : null);
  const counter =
    d.counterClaim && (states === "counter" || (states === null && d.candidates - d.conforming > d.conforming));
  return counter
    ? {
        states,
        side: "counter",
        claim: d.counterClaim,
        conforming: d.candidates - d.conforming,
        exceptions: d.counterExceptions || [],
        more: d.moreCounterExceptions || 0,
        gate: d.counterGate,
      }
    : {
        states,
        side: "claim",
        claim: d.claim,
        conforming: d.conforming,
        exceptions: d.exceptions || [],
        more: d.moreExceptions || 0,
        gate: d.gate,
      };
}

/**
 * The facts on disk, or why they could not be used.
 *
 * A version past this reader's is refused rather than read: fields move between
 * versions, and a record read against the wrong shape enforces a convention
 * nobody stated. Absent or malformed stays `null`, which is the ordinary case of
 * a repository nobody has scanned.
 */
export function readFacts(root) {
  // The same containment the write side carries. This record drives every
  // enforced claim, every area assignment and every severity in the check, so
  // reading it through a link out of the repository lets a directory the
  // repository does not own decide what the branch is judged against.
  const dir = resolveInside(root, dirname(FACTS_PATH));
  if (dir === null) {
    return {
      facts: null,
      unreadable: `${dirname(FACTS_PATH)} resolves outside the repository, so no map was read from it`,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(dir, basename(FACTS_PATH)), "utf8"));
  } catch {
    return { facts: null, unreadable: null };
  }
  if (!parsed || !Array.isArray(parsed.areas)) return { facts: null, unreadable: null };

  // Absent means 1: the version arrived with the second shape, and every record
  // without one is older than that.
  const schema = parsed.schema === undefined ? 1 : parsed.schema;
  // Anything that is not a whole version this build has heard of is refused
  // rather than read field by field. A record read against the wrong shape
  // enforces a convention nobody stated, and versioning it is what says the
  // reader never has to guess.
  if (!Number.isInteger(schema) || schema < 1 || schema > FACTS_SCHEMA) {
    return {
      facts: null,
      unreadable: `the map on disk is schema ${JSON.stringify(parsed.schema)} and this build reads 1 to ${FACTS_SCHEMA}, so nothing was enforced from it: scan again with this build`,
    };
  }
  return { facts: parsed, unreadable: null };
}

/**
 * Write to a temp path in the same directory, then rename, so a crash never
 * leaves half a file.
 *
 * Here because this module owns the store, and exported because the rendered map
 * and the pin are replaced under the same rule.
 *
 * The directory is the caller's to make. Doing it here cost one recursive
 * `mkdir` syscall per file on a caller writing a hundred of them into a
 * directory it had already created.
 */
export function atomic(path, body) {
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
 * The record, and the one definition of what a dimension looks like on disk.
 *
 * A schema bump is this module and its round trip, rather than an edit in every
 * reader with no way to tell which one was missed.
 */
export function writeFacts(root, result) {
  // Resolved rather than joined. `join` normalises `..` and follows no
  // link, so a tracked `.claude -> ../victim` put this record in a directory
  // the repository does not own, beside the map it is the record of.
  const dir = resolveInside(root, dirname(FACTS_PATH));
  if (dir === null) {
    throw new Error(`${dirname(FACTS_PATH)} resolves outside the repository, so the facts were not written`);
  }
  mkdirSync(dir, { recursive: true });
  atomic(join(dir, basename(FACTS_PATH)), JSON.stringify(factsRecord(result), null, 2) + "\n");
}

function factsRecord(result) {
  return {
    schema: FACTS_SCHEMA,
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
      dimensions: a.dimensions.map(dimensionRecord),
    })),
  };
}

function dimensionRecord(d) {
  return {
    key: d.key,
    precision: d.precision,
    applicability: d.applicability,
    // The denominator the applicability gate divided by: the files this
    // dimension could speak about, not every file in the area. Stored because a
    // narrow predicate and a rare construct produce the same small
    // `applicability`, and only the share separates them.
    langFileCount: d.langFileCount,
    candidates: d.candidates,
    conforming: d.conforming,
    authors: d.authors,
    // The bound and the bar are artifacts of our own confidence policy, so they
    // go to the machine record and never spend a line in a rendered file a
    // human audits by opening the sites it counts.
    authorsRequired: d.authorsRequired,
    ratio: rounded(d.ratio),
    bound: rounded(d.bound),
    directive: d.directive,
    gate: d.gate,
    exceptions: d.exceptions,
    // Polarity is the one thing the rendered file deliberately does not say, so
    // this record is the only place the check can learn which of the two
    // sentences an area was handed (C6).
    ...counterFacts(d),
    ...baselineFacts(d.baseline),
  };
}

const rounded = (n) => (Number.isFinite(n) ? Number(n.toFixed(4)) : 0);

/**
 * `states` is written for every dimension, because "not stated" and "stated on
 * the other side" are different facts and a missing field reads as the first.
 * The counter's own counts and sentence only exist for a dimension permitted
 * one, so a one-sided dimension costs nothing here.
 */
function counterFacts(d) {
  const out = { states: statedSide(d).states };
  if (typeof d.counterClaim !== "string") return out;
  return {
    ...out,
    counterClaim: d.counterClaim,
    counterRatio: rounded(d.counterRatio),
    counterBound: rounded(d.counterBound),
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
      // The check exempts a file the map already named. On the counter side
      // that list is the flipped one, and reusing the positive one exempts the
      // files that never broke the stated sentence.
      ...(base.counterExceptions ? { counterExceptions: base.counterExceptions } : {}),
    },
  };
}
