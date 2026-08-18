import { dimensionsFor } from "./dimensions.mjs";
import { pairingsFor } from "./pairing.mjs";
import { claimFor } from "./dimensions-naming.mjs";
import { rowsOfKind } from "./registry.mjs";
import { dirCount } from "./areas.mjs";
import { language } from "./langs.mjs";
import { defaultSideFor, defaultClassFor } from "./model-defaults.mjs";

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
 * Whether anything was read from this file.
 *
 * One predicate, because the denominator and the fold ask the same question and
 * had drifted to two spellings of it.
 */
const wasRead = (file) => file.ok === true;

/**
 * Fold parsed files into per-area, per-dimension counts.
 *
 * Every count is per site, never per file. `applicability` is carried
 * separately and rendered, because a wrongly narrow predicate produces a ratio
 * of 1.0 over a small candidate set and reads as a strong convention; the only
 * thing a human can audit that with is seeing applicability beside the files
 * the dimension could have spoken about, which is what the gate divides by.
 */
export function reduceArea(area, parsed, { frameworks, tier = "syntactic", capabilities } = {}) {
  // Pairings are composed in here rather than in `dimensionsFor`, because that
  // list is what the parse worker runs and a pairing has no program to run
  // against. Both kinds produce the same hit shape, so the fold is blind to the
  // difference; only the companion count asks which kind this is.
  const dims = [
    ...dimensionsFor(area.langs, { frameworks, tier, capabilities }),
    ...pairingsFor(area.langs),
    // Corpus rows ask about filenames, so they have no program to run against
    // and no worker hit to read; the fold builds their sites itself below.
    ...rowsOfKind("corpus").filter((d) => d.langs.some((l) => area.langs.includes(l))),
  ];
  const langByRel = new Map((area.files || []).map((f) => [f.rel, f.lang]));
  const out = [];

  // The files something was actually read from, taken off the records handed in
  // rather than off the area's file list.
  //
  // Two reasons, and the second is the one that bites. `applicability` counts
  // files that produced a site and only an examined file can produce one, so a
  // denominator over every file of the language divides one population by
  // another: react is written in Flow, 55 of its 122 areas hold a file the
  // parser rejected, and the gate read the predicate as narrow because the
  // repository is written in a syntax this tool does not take.
  //
  // And the baseline pass hands in records keyed by the PINNED paths against an
  // area holding today's, so reading the denominator off `area.files` drops
  // every file renamed since the pin. Measured: twelve renames with no content
  // change took a slot from suppressed to stated, which is the laundering the
  // pinned population exists to refuse. Counting the records makes
  // `applicability <= langFileCount` hold by construction in both passes.
  //
  // An obligation is counted the same way. `applyPairings` skips a record that
  // is not ok, so an unread producer answers nothing and is not a file the
  // obligation could speak about either.
  const examined = [];
  for (const file of parsed) {
    if (!wasRead(file)) continue;
    examined.push({ lang: langByRel.get(file.rel) ?? language(file.rel), stripped: file.stripped === true });
  }

  for (const dim of dims) {
    const perFile = new Map();
    // A mixed area holds files of both engines. A Ruby dimension counted
    // against the area's JS files reads as a narrow predicate and is suppressed
    // by the applicability gate, so the denominator is the files the dimension
    // could speak about at all, not every file in the area.
    let langFileCount = 0;
    for (const e of examined) {
      if (!dim.langs.includes(e.lang)) continue;
      // A file whose Flow annotations were blanked so it could be parsed at all
      // holds no answer for a dimension whose question is the annotation. It is
      // not a file that declined the convention, and counting it as one renders
      // "10 of 10 sites across 10 of 20 files" over a directory where the other
      // ten were never asked.
      if (e.stripped && dim.blindWhenStripped) continue;
      langFileCount++;
    }

    for (const file of parsed) {
      if (!wasRead(file)) continue;
      if (dim.kind === "corpus") {
        const lang = langByRel.get(file.rel) ?? language(file.rel);
        if (!dim.langs.includes(lang)) continue;
        const cls = dim.classify(file.rel);
        if (cls !== null) perFile.set(file.rel, [{ conforming: false, class: cls }]);
        continue;
      }
      if (!file.hits) continue;
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

    // A learned-class dimension settles its side here: the plurality class is
    // the sentence, conforming follows it, and a tie is no slot at all.
    let learned;
    if (dim.learnedClasses) {
      const grouped = dim.groupedSites === true;
      learned = learnClass(perFile, { grouped });
      if (learned === null) continue;
      // New arrays, never mutation: the baseline map and the corpus map hold
      // the same record object for every file unchanged since the pin.
      for (const [rel, hits] of perFile) {
        perFile.set(
          rel,
          grouped ? groupSites(hits, learned) : hits.map((h) => ({ ...h, conforming: h.class === learned }))
        );
      }
    }

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
      // Which tier answered it. Carried because the verdict needs it: a tier
      // that ran badly closes its own rows and must not touch the rest.
      tier: dim.tier,
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
      // The learned class rewrites the sentence: the row's claim is a template
      // and the record carries the one this area actually measured.
      ...(learned === undefined ? {} : { learned, claim: claimFor(dim, learned) }),
    });
  }

  return out;
}

