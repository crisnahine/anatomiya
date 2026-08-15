import { dimensionsFor } from "./dimensions.mjs";
import { pairingsFor } from "./pairing.mjs";
import { dirCount } from "./areas.mjs";

export const GATES = {
  minRatio: 0.9,
  z: 1.96,                // Wilson 95%; a perfect record needs 35 sites to hold 0.90
  authorEvidence: 2,      // two pairs of hands is the whole claim a per-file author count carries
  minEffectiveFiles: 3,   // how many files the evidence is worth, not how many carry it
  minApplicabilityShare: 0.25, // the floor that holds on a large area, where a root does not
};

/**
 * Wilson score lower bound.
 *
 * The gate asks whether the true conformance rate can be trusted at
 * `minRatio`, not whether this sample happened to reach it: 6 of 6 is a point
 * ratio of 1.00 whose true rate could plausibly be 0.61.
 */
export function wilsonLower(conforming, candidates, z = GATES.z) {
  const n = candidates;
  // Zero conforming is exactly zero: the general form leaves 2e-17 there, which
  // would put the bound a hair above the ratio it must never exceed.
  if (!(n > 0) || !(conforming > 0)) return 0;
  const p = Math.min(1, conforming / n); // a corrupt count would make the variance term negative
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return (centre - margin) / (1 + z2 / n);
}

/**
 * How many distinct authors this repository can be asked for.
 *
 * One author is not a thin team, it is the whole team, and there is no second
 * opinion being withheld. No repository size raises the bar: demanding three on
 * a measured 13-author repository blocks 16 of the 114 directories that clear
 * two, and every one of them has two or three authors.
 */
export function authorsRequired(repoAuthors) {
  if (!Number.isFinite(repoAuthors)) return GATES.authorEvidence;
  return Math.max(1, Math.min(GATES.authorEvidence, Math.floor(repoAuthors)));
}

/**
 * Fold parsed files into per-area, per-dimension counts.
 *
 * Every count is per site, never per file. `applicability` is carried
 * separately and rendered, because a wrongly narrow predicate produces a ratio
 * of 1.0 over a small candidate set and reads as a strong convention; the only
 * thing a human can audit that with is seeing applicability beside the area's
 * file count.
 */
