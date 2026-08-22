import { dimensionsFor } from "./dimensions.mjs";
import { pairingsFor } from "./pairing.mjs";
import { claimFor } from "./dimensions-naming.mjs";
import { rowsOfKind } from "./registry.mjs";
import { dirCount } from "./areas.mjs";
import { holdsTypeSyntax, language } from "./langs.mjs";
import { defaultSideFor, defaultClassFor } from "./model-defaults.mjs";

export const GATES = {
  minRatio: 0.9,
  z: 1.96,                // Wilson 95%; a perfect record needs 35 sites to hold 0.90
  authorEvidence: 2,      // two pairs of hands is the whole claim a per-file author count carries
  minEffectiveFiles: 3,   // how many files the evidence is worth, not how many carry it
  minApplicabilityShare: 0.25, // the floor that holds on a large area, where a root does not
  applicabilityShareCap: 3,    // in roots: the share stops growing where the risk it guards does not
};

/**
 * How many files a dimension has to speak about before it may state.
 *
 * The stricter of a root and a quarter share, with the share capped at three
 * roots. Each floor is wrong alone: the root grows slower than the area and
 * asks for more than a quarter below sixteen files, where a quarter is one or
 * two files; the share holds above it, and a measured 120-file area where 11
 * files used `?.` and 109 read absent values without it stated the claim over
 * all 120.
 *
 * The share was measured at 120 and never tested at 1,531. It grows linearly
 * with the area while the risk it guards does not, so on a single 1,531-file
 * directory it asked for 383 files and made any construct rarer than a quarter
 * of the directory unstateable however perfect it was.
 *
 * Three roots is the smallest whole factor that leaves the measured band alone.
 * The first area size where the cap changes the answer is 157; at two roots it
 * is 73, and `floor(120)` would fall from 30 to 22, so the very area the share
 * was written from would answer differently. Still monotone in the area size,
 * which is the property the floor leans on.
 */
export function applicabilityFloor(files) {
  const root = Math.ceil(Math.sqrt(files));
  return Math.max(
    root,
    Math.min(Math.ceil(GATES.minApplicabilityShare * files), GATES.applicabilityShareCap * root)
  );
}

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
 * The mirror of `wilsonLower`: the same centre, plus the margin.
 *
 * Asked of the area's own sample when it borrows a repository-wide rate, so a
 * sample that is plainly worse than the rate it is borrowing cannot borrow it.
 *
 * Held to the two bounds the arithmetic owes and the division does not give: it
 * is a probability, so never above one, and it is an upper bound on the rate it
 * was handed, so never below it. Unheld, `wilsonUpper(n, n)` returned
 * 0.9999999999999998 at 118 of the first 500 sample sizes and 1.0000000000000002
 * at others, and the borrow compares it against a rate that is exactly 1 wherever
 * the rest of the repository holds a claim without exception. On a measured front
 * end, 37 perfect rows were denied at n = 12, 20, 21 and 31 while n = 16, 17, 19
 * and 23 through 26 denied none between them: the size decided, not the evidence.
 *
 * The lower clamp is what carries the perfect case, and it subsumes asking
 * whether the sample already meets the rate it is borrowing: at or above that
 * rate the bound is too, by construction rather than by rounding.
 */
