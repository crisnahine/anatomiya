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
// the files a dimension could speak about in this pass: it was computed, shaped
// the applicability gate, and was dropped before the record was written, so the
// share that separates a narrow predicate from a rare construct could not be
// audited from disk. This is the current pass's count, which is the one the
// stored `applicability` is also taken over, so the two divide. On a pinned
// repository the gate itself reads the baseline's. An older record carries no
// such field and reads as absent rather than as zero. 6 adds the three numbers
// the rendered map prints that the record could not reproduce: the count behind
// "and N more" on each side, and the namesake count an obligation renders. The
// bump is the point of versioning at all: two records both saying 5 with
// different shapes is the coincidence this module exists to replace. A version
// this reader has not heard of is refused. 7 is `langFileCount` again, with the
// same name and a narrower meaning: a file whose Flow types were blanked so it
// could be parsed is no longer counted in the denominator of the dimensions
// whose question is the annotation, because it holds no answer for them. A
// schema-6 record from a repository holding Flow divides a current
// `applicability` by an inflated count and reports a share nobody measured.
// 8 adds the semantic tier's own state: whether it ran, whether it ran
// degraded, and the share of type lookups that resolved. A record written
// without it is a scan that did not pass --deep, which is the default, so an
// absent key reads as "did not run" rather than as a missing field.
export const FACTS_SCHEMA = 8;

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
 * Why a parsed record cannot be read, or null.
 *
 * One copy of the rule, because every reader has to refuse the same shapes: a
 * record read against a schema it was not written for enforces a convention
 * nobody stated, which is the one failure the counted-claim model exists to
 * avoid. Absent means 1, since the version arrived with the second shape.
 */
export function schemaProblem(parsed) {
  if (!parsed || !Array.isArray(parsed.areas)) return { kind: "not-a-record", why: "it is not a facts record" };
  const schema = parsed.schema === undefined ? 1 : parsed.schema;
  if (!Number.isInteger(schema) || schema < 1 || schema > FACTS_SCHEMA) {
    return {
      kind: "unknown-schema",
      why: `it is schema ${JSON.stringify(parsed.schema)} and this build reads 1 to ${FACTS_SCHEMA}`,
    };
  }
  return null;
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
  // A shape that is not a record at all is the ordinary case of a repository
  // nobody has scanned; a version this build has not heard of is not, and says
  // so. Both decided by the one rule every reader shares.
  const problem = schemaProblem(parsed);
  if (problem?.kind === "not-a-record") return { facts: null, unreadable: null };
  if (problem) {
    return {
      facts: null,
      unreadable: `the map on disk could not be read because ${problem.why}, so nothing was enforced from it: scan again with this build`,
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
    // Absent on an older record and on every scan that did not pass --deep,
    // which is the default. Read back as "did not run" rather than as missing.
    semantic: result.semantic ?? { ran: false, status: null, reason: null, typedResolutionRate: null },
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
    // The files this dimension could speak about in this pass, not every file
    // in the area. Stored because a narrow predicate and a rare construct
    // produce the same small `applicability`, and only the share separates
    // them. The pair is this pass's throughout: the gate reads the baseline's
    // where there is one, and mixing the two would divide counts from one
    // population by a denominator from another.
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
    // The renderer prints three exceptions and then "and N more". Storing the
    // list without the count left a rendered line this record cannot produce,
    // and the map being derivable from here is why the check reads the record
    // rather than the map.
    moreExceptions: d.moreExceptions ?? 0,
    // Only an obligation has a companion, so an absent key is absent rather
    // than a namesake count of zero, which is a fact about a repository that
    // tests elsewhere (C7). Keyed on the count itself: the reducer sets it for
    // obligations and nothing else, and it does not copy `kind` onto a slot, so
    // asking for the kind here asks a question no scan answers.
    ...(d.companionsElsewhere === undefined ? {} : { companionsElsewhere: d.companionsElsewhere }),
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
    moreCounterExceptions: d.moreCounterExceptions ?? 0,
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
