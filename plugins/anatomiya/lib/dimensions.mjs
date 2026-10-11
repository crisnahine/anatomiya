import { walk, fromVisitor } from "./walk.mjs";
import { walkRuby } from "./ruby-walk.mjs";
import { walkTree } from "./tree-walk.mjs";
import { engineOf } from "./langs.mjs";
import { DIMENSIONS } from "./dimensions-base.mjs";
import { EXTRA_DIMENSIONS } from "./dimensions-extra.mjs";
import { RUBY_DIMENSIONS } from "./dimensions-ruby.mjs";
import { JSX_DIMENSIONS } from "./dimensions-jsx.mjs";
import { RAILS_DIMENSIONS } from "./dimensions-rails.mjs";
import { SEMANTIC_DIMENSIONS } from "./dimensions-semantic.mjs";
import { NAMING_AST } from "./dimensions-naming.mjs";
import { CAPABILITY_DIMENSIONS } from "./dimensions-capability.mjs";
import { TREE_DIMENSIONS } from "./dimensions-tree.mjs";
import { CAPABILITY_WORDS } from "./stems.mjs";
// The framework field is held to the declared profiles, so a row naming a
// framework nobody detects cannot ship as a slot that can only read zero (C8).
import { FRAMEWORK_NAMES } from "./frameworks.mjs";

/**
 * A dimension is one claim about one area, and it is defined by three
 * quantities rather than one:
 *
 *   applicability  files that could participate in this claim at all
 *   candidates     sites inside those files where the construct appears
 *   conforming     candidates matching the positive pattern
 *
 * The ratio is conforming/candidates. Counting files instead of sites was
 * measured flipping 10 of 39 verdicts in both directions: it hides real
 * conventions and it manufactures false ones.
 *
 * `precision: "partial"` marks a predicate that under-counts applicability in
 * cases the parser cannot see, which is the dangerous direction, so a partial
 * dimension is never allowed to reach the top severity.
 *
 * `counterClaim` is the inverse permission, and every dimension in the registry
 * declares it: a sentence where the other side is a house style someone chose,
 * and an explicit `null` where the other side is a defect. Absent is not a
 * third state. Writing `null` out is what makes the refusal a decision on the
 * page rather than a field nobody got to.
 */

// Every tree row, whichever file defines it: `registry.mjs` composes it with
// the other two. A parse child holds its own engine's tables instead.
export const ALL_DIMENSIONS = [
  ...DIMENSIONS,
  ...EXTRA_DIMENSIONS,
  ...RUBY_DIMENSIONS,
  ...JSX_DIMENSIONS,
  ...RAILS_DIMENSIONS,
  ...SEMANTIC_DIMENSIONS,
  ...NAMING_AST,
  ...CAPABILITY_DIMENSIONS,
  ...TREE_DIMENSIONS,
];

// A visitor row's `run` walks the tree alone, on its engine's walk, for the
// callers that ask one row at a time: the check, and the tests. Here, where the
// tree rows meet. Every row is asked its walk, one that brings a `run` of its
// own too: it is handed one engine's trees like any other, and listing a
// language of a second it loaded and crashed that engine's parser on each file.
const WALKS = { oxc: walk, prism: walkRuby, "tree-sitter": walkTree };
for (const d of ALL_DIMENSIONS) {
  const walkOf = walkFor(d);
  if (d.visitor) d.run = fromVisitor(d.visitor, walkOf);
}

/**
 * The walk a row's engine reads its tree with. Refused at import where there
 * is none, and where the row lists languages of two engines: a row walked by
 * another engine's walk counts nothing and says nothing.
 */
export function walkFor(row, walks = WALKS) {
  const engines = [...new Set(row.langs.map(engineOf))];
  if (engines.length !== 1) {
    throw new Error(engines.length ? `${row.key} lists languages of ${engines.join(" and ")}, and one walk reads one engine's tree` : `${row.key} lists no language`);
  }
  const [engine] = engines;
  if (!walks[engine]) throw new Error(`${row.key} is a row for ${engine}, and no walk reads a ${engine} tree`);
  return walks[engine];
}