export function wilsonUpper(conforming, candidates, z = GATES.z) {
  const n = candidates;
  if (!(n > 0)) return 1;
  const p = Math.min(1, conforming / n);
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.min(1, Math.max(p, (centre + margin) / (1 + z2 / n)));
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
export function reduceArea(area, parsed, { frameworks, tier = "syntactic", capabilities, rows } = {}) {
  // Pairings are composed in here rather than in `dimensionsFor`, because that
  // list is what the parse worker runs and a pairing has no program to run
  // against. Both kinds produce the same hit shape, so the fold is blind to the
  // difference; only the companion count asks which kind this is.
  const dims = [
    // `rows` governs the tree pool alone; the two lists below are added for the
    // area's languages whatever it holds.
    ...dimensionsFor(area.langs, { frameworks, tier, capabilities, rows }),
    ...pairingsFor(area.langs),
    // Corpus rows ask about filenames, so they have no program to run against
    // and no worker hit to read; the fold builds their sites itself below.
    ...rowsOfKind("corpus").filter((d) => d.langs.some((l) => area.langs.includes(l))),
  ];
  const langByRel = new Map((area.files || []).map((f) => [f.rel, f.lang]));
  // The records themselves, for the rows whose population depends on what kind
  // of file a site sits in rather than on the site alone.
  const byRel = new Map(parsed.map((f) => [f.rel, f]));
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
    examined.push({
      rel: file.rel,
      lang: langByRel.get(file.rel) ?? language(file.rel),
      stripped: file.stripped === true,
      facets: file.facets ?? null,
    });
  }

  for (const dim of dims) {
    const perFile = new Map();
    // A mixed area holds files of both engines. A Ruby dimension counted
    // against the area's JS files reads as a narrow predicate and is suppressed
    // by the applicability gate, so the denominator is the files the dimension
    // could speak about at all, not every file in the area.
    //
    // A file whose Flow annotations were blanked so it could be parsed at all
    // holds no answer for a dimension whose question is the annotation. It is
    // not a file that declined the convention, and counting it as one renders
    // "10 of 10 sites across 10 of 20 files" over a directory where the other
    // ten were never asked. A plain JavaScript file cannot carry a type
    // annotation at all, which is the same argument one step further back.
    const eligible = (e) =>
      dim.langs.includes(e.lang) &&
      !(e.stripped && dim.blindWhenStripped) &&
      !(dim.needsTypeSyntax && !holdsTypeSyntax(e.rel, e.facets));
    let langFileCount = examined.filter(eligible).length;

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

    // A row that learns a class learns it over one kind of file. An area that
    // holds both kinds learns off whichever it holds more of, and the other
    // kind leaves the population rather than being judged by a convention it
    // never expressed. Ties go to the module side, so the answer never depends
    // on iteration order.
    let learnedKind;
    // Whether the narrowing left anything out here. The sentence names the
    // population it excluded, and an area holding one kind excluded nothing,
    // so it reads a distinction its own code does not draw.
    let narrowed = false;
    if (dim.splitBy) {
      learnedKind = majorityKind(perFile, byRel, dim.splitBy);
      for (const rel of [...perFile.keys()]) {
        if (dim.splitBy(byRel.get(rel)) !== learnedKind) perFile.delete(rel);
      }
      if (perFile.size === 0) continue;
      // The share divides one of these by the other, so narrowing the numerator
      // and not the denominator reads the predicate as narrow on every mixed
      // directory: exactly the failure C3 and C4 exist to stop.
      langFileCount = examined.filter((e) => eligible(e) && dim.splitBy(byRel.get(e.rel)) === learnedKind).length;
      narrowed = examined.some((e) => eligible(e) && dim.splitBy(byRel.get(e.rel)) !== learnedKind);
    }

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
        // The class the row is about is not one of its own sites. A file that
        // holds nothing else leaves the population rather than being counted
        // as a file the dimension could speak about.
        const own = hits.filter((h) => !isLearnedItself(h, learned));
        if (!own.length) {
          perFile.delete(rel);
          continue;
        }
        perFile.set(
          rel,
          grouped ? groupSites(own, learned) : own.map((h) => ({ ...h, conforming: sameConstant(h.class, learned, h.nesting) }))
        );
      }
      if (perFile.size === 0) continue;
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
      ...(learned === undefined ? {} : { learned, claim: claimFor(dim, learned, narrowed ? learnedKind : undefined) }),
      // Which kind of file the class was learned over, so the check judges the
      // same population the map measured.
      ...(learnedKind === undefined ? {} : { learnedKind }),
      // Whether the sentence names that kind. The check builds its own text
      // from the registry template, and without this it quoted the unqualified
      // sentence, the one that pools the excluded files back in.
      ...(narrowed ? { narrowed: true } : {}),
    });
  }

  return out;
}

/**
 * The kind of file most of a row's sites sit in, counted per file.
 *
 * Ties go to the module side rather than to whichever the map iterated first,
 * so two scans of unchanged source answer the same (A5).
 */
