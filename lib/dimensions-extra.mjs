import { walk, isFunctionLike, declName } from "./walk.mjs";

/**
 * More dimensions, same contract as `dimensions.mjs`: one claim, three
 * quantities, one `add` per candidate site, ratio over candidates (C1).
 *
 * These were chosen on measured variance, not on how cleanly they detect. A
 * claim that scores near 1.00 in every repository is a language default: it
 * teaches an agent nothing and still costs a line of always-loaded context, so
 * a candidate whose ratio did not move across repositories was dropped however
 * precise its predicate was. Measured on six repositories, every dimension here
 * spans at least 0.44 between its lowest and highest repository; the ones
 * dropped for flatness spanned 0.00 to 0.11.
 *
 * `precision: "partial"` (C5) marks a predicate that cannot see every site it
 * claims to, which under-counts applicability and so filters out exactly the
 * files that would have contradicted the claim. Each partial one below says
 * what it cannot see.
 *
 * `counterClaim` (C6) is what an area is told when it writes the other side.
 * It is a hand-written sentence rather than a flag because writing it out loud
 * is where an inverse that is really a defect becomes visible, and because a
 * machine negation names nothing for the agent to write. A dimension without
 * one can never state its inverse, whatever the counts say.
 */

const SOURCE_IMPORT = /\.(js|jsx|mjs|cjs|ts|tsx)$/;
const ASSET_IMPORT = /\.[a-z0-9]+$/i;

const isDefaultValue = (n) =>
  n &&
  (n.type === "Literal" ||
    n.type === "StringLiteral" ||
    n.type === "NumericLiteral" ||
    n.type === "BooleanLiteral" ||
    n.type === "NullLiteral" ||
    n.type === "TemplateLiteral" ||
    n.type === "ArrayExpression" ||
    n.type === "ObjectExpression");

const isNullLiteral = (n) =>
  n && ((n.type === "Literal" && n.value === null && !n.regex) || n.type === "NullLiteral");

const isUndefined = (n) =>
  n &&
  ((n.type === "Identifier" && n.name === "undefined") ||
    (n.type === "UnaryExpression" && n.operator === "void"));

/** The name being called in `f()` or in `a.f()`, whichever applies. */
function calleeName(node) {
  const c = node.callee;
  if (!c) return null;
  if (c.type === "Identifier") return c.name;
  if (c.type === "MemberExpression" && !c.computed && c.property) return c.property.name;
  return null;
}

/**
 * The identifier a non-computed member chain is rooted at: `assert` in both
 * `assert(x)` and `assert.strict.equal(x, y)`. Null once the chain reaches
 * anything else, so `expect(a).toBe(1)` is not attributed to `expect`; the
 * inner `expect(a)` call is the site that counts.
 */
function rootIdentifier(callee) {
  let n = callee;
  while (n && n.type === "MemberExpression" && !n.computed) n = n.object;
  return n && n.type === "Identifier" ? n.name : null;
}

// The forms a runner name may wear before its call: `test.each`, `it.skip`,
// `it.skip.each`. Any other property means the base identifier is a value that
// merely happens to be called `it` or `test`.
const TEST_MODIFIER = /^(each|only|skip|todo|failing|concurrent|skipIf|runIf|if|for)$/;

/** `it` or `test` when the callee is one of them, modifiers included. */
function testRunnerName(callee) {
  let n = callee;
  while (n && n.type === "MemberExpression") {
    if (n.computed || !n.property || !TEST_MODIFIER.test(n.property.name)) return null;
    n = n.object;
  }
  return n && n.type === "Identifier" ? n.name : null;
}

const isModuleSource = (n) =>
  n.type === "ImportDeclaration" ||
  n.type === "ExportNamedDeclaration" ||
  n.type === "ExportAllDeclaration";

/**
 * Node types that put everything beneath them in type position.
 * `TSAsExpression` is deliberately absent: in `x as Foo` only the `Foo` side is
 * a type, and treating the whole node as one would hide the value read of `x`.
 */
const TYPE_CONTEXT = new Set([
  "TSTypeAnnotation",
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "TSTypeReference",
  "TSTypeParameterInstantiation",
  "TSTypeParameterDeclaration",
  "TSInterfaceHeritage",
  "TSClassImplements",
]);

const inTypeContext = (ctx) => ctx.ancestors.some((a) => TYPE_CONTEXT.has(a.type));

/**
 * Names read as values anywhere in the file. An import is type-only when its
 * local name appears in type position and never here.
 */
function valueReads(program) {
  const names = new Set();
  walk(program, (n, ctx) => {
    if (n.type !== "Identifier" || inTypeContext(ctx)) return;
    const parent = ctx.ancestors[ctx.ancestors.length - 1];
    if (!parent) return;
    // The binding site is not a read, and a property key or a non-computed
    // member property spells the name without reading it.
    if (/^Import(Default|Namespace)?Specifier$/.test(parent.type)) return;
    if ((parent.type === "Property" || parent.type === "ObjectProperty") && parent.key === n && !parent.computed) return;
    if (parent.type === "MemberExpression" && parent.property === n && !parent.computed) return;
    names.add(n.name);
  });
  return names;
}