export const PRECISIONS = ["precise", "partial"];

/**
 * Two values, and a row carrying neither does not ship.
 *
 * The severity rule reads this field: a `partial` predicate under-counts
 * applicability in cases the parser cannot see, which is the dangerous
 * direction, so it can never reach MUST-FIX. A row that spells the field
 * `"Precise"`, or forgets it, is capped by that same comparison and reads in
 * the map as a claim nobody marked. Both are silent, and the second is a claim
 * quietly worth less than it should be.
 *
 * Checked at load rather than in a test, because the registry is assembled from
 * six files and a seventh would be added without one.
 */
export function assertPrecision(rows) {
  for (const d of rows) {
    if (!PRECISIONS.includes(d.precision)) {
      throw new Error(
        `dimension ${d.key} declares precision ${JSON.stringify(d.precision)}, not one of ${PRECISIONS.join(" or ")}`
      );
    }
  }
  return rows;
}

/**
 * Which files could have participated at all, said out loud.
 *
 * A ratio is a promise about a denominator, and `applicability` is whatever
 * `run` happened to emit: a predicate seeing a tenth of its own construct gives
 * 1.0 over four files and reads as a strong convention. The three numbers
 * cannot show that on their own, which is why applicability renders beside the
 * area's file count; this is the other half, the predicate saying in words what
 * it was looking for, so the two can be compared.
 *
 * `blind` is tied to `precision` rather than free. `partial` is the marker and
 * this is the reason, and the reason used to live in a code comment nothing
 * read. A precise row spells `null`, because an absent key is not a third state
 * and a missing reason is how a partial row gets marked precise.
 *
 * Checked at load for the same reason precision is: the registry is assembled
 * from six files, and the seventh will arrive without a test.
 */
export function assertApplicability(rows) {
  // Long enough that a bare word cannot stand in for a sentence: "files" and
  // "n/a" are both refused. Short enough that nothing written in earnest trips
  // it. A word is not a predicate.
  const stated = (s) => typeof s === "string" && s.trim().length > 10;

  for (const d of rows) {
    const a = d.applicabilityPredicate;
    if (!a || typeof a.sites !== "string") {
      throw new Error(`dimension ${d.key} declares no applicabilityPredicate.sites: say which files could participate`);
    }
    // Told apart from the absent case, or somebody who wrote `sites: "any file"`
    // is sent looking for a field they can already see on the page.
    if (!stated(a.sites)) {
      throw new Error(
        `dimension ${d.key} states applicabilityPredicate.sites as ${JSON.stringify(a.sites)}, which is a word rather than a predicate`
      );
    }
    if (!("blind" in a)) {
      throw new Error(`dimension ${d.key} declares no applicabilityPredicate.blind: null, or what the predicate cannot see`);
    }
    // The one predicate field that is printed rather than stored, so its shape
    // is a bound on an always-loaded file rather than a matter of taste. A
    // second line breaks the forty the renderer holds; the column count is the
    // softer half, and it is here because a clause past it has stopped being a
    // clause. Shape only: whether it reads as a clause rather than a sentence is
    // taste over eighteen known strings, which is a test's job, and a rule here
    // could not tell `Net::HTTP` from sentence case anyway. A row whose
    // exclusions do not fit one line is a row that should carry none. A clause
    // written off the `sites` prose without running the predicate was wrong or
    // partial far more often than not, and the ones no line could carry were the
    // ones whose exclusions are a list. `sites` is where a list belongs.
    if ("notCounted" in a) {
      const c = a.notCounted;
      if (typeof c !== "string" || !/\S/.test(c) || /\s\s|[\r\n]/.test(c) || c.length > 120) {
        throw new Error(
          `dimension ${d.key} states applicabilityPredicate.notCounted as ${JSON.stringify(c)}, which is not one line of at most 120 characters`
        );
      }
    }
    // Printed ahead of that clause in an area holding component files, with
    // their extensions filled in, so it is held to the same line and has a
    // clause to sit ahead of.
    if ("componentNotCounted" in a) {
      const c = a.componentNotCounted;
      if (typeof c !== "string" || !c.includes("<ext>") || /\s\s|[\r\n]/.test(c) || c.length > 120 || !("notCounted" in a)) {
        throw new Error(
          `dimension ${d.key} states applicabilityPredicate.componentNotCounted as ${JSON.stringify(c)}, which is not one line naming <ext> beside a notCounted clause`
        );
      }
    }
    // The tie below is only a tie against a precision this build knows. Both
    // shipped call sites run `assertPrecision` first, but this is exported and
    // a row spelling `"Precise"` would otherwise satisfy neither branch and
    // pass, which is the silent gap the docstring says cannot happen.
    if (!PRECISIONS.includes(d.precision)) {
      throw new Error(
        `dimension ${d.key} declares precision ${JSON.stringify(d.precision)}, so its blind spot cannot be checked`
      );
    }
    if (d.precision === "precise" && a.blind !== null) {
      throw new Error(`dimension ${d.key} is precise and names a blind spot: mark it partial or drop the blind spot`);
    }
    if (d.precision === "partial" && !stated(a.blind)) {
      throw new Error(`dimension ${d.key} is partial and names no blind spot: say what the predicate cannot see`);
    }
  }
  return rows;
}