export function reduceArea(area, parsed, { frameworks } = {}) {
  // Pairings are composed in here rather than in `dimensionsFor`, because that
  // list is what the parse worker runs and a pairing has no program to run
  // against. Both kinds produce the same hit shape, so the fold below is blind
  // to the difference.
  const dims = [...dimensionsFor(area.langs, { frameworks }), ...pairingsFor(area.langs)];
  const langByRel = new Map((area.files || []).map((f) => [f.rel, f.lang]));
  const out = [];

  // The files something was actually read from. `applicability` counts files
  // that produced a site, and only an examined file can produce one, so a
  // denominator over every file of the language divides one population by
  // another: on react, 55 of 122 areas hold a file the parser rejected and one
  // holds nothing else, and the gate reads the predicate as narrow because the
  // repository is written in a syntax this tool does not take. An obligation is
  // answered by the corpus rather than by a tree, so it speaks for a file
  // whether or not the file parsed.
  const examined = new Set(parsed.filter((f) => f.ok).map((f) => f.rel));

  for (const dim of dims) {
    const perFile = new Map();
    // A mixed area holds files of both engines. A Ruby dimension counted
    // against the area's JS files reads as a narrow predicate and is suppressed
    // by the applicability gate, so the denominator is the files the dimension
    // could speak about at all, not every file in the area.
    let langFileCount = 0;
    for (const [rel, lang] of langByRel) {
      if (!dim.langs.includes(lang)) continue;
      if (dim.kind !== "pairing" && !examined.has(rel)) continue;
      langFileCount++;
    }

    for (const file of parsed) {
      if (!file.ok || !file.hits) continue;
      const lang = langByRel.get(file.rel);
      if (lang !== undefined && !dim.langs.includes(lang)) continue;
      // Counted where the file was parsed, so no tree crosses a process
      // boundary to be walked again on this one core. A dimension that threw
      // there dropped its own key for this file and left the rest standing.
      const hits = file.hits[dim.key];
      if (!hits || hits.length === 0) continue; // not applicable: the construct never appears
      perFile.set(file.rel, hits);
    }

    if (perFile.size === 0) continue;

    let candidates = 0;
    let conforming = 0;
    let elsewhere = 0;
    const exceptions = [];
    // Only a dimension permitted to state its inverse carries the flipped list,
    // so a one-sided one costs no extra bytes on disk.
    const counterExceptions = dim.counterClaim ? [] : null;

    for (const [rel, hits] of perFile) {
      candidates += hits.length;
      const bad = hits.filter((h) => !h.conforming);
      conforming += hits.length - bad.length;
      elsewhere += hits.filter((h) => h.elsewhere).length;
      if (bad.length) exceptions.push({ path: rel, count: bad.length });
      if (counterExceptions && bad.length < hits.length) {
        counterExceptions.push({ path: rel, count: hits.length - bad.length });
      }
    }

    out.push({
      key: dim.key,
      claim: dim.claim,
      precision: dim.precision,
      // Only an obligation carries a companion side. An absent key is absent
      // rather than zero, so nothing renders the line for a syntax dimension.
      ...(dim.kind === "pairing" ? { companionsElsewhere: elsewhere } : {}),
      applicability: perFile.size,
      langFileCount,
      candidates,
      conforming,
      files: [...perFile.keys()],
      ...spread(perFile, candidates),
      // The path breaks ties, so the three that print do not depend on
      // filesystem order between two scans of unchanged source (A5).
      exceptions: exceptions.sort(byCountThenPath).slice(0, 3),
      moreExceptions: Math.max(0, exceptions.length - 3),
      ...(counterExceptions
        ? {
            counterClaim: dim.counterClaim,
            counterExceptions: counterExceptions.sort(byCountThenPath).slice(0, 3),
            moreCounterExceptions: Math.max(0, counterExceptions.length - 3),
          }
        : {}),
    });
  }

  return out;
}

