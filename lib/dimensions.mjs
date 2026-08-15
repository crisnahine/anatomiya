import { walk, isFunctionLike, declName } from "./walk.mjs";
import { EXTRA_DIMENSIONS } from "./dimensions-extra.mjs";
import { RUBY_DIMENSIONS } from "./dimensions-ruby.mjs";
import { JSX_DIMENSIONS } from "./dimensions-jsx.mjs";
import { RAILS_DIMENSIONS } from "./dimensions-rails.mjs";

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

// Every name a catch parameter binds: `catch ({ code })` binds `code`, and
// reading only `param.name` would report that handler as ignoring the error.
function boundNames(pattern, out = []) {
  if (!pattern) return out;
  switch (pattern.type) {
    case "Identifier":
      out.push(pattern.name);
      break;
    case "ObjectPattern":
      for (const p of pattern.properties || []) {
        boundNames(p.type === "RestElement" ? p.argument : p.value, out);
      }
      break;
    case "ArrayPattern":
      for (const el of pattern.elements || []) boundNames(el, out);
      break;
    case "AssignmentPattern":
      boundNames(pattern.left, out);
      break;
    case "RestElement":
      boundNames(pattern.argument, out);
      break;
  }
  return out;
}

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

function bodyIsEmpty(block) {
  return !block || !Array.isArray(block.body) || block.body.length === 0;
}

export const DIMENSIONS = [
  {
    key: "swallowed_error",
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
        if (!isResultShaped(n.argument)) return;
        add({ node: n, conforming: true, where: declName(ctx.fn) });
      });
    },
  },

  {
    key: "module_state_const",
    claim: "module-level bindings are const",
    counterClaim: null, // the inverse is mutable module state, which no repository chose on purpose
    precision: "precise",
    applicabilityPredicate: {
      sites: "a file holding a variable declaration at module level, outside any loop",
      blind: null,
    },
    langs: ["js", "jsx"],
    run(program, add) {
      walk(program, (n, ctx) => {
        if (n.type !== "VariableDeclaration") return;
        // Module level is exactly "no enclosing declaration". A top-level for
        // loop binding sits at module level by position and is not module
        // state, so it is excluded by its enclosing statement.
        if (ctx.enclosing !== null) return;
        if (ctx.ancestors.some((s) => /^(For|While|DoWhile)/.test(s.type))) return;
        add({ node: n, conforming: n.kind === "const", where: null });
      });
    },
  },

  {
    key: "async_error_handling",
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
    claim: "optional values are read with ?.",
    // The one predicate that has already produced a measured false convention,
    // and it recognises an optional by the receiver's name. A second side would
    // state over the same names in the other direction.
    counterClaim: null,
    precision: "partial",
    applicabilityPredicate: {
      sites: "a file reading a non-computed member off a binding named opts, options, params, props, config or input",
      blind: "a destructured or interface-declared optional carries none of those receiver names",
    },
    langs: ["js", "jsx"],
    run(program, add) {
      walk(program, (n, ctx) => {
        if (n.type !== "MemberExpression") return;
        if (n.computed) return;
        const obj = n.object;
        if (!obj || obj.type !== "Identifier") return;
        if (!/^(opts|options|params|props|config|input)$/.test(obj.name)) return;
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

// The single registry. A dimension that is not reachable from here is not
// shipped, whichever file defines it.
export const ALL_DIMENSIONS = [
  ...DIMENSIONS,
  ...EXTRA_DIMENSIONS,
  ...RUBY_DIMENSIONS,
  ...JSX_DIMENSIONS,
  ...RAILS_DIMENSIONS,
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
  // Short enough that "files" or "n/a" passes as a sentence, long enough that
  // nothing anyone writes in earnest trips it. A word is not a predicate.
  const stated = (s) => typeof s === "string" && s.trim().length > 10;

  for (const d of rows) {
    const a = d.applicabilityPredicate;
    if (!a || !stated(a.sites)) {
      throw new Error(`dimension ${d.key} declares no applicabilityPredicate.sites: say which files could participate`);
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

assertPrecision(ALL_DIMENSIONS);
assertApplicability(ALL_DIMENSIONS);

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
 * unread; the reducer is what decides which dimensions get a slot.
 */
export function dimensionsFor(langs, { frameworks } = {}) {
  const known = frameworks ? new Set(frameworks) : null;
  return ALL_DIMENSIONS.filter(
    (d) => d.langs.some((l) => langs.includes(l)) && (!known || !d.framework || known.has(d.framework))
  );
}