const TIERS = ["syntactic", "semantic"];

/**
 * Two values, and a row carrying neither does not ship.
 *
 * A semantic row needs a checker, which a scan runs only where it can. A row that
 * forgets the field, or spells it `"Syntactic"`, would be offered to the parse
 * worker, run against a program with no checker in it, and answer nothing on
 * every file forever. Checked at load for the same reason precision is: the
 * registry is assembled from seven files now.
 */
export function assertTier(rows) {
  for (const d of rows) {
    if (!TIERS.includes(d.tier)) {
      throw new Error(
        `dimension ${d.key} declares tier ${JSON.stringify(d.tier)}, not one of ${TIERS.join(" or ")}`
      );
    }
  }
  return rows;
}

/**
 * Names that read as a verdict rather than as a count.
 *
 * `claim` is rendered to the agent. A rendered 1.0 beside "Postel's Law" reads
 * as agreement with the principle rather than as a measurement of this
 * repository, and a counted claim is exactly the thing that cannot afford to
 * say that. Closed and short on purpose: this is the set of names that have
 * been proposed as labels, not a style guide. The intake table records which
 * key replaced which name (G3).
 */
export const PRINCIPLE_NAMES = [
  "Postel's Law",
  "Law of Demeter",
  "Principle of least privilege",
  "Single responsibility",
  "Open/closed",
  "Liskov",
  "Dependency inversion",
  "Interface segregation",
  "Tell, don't ask",
  "Command-query separation",
  "Separation of concerns",
  "Convention over configuration",
  "SOLID",
  "DRY",
  "KISS",
  "YAGNI",
];

/**
 * Refuse a row whose rendered sentence names a principle instead of the code.
 *
 * A test would catch this in CI; a throw catches it the moment somebody writes
 * the row and runs one file, which is the same gap `assertPrecision` exists for.
 */
// Whole words, not substrings. Four of the names are acronyms and a bare
// `includes` finds them inside ordinary English: "consolidated" holds SOLID,
// "dry-run" holds DRY, "kissed" holds KISS. This runs at load over the whole
// registry, so one legitimate claim spelled that way would kill scan, check and
// pin at startup while naming a principle the sentence never mentions. The
// hyphen is excluded alongside word characters, or "dry-run" matches again.
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NAME_PATTERNS = PRINCIPLE_NAMES.map((n) => [n, new RegExp(`(?<![\\w-])${escape(n)}(?![\\w-])`, "i")]);

export function assertClaimIsNotAVerdict(rows) {
  for (const d of rows) {
    for (const sentence of [d.claim, d.counterClaim].filter((s) => typeof s === "string")) {
      const hit = NAME_PATTERNS.find(([, re]) => re.test(sentence))?.[0];
      if (hit) {
        throw new Error(
          `dimension ${d.key} renders "${sentence}", which names the principle "${hit}": say what the code does instead`
        );
      }
    }
  }
  return rows;
}

