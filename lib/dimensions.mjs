import { walk, isFunctionLike, declName, value, boundNames, optionalChain } from "./walk.mjs";
import { EXTRA_DIMENSIONS } from "./dimensions-extra.mjs";
import { RUBY_DIMENSIONS } from "./dimensions-ruby.mjs";
import { JSX_DIMENSIONS } from "./dimensions-jsx.mjs";
import { RAILS_DIMENSIONS } from "./dimensions-rails.mjs";
import { SEMANTIC_DIMENSIONS } from "./dimensions-semantic.mjs";
import { NAMING_AST } from "./dimensions-naming.mjs";
import { CAPABILITY_DIMENSIONS, CAPABILITY_WORDS } from "./dimensions-capability.mjs";
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

const isThrow = (n) => n.type === "ThrowStatement";
const isCatch = (n) => n.type === "CatchClause";

function usesParam(body, names) {
  if (!names.length) return false;
  let used = false;
  walk(body, (n, ctx) => {
    if (n.type !== "Identifier" || !names.includes(n.name)) return;
    // A property key and a non-computed member property spell the same name
    // without reading the binding: { e: 1 } and x.e are not uses of e.
    const parent = ctx.ancestors[ctx.ancestors.length - 1];
    if (parent && (parent.type === "Property" || parent.type === "ObjectProperty") &&
        parent.key === n && !parent.computed) return;
    if (parent && parent.type === "MemberExpression" && parent.property === n && !parent.computed) return;
    used = true;
  });
  return used;
}

/**
 * Every name this program assigns to, anywhere in it.
 *
 * A member assignment binds nothing: `obj.x = 1` writes a property, which is the
 * distinction `usesParam` already draws for a catch parameter, and `boundNames`
 * has no member case so it falls out. A for-of or for-in head with no
 * declaration writes its target on every turn without declaring it.
 */
function assignedNames(program) {
  const names = new Set();
  walk(program, (n) => {
    if (n.type === "AssignmentExpression") {
      for (const name of boundNames(n.left)) names.add(name);
      return;
    }
    if (n.type === "UpdateExpression") {
      if (n.argument && n.argument.type === "Identifier") names.add(n.argument.name);
      return;
    }
    if (n.type === "ForOfStatement" || n.type === "ForInStatement") {
      if (n.left && n.left.type !== "VariableDeclaration") for (const name of boundNames(n.left)) names.add(name);
    }
  });
  return names;
}

/**
 * Whether `const` was a real choice for this declaration.
 *
 * Every declarator initialised, and no name it binds assigned anywhere in the
 * file or declared there twice. `const x: T` with no initialiser is a
 * SyntaxError and assigning to a const is a TypeError, so where const was
 * unavailable nobody chose the `let` and the finding asks for code that does
 * not compile.
 *
 * A shadowed inner assignment loses the site rather than manufacturing one,
 * which is the safe direction and is what the declared sentence says: assigned
 * anywhere in the file.
 */
function constWasAvailable(decl, assigned, bindings) {
  return (decl.declarations || []).every(
    (d) => d.init && boundNames(d.id).every((name) => !assigned.has(name) && bindings.get(name) === 1)
  );
}

function bodyIsEmpty(block) {
  return !block || !Array.isArray(block.body) || block.body.length === 0;
}