function majorityKind(perFile, byRel, splitBy) {
  const counts = new Map();
  for (const rel of perFile.keys()) {
    const kind = splitBy(byRel.get(rel));
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  let best = "module";
  let most = counts.get("module") ?? 0;
  for (const [kind, n] of [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (n > most) {
      best = kind;
      most = n;
    }
  }
  return best;
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
    if (at) at.conforming = at.conforming || sameConstant(h.class, learned, h.nesting);
    else byGroup.set(key, { ...h, conforming: sameConstant(h.class, learned, h.nesting) });
  }
  return [...byGroup.values()];
}

/**
 * Whether the constant a site names and the class the area learned are the same
 * class, read the way Ruby reads a relative reference.
 *
 * A bare constant resolves against the nesting the class is *written* in, and
 * `nesting` is `Module.nesting` for the site: the scopes, innermost first. The difference is
 * the whole of it: Ruby evaluates a superclass expression in the scope holding
 * the declaration, so `module Api::V1; class Qbo < BaseController` names
 * `Api::V1::BaseController` while `class Api::V1::Qbo < BaseController`, written
 * at the top level, names `::BaseController`. Both read back as the same
 * qualified name, so the site's own name cannot tell them apart and the
 * enclosing bodies have to be carried separately.
 *
 * Compared as written, the four controllers spelling it relatively counted as a
 * second base and took a 59-of-64 convention to 55 of 64, under the gate.
 *
 * Only a bare name is resolved. A scoped name has already said which class it
 * means, so `Api::V1::ChromeExtension::BaseController` stays a different base.
 * This is narrower than the suffix match `isLearnedItself` refused: that one
 * accepted any name merely ending in the learned one, with no nesting to
 * justify it.
 *
 * Both directions, because either side may be the bare one: a repository whose
 * plurality spelling is relative learns the bare name, and the scoped sites that
 * agree with it must still count.
 */
export function sameConstant(written, learned, nesting) {
  if (typeof written !== "string" || typeof learned !== "string") return false;
  if (written === learned) return true;
  if (!Array.isArray(nesting) || nesting.length === 0) return false;
  const [bare, scoped] = written.includes("::") ? [learned, written] : [written, learned];
  // Both scoped, or both bare and unequal: nothing is left for a nesting to
  // resolve, and guessing would be the suffix match this refuses.
  if (bare.includes("::") || !scoped.includes("::")) return false;
  return nesting.some((scope) => `${scope}::${bare}` === scoped);
}

/**
 * Whether this site is the very class the area learned.
 *
 * `class ApplicationRecord < ApplicationRecord` is a NameError, so the base
 * itself can never conform to the row it defines, and the map printed the
 * absurdity: app/models states "classes here inherit ApplicationRecord" and
 * listed `application_record.rb` among its own exceptions.
 *
 * The name has to match exactly. A suffix match was tried and refused on
 * measurement: it exempts any class whose qualified name merely ends in the
 * learned one, including `Api::V1::Admin::BaseController` under a learned
 * `BaseController`, and it fires even where that class names an explicit and
 * different superclass, which the "a base cannot inherit itself" argument
 * cannot justify. Deciding between the two needs Ruby's own constant lookup,
 * which nothing here does. The cost of exactness is that a base written inside
 * a namespace and inherited by its bare name keeps its exception line in the
 * map, which is a cosmetic wart rather than a hole in what is enforced.
 */
export const isLearnedItself = (hit, learned) =>
  typeof learned === "string" && typeof hit.self === "string" && hit.self === learned;

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
  // This dimension's counts over the whole repository, on the same population
  // the gates read. Absent means no prior at all, which is what every gate did
  // before this existed: an absent pool must never open a gate.
  pooled = null,
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
  const minApplicable = applicabilityFloor(denominator);
  const looCandidates = candidates - (top.candidates || 0);
  // Leave-one-out, so nothing is its own prior: an area lending itself its own
  // counts would clear a bar it never reached.
  const restCandidates = pooled ? Math.max(0, pooled.candidates - candidates) : 0;
  const restConforming = pooled ? Math.max(0, pooled.conforming - conforming) : 0;
  const dimDirs = distinctDirs(files);
  const required = historyRead ? authorsRequired(repoAuthors) : null;

  // The same battery, run once per side. Only the numerator moves: how many
  // files the sites are spread over, how much of the area the construct
  // reaches and who wrote it are facts about where the sites are, not about
  // which way they point.
  const judge = (k, topK, restK) => {
    const ratio = candidates ? k / candidates : 0;
    const bound = wilsonLower(k, candidates);
    const looRatio = looCandidates > 0 ? (k - topK) / looCandidates : 0;
    // A small sample of a claim the rest of the repository holds is a
    // consistent sample of a strong claim, not weak evidence of a weak one. The
    // Wilson bound needs about 35 perfect sites to reach 0.90 and a measured
    // front end's median area holds 11 files, so an area could be perfectly
    // consistent and never speak.
    //
    // Two conditions, and the second is what stops this manufacturing
    // conventions: the rest of the repository has to clear the bar without this
    // area's help, and this area's own upper bound has to reach the rate it is
    // borrowing. A 900-of-1000 area tops out at 0.917 and cannot borrow a 0.988
    // repository's confidence.
    const priorBound = wilsonLower(restK, restCandidates);
    const restRatio = restCandidates ? restK / restCandidates : 0;
    const borrows = priorBound >= GATES.minRatio && wilsonUpper(k, candidates) >= restRatio;

    const checks = [
      ["ratio", ratio >= GATES.minRatio],
      // The bound dominates the ratio arithmetically, so it is never the deciding
      // pass. It is kept as its own check because the two failures mean opposite
      // things: "this repository is inconsistent" against "this repository is
      // consistent and there is not enough of it here to be sure". The second
      // is the one the pooled prior answers.
      ["evidence", bound >= GATES.minRatio || borrows],
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
    return {
      ratio,
      bound,
      priorBound,
      // Whether this side reached the bar on the repository behind it rather
      // than on its own sample. Carried so a stated claim can be audited from
      // disk for which of the two answered it.
      borrowed: !failed && bound < GATES.minRatio,
      gate: failed ? failed[0] : null,
    };
  };

  const claim = judge(conforming, top.conforming || 0, restConforming);
  // The leave-one-out reuses the file with the most candidates rather than the
  // most counter sites. The counter only reaches this gate at 0.90, so no other
  // file's counter sites can exceed that file's by more than a tenth of the
  // sample, which cannot move the ratio across 0.90 outside that band.
  const counter = judge(
    candidates - conforming,
    (top.candidates || 0) - (top.conforming || 0),
    restCandidates - restConforming
  );
  // The hand-written sentence is the whole permission. A dimension whose
  // inverse would be a defect never gets one, so it never gets a second side.
  const twoSided = typeof dim.counterClaim === "string";
  const states = !claim.gate ? "claim" : twoSided && !counter.gate ? "counter" : null;

  return {
    ratio: claim.ratio,
    bound: claim.bound,
    priorBound: claim.priorBound,
    borrowed: claim.borrowed,
    counterRatio: counter.ratio,
    counterBound: counter.bound,
    counterPriorBound: counter.priorBound,
    counterBorrowed: counter.borrowed,
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
 * What closes a slot before any gate is asked.
 *
 * Out of `verdictFor` because the pooled prior is built by the caller, one pass
 * before the gates run, and a closed slot may not lend its counts to one: a
 * greenfield area's population is the agent's own output (E4), and a corpus
 * read in part answered for an arbitrary subset (F7).
 *
 * The ordering is the point and it is written once: a corpus answered for in
 * part outranks everything, then a tier that ran badly closes its own
 * dimensions, then a population nobody accepted, then a learned class that
 * moved since the pin.
 */
export function blockOf(dim, { baselineDim = null, measured = null, truncated = false, semantic = null } = {}) {
  // A degraded checker is this tier's version of a truncated corpus, and it
  // must not reach the dimensions the syntactic tier answered cleanly.
  const semanticBlock =
    dim.tier === "semantic" && semantic && semantic.status === "degraded" ? "degraded-semantic" : null;
  // A learned class that moved since the pin is a population whose meaning
  // moved: the pinned counts answer a different sentence than today's, so
  // neither side may state until a human re-pins. The kind counts the same way:
  // a class learned over the components and re-learned over the helpers is the
  // same word about a different half of the directory. Asked after the
  // population blocks, which already outrank it when both fire.
  const moved = (a, b) => a !== undefined && b !== undefined && a !== b;
  const learnedBlock =
    baselineDim &&
    (moved(baselineDim.learned, dim.learned) || moved(baselineDim.learnedKind, dim.learnedKind))
      ? "learned-moved"
      : null;
  return truncated
    ? "corpus-truncated"
    : (semanticBlock ?? (measured ? blockedFor(measured, baselineDim, dim) : null) ?? learnedBlock);
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
  {
    baselineDim = null,
    measured = null,
    truncated = false,
    current,
    authors,
    repoAuthors,
    historyRead = true,
    semantic = null,
    // This dimension's counts over the whole repository, on the same
    // population the gates read. Built by the caller, because only a caller
    // that has seen every area has one.
    pooled = null,
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
  const blocked = blockOf(dim, { baselineDim, measured, truncated, semantic });
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
    pooled,
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