/**
 * A learned row states the class its sites voted for, so a hand-written counter
 * would fight the learning, and a claim with no placeholder renders the token
 * literally. Structural, not conventional: a test pins the counter-eligible
 * set, and this makes the collision impossible rather than merely reviewed.
 */
export function assertLearnedRows(rows) {
  for (const d of rows) {
    if (!d.learnedClasses) continue;
    if (d.counterClaim !== null) {
      throw new Error(`dimension ${d.key} learns its class and may not carry a counterClaim`);
    }
    if (!d.claim.includes("<style>")) {
      throw new Error(`dimension ${d.key} learns its class and its claim carries no <style> placeholder`);
    }
  }
  return rows;
}

export const KINDS = Object.freeze(["tree", "corpus", "pairing"]);

/**
 * The discriminant every reader branches on, stamped where it is derivable.
 *
 * A row is counted one of three ways: a tree walk (`run`), a fold over the
 * corpus (`classify`), or a companion match (`companionSuffix`). Two of the
 * three spelled the kind and the third was told apart by which fields exist,
 * so every reader re-derived the union, and a new kind landed in four modules
 * at once (H14: one boolean). A row with `run` and no kind is a tree row by
 * construction and is stamped rather than made to say so once per row; the
 * other two kinds were already spelled and must be.
 */
function stampKind(rows) {
  for (const d of rows) {
    if (d.kind === undefined && typeof d.run === "function") d.kind = "tree";
    if (!KINDS.includes(d.kind)) {
      throw new Error(`dimension ${d.key} declares kind ${JSON.stringify(d.kind)}, not one of ${KINDS.join(", ")}`);
    }
    if (d.kind === "tree" && typeof d.run !== "function") {
      throw new Error(`dimension ${d.key} is a tree row with no run`);
    }
    if (d.kind === "corpus" && typeof d.classify !== "function") {
      throw new Error(`dimension ${d.key} is a corpus row with no classify`);
    }
    if (d.kind === "pairing" && typeof d.companionSuffix !== "string") {
      throw new Error(`dimension ${d.key} is a pairing row with no companionSuffix`);
    }
    if (d.kind !== "tree" && typeof d.run === "function") {
      throw new Error(`dimension ${d.key} is a ${d.kind} row carrying a run`);
    }
  }
  return rows;
}

/**
 * The newest fields, held to shape at load like the five that came before.
 *
 * The battery covered exactly the fields that had already caused an incident,
 * which left the ones from H11 and H14 the least guarded: a `groupedSites` on
 * a row that learns nothing folds votes nobody cast, and a capability or
 * framework off its closed set is a row offered to no repository, silently.
 */