export const DIMENSIONS = [
  {
    key: "swallowed_error",
    tier: "syntactic",
    claim: "catch blocks use the error they caught",
    counterClaim: null, // discarding the error is an absence, not a style anyone picked
    precision: "precise",
    applicabilityPredicate: {
      sites: "a file holding at least one catch clause, whether or not it binds the error",
      blind: null,
    },
    langs: ["js", "jsx"],
    run(program, add) {
      walk(program, (n, ctx) => {
        if (!isCatch(n)) return;
        const names = boundNames(n.param);
        const handled = !bodyIsEmpty(n.body) && (usesParam(n.body, names) || hasRethrow(n.body));
        add({ node: n, conforming: handled, where: declName(ctx.enclosing) });
      });
    },
  },

  {
    key: "error_shape",
    tier: "syntactic",
    claim: "failure is returned, not thrown",
    // The inverse is what JavaScript does by default, so it would state in
    // nearly every repository. A directive no repository can fail is the
    // flatness this registry rejects on the positive side.
    counterClaim: null,
    precision: "partial",
    applicabilityPredicate: {
      sites: "a file that throws outside a catch, or returns a result-shaped object",
      blind: "a throw inside a helper the caller wraps is invisible from the file that throws",
    },
    langs: ["js", "jsx"],
    run(program, add) {
      walk(program, (n, ctx) => {
        if (!isThrow(n)) return;
        // A rethrow inside a catch is deliberate, not a policy violation.
        const inCatch = ctx.ancestors.some((s) => s.type === "CatchClause");
        if (inCatch) return;
        add({ node: n, conforming: false, where: declName(ctx.fn) });
      });
      walk(program, (n, ctx) => {
        if (n.type !== "ReturnStatement" || !n.argument) return;
        if (!isResultShaped(value(n.argument))) return;
        add({ node: n, conforming: true, where: declName(ctx.fn) });
      });
    },
  },

  {
    key: "module_state_const",
    tier: "syntactic",
    claim: "module-level bindings are const",
    counterClaim: null, // the inverse is mutable module state, which no repository chose on purpose
    precision: "precise",
    applicabilityPredicate: {
      sites: "a file holding a variable declaration at module level, outside any loop; a let or var is one only where const was available, meaning every declarator is initialised and no name it binds is assigned or declared a second time anywhere in the file",
      blind: null,
    },
    langs: ["js", "jsx"],
    run(program, add) {
      const assigned = assignedNames(program);
      const bindings = new Map();
      const sites = [];
      walk(program, (n, ctx) => {
        if (n.type !== "VariableDeclaration") return;
        // Module level is exactly "no enclosing declaration". A top-level for
        // loop binding sits at module level by position and is not module
        // state, so it is excluded by its enclosing statement.
        if (ctx.enclosing !== null) return;
        if (ctx.ancestors.some((s) => /^(For|While|DoWhile)/.test(s.type))) return;
        // `declare const x: number` binds nothing at run time, so it is not
        // state this claim is about either way, and a binding inside a
        // namespace or an ambient module is scoped to that block rather than to
        // the module.
        if (n.declare) return;
        if (ctx.ancestors.some((a) => a.type === "TSModuleDeclaration")) return;
        sites.push(n);
        for (const d of n.declarations || []) {
          for (const name of boundNames(d.id)) bindings.set(name, (bindings.get(name) ?? 0) + 1);
        }
      });
      // Two passes, because whether `const` was available needs the whole file:
      // the name may be assigned below the declaration, or declared twice.
      for (const n of sites) {
        // A const answered the claim whatever else the file does with the name,
        // so the conforming count cannot move and the ratio can only rise by
        // losing violations nobody could act on.
        if (n.kind === "const") {
          add({ node: n, conforming: true, where: null });
          continue;
        }
        if (!constWasAvailable(n, assigned, bindings)) continue;
        add({ node: n, conforming: false, where: null });
      }
    },
  },

  {
    key: "async_error_handling",
    tier: "syntactic",
    claim: "async functions handle their own failures",
    // A repository that handles failure at one boundary and one where nobody
    // handles it anywhere count identically here, so the sentence would bless
    // an absence as often as an architecture.
    counterClaim: null,
    precision: "partial",
    applicabilityPredicate: {
      sites: "a file declaring at least one async function",
      blind: "a caller-level wrapper handling the failure is invisible from the function that fails",
    },
    langs: ["js", "jsx"],
    run(program, add) {
      walk(program, (n, ctx) => {
        if (!isFunctionLike(n) || !n.async) return;
        let handled = false;
        walk(n.body, (m, mctx) => {
          if (m.type !== "TryStatement") return;
          // The handler must belong to THIS function, not to an inner arrow or
          // a nested method that happens to sit inside its byte range.
          if (mctx.enclosing !== null) return;
          handled = true;
        });
        add({ node: n, conforming: handled, where: declName(n) });
      });
    },
  },

  {
    key: "optional_chaining",
    tier: "syntactic",
    claim: "optional values are read with ?.",
    // The one predicate that has already produced a measured false convention,
    // and it recognises an optional by the receiver's name. A second side would
    // state over the same names in the other direction.
    counterClaim: null,
    precision: "partial",
    applicabilityPredicate: {
      sites: "a file reading a non-computed member off a binding named opts, options, params, props, config or input, where the grammar would let that read carry ?.: a write position, a new callee and a tagged template's tag refuse it",
      blind: "the receiver's name is the only signal of optionality this tier has, and it is a poor one: a measured 2,485-file repository writes ?. 2,627 times across 672 files, while this row sees 538 sites in 202 of them. A destructured or interface-declared optional carries none of the six names, and a read off a name that does carries one whether or not the value is optional. Answering it properly needs the checker, which knows whether a receiver's type includes null or undefined",
    },
    langs: ["js", "jsx"],
    run(program, add) {
      walk(program, (n, ctx) => {
        if (n.type !== "MemberExpression") return;
        if (n.computed) return;
        const obj = n.object;
        if (!obj || obj.type !== "Identifier") return;
        if (!/^(opts|options|params|props|config|input)$/.test(obj.name)) return;
        // A read in a write position, a `new` callee or a tagged template's tag
        // cannot carry `?.` at all, so the conforming form does not exist there.
        if (!optionalChain(n, ctx.ancestors).allowed) return;
        add({ node: n, conforming: n.optional === true, where: declName(ctx.fn) });
      });
    },
  },
];