function byCountThenPath(a, b) {
  if (b.count !== a.count) return b.count - a.count;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/**
 * How the sites are spread over the files carrying them: the inverse-Simpson
 * count of how many files the evidence is worth, and the largest file's own
 * counts so a gate can ask what the area looks like without it.
 *
 * A share of the candidates cannot answer either question. At two files the
 * largest share is at least 0.5 by arithmetic, and at fifty files no share ever
 * fires however lopsided the distribution is.
 */
function spread(perFile, candidates) {
  let sumSq = 0;
  let top = { candidates: 0, conforming: 0 };
  for (const hits of perFile.values()) {
    sumSq += (hits.length / candidates) ** 2;
    if (hits.length > top.candidates) {
      top = { candidates: hits.length, conforming: hits.filter((h) => h.conforming).length };
    }
  }
  return { effectiveFiles: candidates && sumSq ? 1 / sumSq : 0, top };
}

/**
 * Decide whether a dimension may state a directive, and record which gate
 * stopped it when it may not. Counts print either way, so a suppressed
 * dimension costs one sentence rather than a wrong convention.
 *
 * Every count gate reads the baseline population when the caller supplies one,
 * because the current population includes whatever the agent under review just
 * wrote, and a directive derived from that is the agent quoting itself back
 * (D6). The current counts still print; they never gate. A baseline carrying
 * only the two counts leaves the population-shaped fields to the current pass,
 * which is the closest honest answer available.
 *
 * `repoAuthors` is the one input read at HEAD rather than at the pin: it
 * answers whether this repository has more than one person in it now, which is
 * a fact about the repository the map is read in.
 */
export function applyGates(dim, {
  authors,
  repoAuthors,
  historyRead = true,
  areaFileCount,
  areaDirCount,
  baseline = dim.baseline ?? null,
} = {}) {
  const pop = baseline ?? dim;
  const candidates = pop.candidates ?? 0;
  const conforming = pop.conforming ?? 0;
  const applicability = pop.applicability ?? dim.applicability ?? 0;
  const effectiveFiles = pop.effectiveFiles ?? dim.effectiveFiles ?? 0;
  const top = pop.top ?? dim.top ?? { candidates: 0, conforming: 0 };
  const files = pop.files ?? dim.files;

  const denominator = dim.langFileCount || areaFileCount || 0;
  // The stricter of two floors, because each is wrong alone. The root grows
  // slower than the area and asks for more than a quarter share below sixteen
  // files, where a quarter of a small directory is one or two files. The share
  // holds above it: on its own the root asked 11 files of 120, and a measured
  // 120-file area where 11 files used `?.` and 109 read absent values without
  // it stated "optional values are read with ?." over all 120. A claim the
  // agent then obeys, on 9% of the directory.
  const minApplicable = Math.max(
    Math.ceil(Math.sqrt(denominator)),
    Math.ceil(GATES.minApplicabilityShare * denominator)
  );
  const looCandidates = candidates - (top.candidates || 0);
  const dimDirs = distinctDirs(files);
  const required = historyRead ? authorsRequired(repoAuthors) : null;

  // The same battery, run once per side. Only the numerator moves: how many
  // files the sites are spread over, how much of the area the construct
  // reaches and who wrote it are facts about where the sites are, not about
  // which way they point.
  const judge = (k, topK) => {
    const ratio = candidates ? k / candidates : 0;
    const bound = wilsonLower(k, candidates);
    const looRatio = looCandidates > 0 ? (k - topK) / looCandidates : 0;

    const checks = [
      ["ratio", ratio >= GATES.minRatio],
      // The bound dominates the ratio arithmetically, so it is never the deciding
      // pass. It is kept as its own check because the two failures mean opposite
      // things: "this repository is inconsistent" against "this repository is
      // consistent and there is not enough of it here to be sure".
      ["evidence", bound >= GATES.minRatio],
      // One file supplying most of the sites is one file's habit, and the second
      // clause is what sees a large file holding the rest of the area over 0.90.
      ["concentration", effectiveFiles >= GATES.minEffectiveFiles && looRatio >= GATES.minRatio],
      ["applicability", denominator > 0 && applicability >= minApplicable],
      // `historyRead &&` is load-bearing: git failing is a third state, and
      // `0 >= null` is true.
      [historyRead ? "authors" : "history-unread", historyRead && authors >= required],
      // The directory gate is skipped where it cannot be satisfied. Applied
      // unconditionally it blocked 124 of 170 measured slots, because area
      // discovery finds leaf directories and a leaf directory holds one.
      ["directories", areaDirCount > 1 ? dimDirs >= 2 : true],
    ];

    const failed = checks.find(([, ok]) => !ok);
    return { ratio, bound, gate: failed ? failed[0] : null };
  };

  const claim = judge(conforming, top.conforming || 0);
  // The leave-one-out reuses the file with the most candidates rather than the
  // most counter sites. The counter only reaches this gate at 0.90, so no other
  // file's counter sites can exceed that file's by more than a tenth of the
  // sample, which cannot move the ratio across 0.90 outside that band.
  const counter = judge(
    candidates - conforming,
    (top.candidates || 0) - (top.conforming || 0)
  );
  // The hand-written sentence is the whole permission. A dimension whose
  // inverse would be a defect never gets one, so it never gets a second side.
  const twoSided = typeof dim.counterClaim === "string";
  const states = !claim.gate ? "claim" : twoSided && !counter.gate ? "counter" : null;

  return {
    ratio: claim.ratio,
    bound: claim.bound,
    counterRatio: counter.ratio,
    counterBound: counter.bound,
    dirs: dimDirs,
    authorsRequired: required,
    states,
    // Still the claim side alone. Widening it to "states something" would make
    // every consumer that was not updated enforce a counter as the positive,
    // which is the failure the permission exists to prevent.
    directive: states === "claim",
    gate: claim.gate,
    counterGate: twoSided ? counter.gate : "one-sided",
  };
}

/**
 * What closes one slot: the area's own block, or a dimension whose sites all
 * postdate the pin (E4). A ratio over zero baseline sites is the agent's own
 * output measured against itself.
 *
 * Exported for the tests, which is what lets every gate-and-population
 * interaction be asked of a function rather than of a repository.
 *
 * `measured` is the per-area record `baseline.measure` returns, never the
 * population inside it. The two are different objects and one is a field of the
 * other, so the shape is checked: read the wrong one and every field this looks
 * at is absent, which reads as "nothing blocks" and states a directive from a
 * population nobody accepted.
 */
export function blockedFor(measured, baselineDim) {
  if (!measured || !("gate" in measured) || !("pinned" in measured)) {
    throw new TypeError("blockedFor needs the record baseline.measure returns: { gate, pinned, dims }");
  }
  if (measured.gate) return measured.gate;
  // No pinned shape means no baseline population to postdate, which is the
  // counts-only repository rather than a greenfield directory.
  if (!measured.pinned) return null;
  return baselineDim && baselineDim.candidates ? null : "postdates-baseline";
}

/**
 * One slot's whole verdict: which population the gates read, what they said,
 * and whether a condition outside the gates stops it speaking at all.
 *
 * The ordering is the point, and it is written once here: a corpus answered for
 * in part outranks everything, then a population nobody accepted closes the
 * slot and closes both of its sides, and only then are the gates asked. Split
 * across modules, only a whole repository could reach the assembly.
 *
 * `measured` is the record `baseline.measure` returns for this slot's area.
 * Absent, nothing outside the gates has an opinion. It is not the population
 * itself: that is one of its fields, and reading the wrong one would ask the
 * counts a question only the pin can answer.
 */
export function verdictFor(
  dim,
  { baselineDim = null, measured = null, truncated = false, current, authors, repoAuthors, historyRead = true } = {}
) {
  if (!current) throw new TypeError("verdictFor needs this pass's shape: { fileCount, dirCount }");
  // The pinned shape where the dimension had a baseline, today's where it did
  // not (D6). Today's includes whatever the agent under review just wrote, so a
  // caller choosing between them is a caller that can choose wrong.
  const shape = baselineDim && measured ? measured.pinned : current;
  // A capped corpus answered for part of the repository, and a ratio over an
  // arbitrary subset rendered as a convention is worse than counts (F7).
  // Decided here rather than at render time, so the facts store and the
  // rendered map agree on what was stated.
  const blocked = truncated ? "corpus-truncated" : measured ? blockedFor(measured, baselineDim) : null;
  // Every gate reads the baseline population where there is one (D6). Today's
  // counts print beside it and decide nothing, or an agent that adds conforming
  // sites raises the bar it is judged against.
  const source = baselineDim || dim;
  const g = applyGates(source, {
    authors,
    repoAuthors,
    historyRead,
    areaFileCount: shape.fileCount,
    areaDirCount: shape.dirCount,
  });

  return {
    ...dim,
    ...g,
    // Blocking has to close both sides. Forcing `directive` alone leaves a
    // greenfield or unreachable-baseline area stating its inverse, which is the
    // same directive from a population nobody accepted (D6, E3, E4).
    states: blocked ? null : g.states,
    directive: blocked ? false : g.directive,
    gate: blocked || g.gate,
    counterGate: blocked || g.counterGate,
    authors,
    baseline: baselineDim
      ? {
          candidates: baselineDim.candidates,
          conforming: baselineDim.conforming,
          exceptions: baselineDim.exceptions,
          // The check exempts a file the map already named. On the counter side
          // that list is the flipped one, and reusing the positive one exempts
          // the files that never broke the stated sentence.
          ...(baselineDim.counterExceptions ? { counterExceptions: baselineDim.counterExceptions } : {}),
        }
      : null,
  };
}

function distinctDirs(files = []) {
  // A baseline population lists files as records, the current pass as paths.
  // Normalised here and counted by the one counter, because `applyGates`
  // compares this number against the area's own and two spellings of "how many
  // directories" is two chances for the comparison to be against a different
  // question.
  const paths = files.map((f) => (typeof f === "string" ? f : f && f.rel)).filter((r) => typeof r === "string");
  return dirCount(paths);
}