export function assertDeclaredFields(rows) {
  for (const d of rows) {
    if (d.groupedSites !== undefined && (d.groupedSites !== true || !d.learnedClasses)) {
      throw new Error(`dimension ${d.key} declares groupedSites without learning a class`);
    }
    if (d.noneClaim !== undefined && (typeof d.noneClaim !== "string" || !d.learnedClasses)) {
      throw new Error(`dimension ${d.key} declares noneClaim off a learned row`);
    }
    if (d.learnedFromSource !== undefined && (d.learnedFromSource !== true || !d.learnedClasses)) {
      throw new Error(`dimension ${d.key} declares learnedFromSource without learning a class`);
    }
    if (d.splitBy !== undefined && (typeof d.splitBy !== "function" || !d.learnedClasses)) {
      throw new Error(`dimension ${d.key} declares splitBy without learning a class`);
    }
    // A narrowed row is delivered to the files it excluded, so its sentence has
    // to name the kind it was learned over. One sentence is not a split.
    if (d.splitBy !== undefined) {
      const sentences = Object.entries(d.splitClaim || {});
      if (sentences.length < 2) {
        throw new Error(`dimension ${d.key} declares splitBy without a sentence per kind`);
      }
      for (const [kind, sentence] of sentences) {
        if (typeof sentence !== "string" || (d.claim.includes("<style>") && !sentence.includes("<style>"))) {
          throw new Error(`dimension ${d.key} sentence for ${kind} states a class the learning cannot fill`);
        }
      }
    }
    if (d.blindWhenStripped !== undefined && d.blindWhenStripped !== true) {
      throw new Error(`dimension ${d.key} declares blindWhenStripped as ${JSON.stringify(d.blindWhenStripped)}`);
    }
    if (d.judgesBody !== undefined && d.judgesBody !== true) {
      throw new Error(`dimension ${d.key} declares judgesBody as ${JSON.stringify(d.judgesBody)}`);
    }
    if (d.needsTypeSyntax !== undefined && d.needsTypeSyntax !== true) {
      throw new Error(`dimension ${d.key} declares needsTypeSyntax as ${JSON.stringify(d.needsTypeSyntax)}`);
    }
    if (d.capability !== undefined && !(d.capability in CAPABILITY_WORDS)) {
      throw new Error(`dimension ${d.key} declares capability ${JSON.stringify(d.capability)}, which no vocabulary carries`);
    }
    if (d.framework !== undefined && !FRAMEWORK_NAMES.includes(d.framework)) {
      throw new Error(`dimension ${d.key} declares framework ${JSON.stringify(d.framework)}, which no corpus signal shows`);
    }
    // `adoptedCapabilities` counts adopting files off the worker's raw hits and
    // selects through nothing, so a row of both kinds votes off-framework for
    // the capability rows the whole repository is then offered.
    if (d.framework !== undefined && d.capability !== undefined) {
      throw new Error(`dimension ${d.key} declares framework and capability at once, and adoption reads hits unfiltered`);
    }
    // `pairingViolations` computes one direction, the companion that is not
    // there, and the check skips an obligation whose claim side did not state.
    // A pairing row carrying a counter would print a sentence in the map and
    // enforce nothing, which is the H12 asymmetry. Refused here rather than
    // guarded in the check, so the hole cannot be opened by an edit to
    // `pairing.mjs` alone.
    if (d.kind === "pairing" && typeof d.counterClaim === "string") {
      throw new Error(
        `dimension ${d.key} is a pairing row with a counterClaim, and pairingViolations enforces only the missing-companion direction`
      );
    }
    // A corpus row's site is the name itself, and which names are sites is a
    // different question from which class a name votes for: a name matching
    // every class votes for none and is not a site, and a name matching none
    // is a site with no vote. A row declaring only the vote leaves the second
    // kind unenforceable.
    if (d.kind === "corpus" && (typeof d.classify !== "function" || typeof d.isSite !== "function")) {
      throw new Error(`corpus row ${d.key} must declare both classify and isSite`);
    }
  }
  return rows;
}

/**
 * The whole battery over one list, run by `registry.mjs` over the union of the
 * three, so no list can reach a reader having answered fewer questions.
 */
export function assertRegistryRows(rows) {
  assertPrecision(rows);
  assertApplicability(rows);
  assertTier(rows);
  assertClaimIsNotAVerdict(rows);
  assertLearnedRows(rows);
  stampKind(rows);
  assertDeclaredFields(rows);
  return rows;
}

/**
 * Which capabilities this repository has actually adopted: at least three
 * examined files already route through a wrapper. Adoption alone decides
 * (C14): the JS rows cannot conform without a vocabulary-named import, and the
 * Ruby logger conforms on receivers no filename carries, so requiring the
 * vocabulary here silenced the row on the repositories it is for. A repository
 * holding a config.ts nobody imports has a name, not a habit, and never gets
 * here.
 */
export function adoptedCapabilities(records) {
  const category = new Map(ALL_DIMENSIONS.filter((d) => d.capability).map((d) => [d.key, d.capability]));
  const adopters = new Map();
  for (const [rel, r] of records) {
    if (!r.ok || !r.hits) continue;
    for (const [key, hits] of Object.entries(r.hits)) {
      const cap = category.get(key);
      if (!cap || !hits.some((h) => h.conforming)) continue;
      if (!adopters.has(cap)) adopters.set(cap, new Set());
      adopters.get(cap).add(rel);
    }
  }
  return new Set([...adopters.keys()].filter((c) => adopters.get(c).size >= 3));
}