/**
 * The name to report a function-shaped site under. A method's name lives on
 * the `MethodDefinition` above it, not on the function it holds.
 */
function siteName(fn, ctx) {
  const own = declName(fn);
  if (own) return own;
  const e = ctx.enclosing;
  return e && (e.type === "MethodDefinition" || e.type === "PropertyDefinition")
    ? declName(e)
    : null;
}

/** Returns belonging to this function, not to an arrow nested inside its body. */
function ownReturns(fn) {
  const out = [];
  if (!fn.body || fn.body.type !== "BlockStatement") return out;
  walk(fn.body, (n, ctx) => {
    if (n.type === "ReturnStatement" && !ctx.fn) out.push(n);
  });
  return out;
}

export const EXTRA_DIMENSIONS = [
  {
    key: "function_style",
    claim: "module-level functions are declared with function, not assigned as arrows",
    counterClaim: "module-level functions are assigned as arrow consts, not declared with function",
    precision: "precise",
    // Measured 0.01 to 1.00 across six repositories, the widest of any
    // structural claim: one repository writes every module function as an
    // arrow const and another writes none of them that way.
    langs: ["js", "jsx"],
    run(program, add) {
      walk(program, (n, ctx) => {
        // Module level is "no enclosing declaration"; a function nested in
        // another one is that one's business.
        if (ctx.enclosing !== null) return;
        if (n.type === "FunctionDeclaration") {
          return add({ node: n, conforming: true, where: declName(n) });
        }
        if (n.type === "VariableDeclarator" && n.init && isFunctionLike(n.init)) {
          add({ node: n, conforming: false, where: n.id && n.id.name });
        }
      });
    },
  },

  {
    key: "explicit_return_type",
    claim: "exported functions declare their return type",
    // A plain JS file scores every site non-conforming by construction, so the
    // inverse is what the language did, not what the repository decided.
    counterClaim: null,
    precision: "partial", // a JS file counts as unannotated, and a typed wrapper hides the annotation
    langs: ["js", "jsx"],
    run(program, add) {
      walk(program, (n) => {
        if (n.type !== "ExportNamedDeclaration" && n.type !== "ExportDefaultDeclaration") return;
        const d = n.declaration;
        if (!d) return;
        // `export default () => 1` is as much a boundary as a named export, so
        // any function-like declaration counts, not only a declared one.
        if (isFunctionLike(d)) {
          return add({ node: d, conforming: !!d.returnType, where: declName(d) });
        }
        if (d.type !== "VariableDeclaration") return;
        for (const v of d.declarations || []) {
          if (!v.init || !isFunctionLike(v.init)) continue;
          // The annotation sits on the arrow or on the binding it is assigned
          // to, and either one states the boundary type.
          const typed = !!v.init.returnType || !!(v.id && v.id.typeAnnotation);
          add({ node: v, conforming: typed, where: v.id && v.id.name });
        }
      });
    },
  },

  {
    key: "type_only_import",
    claim: "imports used only as types are marked import type",
    counterClaim: "imports used only as types are imported without the type marker",
    precision: "partial", // a name used in both positions, or re-exported, is not decidable here
    langs: ["js", "jsx"],
    run(program, add) {
      const values = valueReads(program);
      const types = new Set();
      walk(program, (n, ctx) => {
        if (n.type === "Identifier" && inTypeContext(ctx)) types.add(n.name);
      });

      walk(program, (n) => {
        if (n.type !== "ImportDeclaration" || !n.specifiers) return;
        for (const s of n.specifiers) {
          const local = s.local && s.local.name;
          if (!local || !types.has(local) || values.has(local)) continue;
          add({ node: s, conforming: n.importKind === "type" || s.importKind === "type", where: null });
        }
      });
    },
  },

  {
    key: "import_extension",
    claim: "relative imports carry the file extension",
    counterClaim: "relative imports are written without the file extension",
    precision: "precise",
    langs: ["js", "jsx"],
    run(program, add) {
      walk(program, (n) => {
        if (!isModuleSource(n)) return;
        const src = n.source && n.source.value;
        if (typeof src !== "string" || !src.startsWith(".")) return;
        // A bundler query or hash is not part of the file name, and leaving it
        // on defeats both tests below: "./icon.svg?react" would count as a
        // source import missing its extension.
        const spec = src.replace(/[?#].*$/, "");
        // A directory specifier has no file name to carry an extension, so it
        // cannot conform and is not a choice anyone made.
        if (spec === "." || spec === ".." || spec.endsWith("/")) return;
        // A stylesheet or an image is always imported by its full name, so
        // counting it would report an extension convention no one chose.
        if (ASSET_IMPORT.test(spec) && !SOURCE_IMPORT.test(spec)) return;
        add({ node: n, conforming: SOURCE_IMPORT.test(spec), where: null });
      });
    },
  },

  {
    key: "nullish_default",
    claim: "defaults are taken with ??, not ||",
    counterClaim: null, // `||` swallows "" and 0; that is a correctness gradient, not an axis
    precision: "precise",
    langs: ["js", "jsx"],
    run(program, add) {
      walk(program, (n, ctx) => {
        if (n.type !== "LogicalExpression") return;
        if (n.operator !== "||" && n.operator !== "??") return;
        // Only a literal on the right is a default. `a || b()` is a fallback
        // branch, where the two operators are not interchangeable.
        if (!isDefaultValue(n.right)) return;
        add({ node: n, conforming: n.operator === "??", where: declName(ctx.fn) });
      });
    },
  },

  {
    key: "non_null_assertion",
    claim: "possibly-absent values are read with ?., not asserted with !",
    counterClaim: null, // the sentence would tell an agent to defeat the type checker
    precision: "partial", // a value narrowed by an if is a third form, invisible to both counts
    langs: ["js", "jsx"],
    run(program, add) {
      walk(program, (n, ctx) => {
        if (n.type === "TSNonNullExpression") {
          return add({ node: n, conforming: false, where: declName(ctx.fn) });
        }
        if ((n.type === "MemberExpression" || n.type === "CallExpression") && n.optional === true) {
          add({ node: n, conforming: true, where: declName(ctx.fn) });
        }
      });
    },
  },

  {
    key: "absent_is_null",
    claim: "an absent value is returned as null, not undefined",
    counterClaim: "an absent value is returned as undefined, not null",
    precision: "partial", // falling off the end of a function returns undefined with no site to count
    langs: ["js", "jsx"],
    run(program, add) {
      walk(program, (n, ctx) => {
        if (!isFunctionLike(n)) return;
        const where = siteName(n, ctx);
        if (n.body && n.body.type !== "BlockStatement") {
          // An expression body always yields a value, so `() => undefined` is
          // the violating twin of `() => null` and has to be counted with it.
          if (isNullLiteral(n.body)) add({ node: n, conforming: true, where });
          else if (isUndefined(n.body)) add({ node: n, conforming: false, where });
          return;
        }
        const returns = ownReturns(n);
        // A bare `return` is a guard clause: it says "stop here", not "an absent
        // value is spelled undefined". Counted, it built the opposite
        // convention out of early returns, and on the claim side it told an
        // agent to `return null` from a `useEffect`, which React forbids. Only
        // an explicit `undefined` is the other side of this choice.
        for (const r of returns) {
          if (isNullLiteral(r.argument)) add({ node: r, conforming: true, where });
          else if (r.argument && isUndefined(r.argument)) {
            add({ node: r, conforming: false, where });
          }
        }
      });
    },
  },

  {
    key: "iterate_with_for_of",
    claim: "collections are iterated with for...of, not .forEach",
    // `.forEach` cannot await, cannot break, and cannot return from the
    // enclosing function: a capability loss, not an axis, same as nullish_default.
    counterClaim: null,
    precision: "partial", // an indexed for loop is a third form the claim does not name
    langs: ["js", "jsx"],
    run(program, add) {
      walk(program, (n, ctx) => {
        if (n.type === "ForOfStatement") {
          return add({ node: n, conforming: true, where: declName(ctx.fn) });
        }
        if (n.type !== "CallExpression" || calleeName(n) !== "forEach") return;
        if (n.callee.type !== "MemberExpression") return;
        add({ node: n, conforming: false, where: declName(ctx.fn) });
      });
    },
  },

  {
    key: "test_call_style",
    claim: "test cases are declared with test(), not it()",
    counterClaim: "test cases are declared with it(), not test()",
    precision: "precise",
    langs: ["js", "jsx"],
    run(program, add) {
      walk(program, (n) => {
        if (n.type !== "CallExpression") return;
        // `test.each` and `it.skip` are the same choice, one member deeper.
        // Any other property means the base is an ordinary value: `it.trim()`
        // over a loop variable, or a regex `pattern.test()`.
        const name = testRunnerName(n.callee);
        if (name !== "it" && name !== "test") return;
        add({ node: n, conforming: name === "test", where: null });
      });
    },
  },

  {
    key: "assertion_style",
    claim: "assertions are written with expect()",
    counterClaim: "assertions are written with assert(), not expect()",
    precision: "partial", // an assertion behind a helper, or from a third library, is invisible
    langs: ["js", "jsx"],
    run(program, add) {
      walk(program, (n) => {
        if (n.type !== "CallExpression") return;
        const c = n.callee;
        if (c && c.type === "Identifier") {
          if (c.name === "expect") return add({ node: n, conforming: true, where: null });
          if (c.name === "assert") return add({ node: n, conforming: false, where: null });
          return;
        }
        // `assert.strict.equal` is the same library two members deep.
        if (rootIdentifier(c) === "assert") add({ node: n, conforming: false, where: null });
      });
    },
  },
];