/**
 * Which body a hit belongs to, keyed against `n` keys already handed out.
 *
 * A hit carrying no group is its own site, which is what a row that does not
 * group already is. The two key shapes cannot collide, so `#n` is free when it
 * is asked for. Three callers pass `n`: `groupSites` and the check pass the
 * map's own size, and `learnClass` passes a counter of the class-carrying hits
 * it has already keyed in this file.
 */
export const groupKey = (hit, n) =>
  hit.group === undefined || hit.group === null ? `#${n}` : `g${hit.group}`;

/**
 * One site per enclosing body, conforming when any of the body's hits names the
 * learned class.
 *
 * A Rails worker includes `Sidekiq::Worker` and one more module, so counted per
 * constant the row cannot pass 0.5 whatever the directory does, and it fails
 * closed on the directories it was written for.
 */
function groupSites(hits, learned) {
  const byGroup = new Map();
  for (const h of hits) {
    const key = groupKey(h, byGroup.size);
    const at = byGroup.get(key);
    if (at) at.conforming = at.conforming || h.class === learned;
    else byGroup.set(key, { ...h, conforming: h.class === learned });
  }
  return [...byGroup.values()];
}

/**
 * The plurality class over every voting site, or null on a tie.
 *
 * A tie is a directory that has not said anything, the same posture as a
 * companion-root tie: deciding it would decide a convention by iteration order.
 *
 * A grouped row votes once per body and class, so a class including A and B
 * votes for each once and a body including A twice still votes for A once.
 */
export function learnClass(perFile, { grouped = false } = {}) {
  const votes = new Map();
  for (const hits of perFile.values()) {
    const seen = grouped ? new Set() : null;
    let n = 0;
    for (const h of hits) {
      if (!h.class) continue;
      if (seen) {
        const key = `${groupKey(h, n++)} ${h.class}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      votes.set(h.class, (votes.get(h.class) || 0) + 1);
    }
  }
  const ranked = [...votes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null;
  return ranked[0][0];
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
export function blockedFor(measured, baselineDim, dim = null) {
  if (!measured || !("gate" in measured) || !("pinned" in measured)) {
    throw new TypeError("blockedFor needs the record baseline.measure returns: { gate, pinned, dims }");
  }
  if (measured.gate) return measured.gate;
  // No pinned shape means no baseline population to postdate, which is the
  // counts-only repository rather than a greenfield directory.
  if (!measured.pinned) return null;
  if (baselineDim && baselineDim.candidates) return null;
  // A semantic row never has a baseline: the checker does not run over the
  // pinned blobs and `pin --deep` is refused, so there is nothing at the pin to
  // postdate. Saying "greenfield" there names a cause that is not the reason,
  // and the reader cannot tell a new directory from a tier nobody asked.
  return dimTier(baselineDim, dim) === "semantic" ? "semantic-unbaselined" : "postdates-baseline";
}

const dimTier = (baselineDim, dim) => dim?.tier ?? baselineDim?.tier ?? null;

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
  {
    baselineDim = null,
    measured = null,
    truncated = false,
    current,
    authors,
    repoAuthors,
    historyRead = true,
    semantic = null,
    defaultSide = defaultSideFor,
    defaultClass = defaultClassFor,
  } = {}
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
  // Ordered: a corpus answered for in part outranks everything, then a tier
  // that ran badly closes its own dimensions, then a population nobody
  // accepted. A degraded checker is this tier's version of a truncated corpus,
  // and it must not reach the dimensions the syntactic tier answered cleanly.
  const semanticBlock =
    dim.tier === "semantic" && semantic && semantic.status === "degraded" ? "degraded-semantic" : null;
  // A learned class that moved since the pin is a population whose meaning
  // moved: the pinned counts answer a different sentence than today's, so
  // neither side may state until a human re-pins. Asked after the population
  // blocks, which already outrank it when both fire.
  const learnedBlock =
    baselineDim && baselineDim.learned !== undefined && dim.learned !== undefined && baselineDim.learned !== dim.learned
      ? "learned-moved"
      : null;
  const blocked = truncated
    ? "corpus-truncated"
    : (semanticBlock ?? (measured ? blockedFor(measured, baselineDim, dim) : null) ?? learnedBlock);
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

  // A side the model writes unprompted is stated, stored and enforced, and only
  // the rendered map treats it as a count: the always-loaded budget goes to
  // deviations, and the check still catches within-session drift on defaults.
  const states = blocked ? null : g.states;
  // A learned row's default is a class rather than a side: "functions are
  // named camelCase" in JavaScript is exactly what the model writes anyway.
  // Branched on the record's own `learned`, because that is the field the
  // reducer actually carries; the registry row's marker never leaves it.
  const matchesDefault =
    states !== null &&
    (dim.learned !== undefined
      ? dim.learned === defaultClass(dim.key)
      : states === defaultSide(dim.key));
  return {
    ...dim,
    ...g,
    matchesDefault,
    // Blocking has to close both sides. Forcing `directive` alone leaves a
    // greenfield or unreachable-baseline area stating its inverse, which is the
    // same directive from a population nobody accepted (D6, E3, E4).
    states,
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
