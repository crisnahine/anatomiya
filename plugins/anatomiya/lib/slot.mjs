import { wilsonLower } from "./gates.mjs";

/**
 * A slot: one dimension's counts in one area. The scan builds it, the record
 * stores it through `slotRecord`, a held area's record carries it while
 * `isWholeArea` says it is whole, and every reader takes its side and its scope
 * from here, so the renderer and the check never name different sides of it.
 */

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
  // A suppressed slot still picks a side, but a plurality is not a majority.
  // Four of seven decided which of two opposed sentences an agent was handed,
  // and made `check` report the practice 76% of the repository follows as a
  // violation of the inverse. The flip needs a majority the sample can support:
  // the counter's own lower bound over a half. Sixty-one sites at 59 to 2 still
  // flip, which is what the side exists for; seven at 4 to 3 no longer do.
  //
  // Except where a side holds no site at all. The bound is penalised hardest at
  // small n, so a unanimous counter of three failed it too and the map printed
  // the claim with 0 of 3, which is a sentence the directory follows zero times
  // and which the check then enforced against files doing what every other file
  // there does. A side with nothing behind it is never the side that prints.
  //
  // Above one site, because one observation is not a habit: a single site flipped
  // a directory against a claim the rest of the repository holds at 94.7% and
  // against its own parent area's directive, which is D9's defect again at n = 1.
  const counterSites = d.candidates - d.conforming;
  const majority =
    (d.candidates > 1 && d.conforming === 0) || wilsonLower(counterSites, d.candidates) > 0.5;
  const counter = d.counterClaim && (states === "counter" || (states === null && majority));
  return counter
    ? {
        states,
        side: "counter",
        claim: d.counterClaim,
        conforming: counterSites,
        exceptions: d.counterExceptions || [],
        more: d.moreCounterExceptions || 0,
        gate: d.counterGate,
        // D4 counts authors per side. A record written before the counter's
        // count was stored carries the one its map printed.
        authors: d.counterAuthors ?? d.authors,
        borrowed: d.counterBorrowed === true,
      }
    : {
        states,
        side: "claim",
        claim: d.claim,
        conforming: d.conforming,
        exceptions: d.exceptions || [],
        more: d.moreExceptions || 0,
        gate: d.gate,
        authors: d.authors,
        // Whether the gates cleared this side on the rest of the repository's
        // record rather than on this area's own sample. The check caps a
        // borrowed claim below MUST-FIX, which is a statement about this
        // area's own history and is exactly what was borrowed.
        borrowed: d.borrowed === true,
      };
}

/**
 * The extensions and names a claim was counted over, where its area holds
 * files of others, or null where its sentence names none.
 *
 * An area delivers on one glob for every language in it, so a claim learned
 * from the `.ts` files of a directory reaches an agent editing the `.svelte`
 * file beside them, where the row was never asked and the opposite may be the
 * rule. The scan keeps the answer on the slot, and a record written before it
 * prints the sentence bare in the same number of lines.
 */
export function scopeOf(d) {
  // A record is committed, so a branch writes this list and check prints it once per finding.
  const scope = d.scope;
  return Array.isArray(scope) && scope.length > 0 && scope.length <= SCOPE_MOST && scope.every((e) => typeof e === "string" && SCOPE_ENTRY.test(e)) ? scope : null;
}

const SCOPE_MOST = 16;
// What `extOrName` gives: an extension, `.d.` and all, or a whole name with none. Every
// declared extension and file name is ASCII, so no scan writes another letter.
const SCOPE_ENTRY = /^(?:(?:\.d)?\.)?[A-Za-z0-9_+-]{1,64}$/;

/** The slot as the record stores it, which is all the check and a carried area have of it. */
export function slotRecord(d) {
  return {
    key: d.key,
    // Which engine answered it. The check counts the map's type-checked claims
    // off this field, so without it every map read as holding none and the note
    // saying they went unmeasured could not fire on any map a scan ever wrote.
    tier: d.tier,
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
    // What the rest of the repository says about this dimension, leaving this
    // area out. Stored beside the area's own bound so a stated claim can be
    // audited from disk for which of the two carried it.
    priorBound: rounded(d.priorBound),
    // Only when true, the way `matchesDefault` is: an older record reads as
    // never borrowing, which is what its scan decided.
    ...(d.borrowed === true ? { borrowed: true } : {}),
    directive: d.directive,
    // Only when true: the renderer's one reason to treat a stated slot as a
    // count, and an absent key is the older record's honest "never matched".
    ...(d.matchesDefault === true ? { matchesDefault: true } : {}),
    ...(d.learned === undefined ? {} : { learned: d.learned }),
    // Which kind of file the class was learned over, where the row narrows its
    // population to one. Absent on an older record means "not narrowed", which
    // is what every scan before this did.
    ...(d.learnedKind === undefined ? {} : { learnedKind: d.learnedKind }),
    // The area's classes that reach the learned base through a class it declares
    // (single-table inheritance). Absent on an older record, which judged the
    // learned base alone.
    ...(Array.isArray(d.reaches) && d.reaches.length ? { reaches: d.reaches } : {}),
    // Only when true, the way `borrowed` is: an older record reads as unnarrowed
    // and gets the plain sentence, which is the one its own map printed.
    ...(d.narrowed === true ? { narrowed: true } : {}),
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
    // How many sites the classifier held no vote for, which is the number the
    // counts line prints. Stored whenever there were any, the
    // way the companion count is, including on a slot this area only counts:
    // the record is what the map is derivable from, and a slot the next scan
    // states is one this number belongs to. Absent means none, so an older
    // record reads as an area that skipped nothing, which is what it printed.
    ...(d.declined === undefined ? {} : { declined: d.declined }),
    // The files a claim was asked of, where its sentence names them. Absent on
    // an older record, which prints the sentence bare, as its own map did.
    ...(scopeOf(d) === null ? {} : { scope: d.scope }),
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
    counterPriorBound: rounded(d.counterPriorBound),
    ...(d.counterBorrowed === true ? { counterBorrowed: true } : {}),
    counterGate: d.counterGate ?? null,
    ...(d.counterAuthors === undefined ? {} : { counterAuthors: d.counterAuthors }),
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
export function isWholeArea(a) {
  return isPlain(a)
    && typeof a.id === "string"
    && typeof a.path === "string"
    && Number.isFinite(a.fileCount)
    && Array.isArray(a.dimensions)
    && a.dimensions.every(isWholeSlot);
}

function isWholeSlot(d) {
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