function hasRethrow(block) {
  let found = false;
  walk(block, (n) => {
    if (n.type === "ThrowStatement") found = true;
  });
  return found;
}

function isResultShaped(node) {
  if (!node) return false;
  if (node.type === "CallExpression") {
    const c = node.callee;
    if (c && c.type === "MemberExpression" && c.object && c.object.name === "Result") return true;
    if (c && c.type === "Identifier" && /^(ok|err|Ok|Err)$/.test(c.name)) return true;
  }
  if (node.type === "ObjectExpression") {
    return node.properties.some((p) => {
      if (!p.key || p.computed) return false;
      const k = p.key.name ?? p.key.value;
      return k === "ok" || k === "error";
    });
  }
  return false;
}

// Every tree row, whichever file defines it: this is the list the parse worker
// runs, and `registry.mjs` composes it with the other two.
export const ALL_DIMENSIONS = [
  ...DIMENSIONS,
  ...EXTRA_DIMENSIONS,
  ...RUBY_DIMENSIONS,
  ...JSX_DIMENSIONS,
  ...RAILS_DIMENSIONS,
  ...SEMANTIC_DIMENSIONS,
  ...NAMING_AST,
  ...CAPABILITY_DIMENSIONS,
];

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

export const TIERS = ["syntactic", "semantic"];

/**
 * Two values, and a row carrying neither does not ship.
 *
 * A semantic row needs a checker, which is opt-in and 26x the cost. A row that
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
export function stampKind(rows) {
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

/**
 * The dimensions that speak these languages, and where the caller knows which
 * frameworks the repository uses, only those the repository could satisfy.
 *
 * A dimension carries `framework` when its claim is a framework's and it cannot
 * see from one file which framework it is standing in. `zone_aware_time` is the
 * case: `Time.now` is a drifting timestamp under Rails and correct in plain
 * Ruby, and with no counterClaim it can never state either side off-Rails, so
 * it emits a line that can only ever read zero. `model_callbacks` and the
 * migrations are not marked, because they already gate on an ActiveRecord
 * superclass and find nothing off-Rails on their own.
 *
 * Naming no frameworks is not the same as naming none. A caller that cannot
 * know, such as the parse worker, is offered everything and its extra hits go
 * unread: the reducer and the check are the arbiters, both selecting here with
 * the frameworks the corpus shows, so a hit no slot and no finding reads is a
 * hit nobody counted. A framework row may therefore live on any language,
 * whichever engine parses it.
 *
 * `adoptedCapabilities` is the one reader that takes hits without selecting
 * here, and it is framework-blind. It stays safe because a row may not carry
 * `framework` and `capability` at once, which `assertDeclaredFields` refuses:
 * otherwise off-framework hits would vote for a capability's adoption.
 *
 * `rows` is the list the selection runs over: the tree rows unless a caller
 * hands one in. A reader that wants an obligation or a filename row asks the
 * registry for it, because neither is a question asked of a walked tree.
 */
export function dimensionsFor(langs, { frameworks, tier = "syntactic", capabilities, rows = ALL_DIMENSIONS } = {}) {
  const known = frameworks ? new Set(frameworks) : null;
  // The same shape as frameworks: a routing claim is offered only where the
  // corpus shows a wrapper for it, and a caller that cannot know is offered
  // everything, whose extra hits go unread.
  const caps = capabilities ?? null;
  return rows.filter(
    (d) =>
      d.langs.some((l) => langs.includes(l)) &&
      // The tier is opt-in. A caller that does not ask for it must never be
      // handed a claim that needs a checker nobody ran.
      (tier === "all" || d.tier === tier) &&
      (!known || !d.framework || known.has(d.framework)) &&
      (!caps || !d.capability || caps.has(d.capability))
  );
}
