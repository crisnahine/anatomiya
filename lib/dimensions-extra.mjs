import { optionalChain, walk, isFunctionLike, declName, value } from "./walk.mjs";
import { jsxElementNames } from "./dimensions-jsx.mjs";

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

/**
 * The value inside its type wrappers.
 *
 * `null as any`, `null satisfies any`, `null!` and `<any>null` are all null,
 * and a walker that matches on the node type of an expression sees a
 * `TSAsExpression` instead. react returns an absent value behind a cast 24
 * times and vscode 20, and none of them were counted.
 *
 * Only for reading a value's shape. `non_null_assertion` is about the wrapper
 * itself and reads the node before this.
 */

const isDefaultValue = (node) => {
  const n = value(node);
  return (
    n &&
    (n.type === "Literal" ||
    n.type === "StringLiteral" ||
    n.type === "NumericLiteral" ||
    n.type === "BooleanLiteral" ||
    n.type === "NullLiteral" ||
    n.type === "TemplateLiteral" ||
      n.type === "ArrayExpression" ||
      n.type === "ObjectExpression")
  );
};

const isNullLiteral = (node) => {
  const n = value(node);
  return n && ((n.type === "Literal" && n.value === null && !n.regex) || n.type === "NullLiteral");
};

const isUndefined = (node) => {
  const n = value(node);
  return (
    n &&
    ((n.type === "Identifier" && n.name === "undefined") ||
      (n.type === "UnaryExpression" && n.operator === "void"))
  );
};

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
  const elements = jsxElementNames(program);
  walk(program, (n, ctx) => {
    const parent = ctx.ancestors[ctx.ancestors.length - 1];
    if (!parent) return;
    // A JSX element resolves its name through the same binding a call would, so
    // `<Button/>` reads Button as a value: a component also named in a type
    // position is not type-only, and `import type` there is TS1361. Which
    // JSXIdentifiers name an element is `jsxElementNames`' question, asked once
    // per file above rather than re-answered per node here.
    if (n.type === "JSXIdentifier") {
      if (elements.has(n.name)) names.add(n.name);
      return;
    }
    if (n.type !== "Identifier" || inTypeContext(ctx)) return;
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

/**
 * The declarations in this body that implement a TypeScript overload set.
 *
 * Held by node identity rather than by name, so a name colliding across scopes
 * cannot suppress the wrong declaration. Adjacency is the language's own rule
 * and not an approximation of it: TS2391 requires the implementation to
 * immediately follow its signatures, so this and "any signature of that name"
 * agree on every legal program and this is the stricter of the two on the rest.
 */
function overloadImplementations(program) {
  const impls = new Set();
  // Every statement list, not the program's alone: a function inside
  // `namespace N { }` or a block has no enclosing declaration either, so it is
  // a module-level site the exclusion has to reach.
  walk(program, (n) => {
    if (!Array.isArray(n.body)) return;
    let signature = null;
    for (const s of n.body) {
      const d = s && s.type === "ExportNamedDeclaration" && s.declaration ? s.declaration : s;
      if (!d || typeof d.type !== "string") {
        signature = null;
        continue;
      }
      if (d.type === "TSDeclareFunction") {
        signature = d.id?.name ?? null;
        continue;
      }
      if (d.type === "FunctionDeclaration" && signature !== null && d.id?.name === signature) impls.add(d);
      signature = null;
    }
  });
  return impls;
}

/**
 * The three hooks whose callback React reads as an effect.
 *
 * React's own warning names the refusal: "You returned null. If your effect
 * does not require clean up, return undefined."
 */
const EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"]);

const isEffectCallback = (fn, ctx) => {
  const p = ctx.ancestors[ctx.ancestors.length - 1];
  if (!p || p.type !== "CallExpression" || !(p.arguments || []).includes(fn)) return false;
  const c = p.callee;
  if (!c) return false;
  if (c.type === "Identifier") return EFFECT_HOOKS.has(c.name);
  return c.type === "MemberExpression" && !c.computed && !!c.property && EFFECT_HOOKS.has(c.property.name);
};

// `||` and `&&` are the two the grammar refuses to sit beside `??` unbracketed.
const mixesWithNullish = (n) =>
  !!n && n.type === "LogicalExpression" && (n.operator === "||" || n.operator === "&&");

// A React hook is named for the rule that governs it: the linter, the compiler
// and every doc read `use` plus a capital as the marker.
const HOOK_NAME = /^use[A-Z]/;

/**
 * The hooks a module exports under its own declarations.
 *
 * Read off `program.body` directly rather than through a walk, for the reason
 * `exported_symbol_case` gives: the one shape that nests an `export` inside
 * another node is a TypeScript ambient module, which is scaffolding for a
 * dependency rather than anything this module ships.
 */
function exportedHooks(program) {
  const out = [];
  // By name, because an overload set is several declarations of one hook: the
  // signatures and the implementation are one thing the module exports, and
  // counting them apart made a single overloaded hook a violation of the claim
  // that a module exports one.
  const seen = new Set();
  for (const n of program.body) {
    if (n.type !== "ExportNamedDeclaration") continue;
    const d = n.declaration;
    if (!d) continue;
    const take = (id) => {
      if (!id || id.type !== "Identifier" || !HOOK_NAME.test(id.name) || seen.has(id.name)) return;
      seen.add(id.name);
      out.push(id);
    };
    if (d.type === "VariableDeclaration") {
      for (const decl of d.declarations) take(decl.id);
    } else if (d.type === "FunctionDeclaration" || d.type === "TSDeclareFunction") {
      take(d.id);
    }
  }
  return out;
}

export const EXTRA_DIMENSIONS = [
  {
    key: "hook_per_module",
    tier: "syntactic",
    claim: "a module that exports a hook exports one",
    // The inverse is "put more than one hook in this file", which grows a
    // module rather than describing a habit anyone chose.
    counterClaim: null,
    precision: "partial",
    applicabilityPredicate: {
      sites: "a file exporting at least one declaration whose name starts with use and a capital, counted by name so an overload set is one hook; the module is one site, whatever the count",
      blind: "a hook re-exported through a specifier or a barrel is declared elsewhere and is not resolved to it, so a file that only re-exports several reads as exporting none",
    },
    langs: ["js", "jsx"],
    run(program, add) {
      const names = exportedHooks(program);
      if (!names.length) return;
      // The site is the module and the node is never the Program: the check
      // fingerprints a finding off the node's own text, so a Program node would
      // make that text the whole file and move it on every edit anywhere.
      const at = names.length > 1 ? names[1] : names[0];
      add({ node: at, conforming: names.length === 1, where: at.name });
    },
  },

  {
    key: "function_style",
    tier: "syntactic",
    claim: "module-level functions are declared with function, not assigned as arrows",
    counterClaim: "module-level functions are assigned as arrow consts, not declared with function",
    precision: "precise",
    applicabilityPredicate: {
      sites: "a file declaring a function at module level, either as a declaration or as a binding initialised with one; a declaration carrying TypeScript overload signatures is not one, because an overload set has no arrow form",
      blind: null,
    },
    // Measured 0.01 to 1.00 across six repositories, the widest of any
    // structural claim: one repository writes every module function as an
    // arrow const and another writes none of them that way.
    langs: ["js", "jsx"],
    run(program, add) {
      const overloads = overloadImplementations(program);
      walk(program, (n, ctx) => {
        // Module level is "no enclosing declaration"; a function nested in
        // another one is that one's business.
        if (ctx.enclosing !== null) return;
        if (n.type === "FunctionDeclaration") {
          // Overload signatures attach only to a declaration, so the
          // implementation carrying them has no arrow form to be written as.
          if (overloads.has(n)) return;
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
    tier: "syntactic",
    claim: "exported functions declare their return type",
    // A plain JS file scores every site non-conforming by construction, so the
    // inverse is what the language did, not what the repository decided.
    counterClaim: null,
    precision: "partial",
    applicabilityPredicate: {
      sites: "a file holding an export whose declaration is a function, or a variable declarator initialised with one",
      blind: "a plain JavaScript file has no annotation to find, and a typed wrapper hides the one the function has",
    },
    // The whole question is the annotation, so a tree whose annotations were
    // blanked can only answer it wrongly. `parse-worker.mjs` drops this row for
    // such a file rather than counting a confident zero.
    blindWhenStripped: true,
    // A plain .js or .jsx file has no annotation to find and cannot be given
    // one: `export function f(): number` is a SyntaxError under Node. Such a
    // file leaves this row's denominator rather than counting a zero nobody
    // could move, which is the same trade `blindWhenStripped` makes.
    needsTypeSyntax: true,
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
    tier: "syntactic",
    claim: "imports used only as types are marked import type",
    counterClaim: "imports used only as types are imported without the type marker",
    precision: "partial",
    applicabilityPredicate: {
      sites: "a file importing a name that appears in type position and is never read as a value",
      blind: "a name used in both positions, or re-exported, is not decidable from this file alone. A JSX element name reads as a value, so a lowercase host tag puts its own name in the value set and an imported type spelled the same stops being a site",
    },
    // The whole question is the annotation, so a tree whose annotations were
    // blanked can only answer it wrongly. `parse-worker.mjs` drops this row for
    // such a file rather than counting a confident zero.
    blindWhenStripped: true,
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
    tier: "syntactic",
    claim: "relative imports carry the file extension",
    counterClaim: "relative imports are written without the file extension",
    precision: "precise",
    applicabilityPredicate: {
      sites: "a file whose static import or re-export names a file through a relative specifier, once directory and asset specifiers are dropped. A dynamic import() is not a static one",
      blind: null,
    },
    // A type-only import is one of these sites, and the stripper deletes the
    // whole statement rather than blanking it. react writes 309 of them and not
    // one carries an extension, so a stripped file would report the imports
    // that survived and read as more conformant than the file is.
    blindWhenStripped: true,
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
    tier: "syntactic",
    claim: "defaults are taken with ??, not ||",
    counterClaim: null, // `||` swallows "" and 0; that is a correctness gradient, not an axis
    precision: "precise",
    applicabilityPredicate: {
      sites: "a file holding a || or ?? expression whose right side is a literal, an array or an object, and which is not part of an unbracketed chain mixing || or && with ??, since the grammar refuses those beside each other",
      blind: null,
    },
    langs: ["js", "jsx"],
    run(program, add) {
      walk(program, (n, ctx) => {
        if (n.type !== "LogicalExpression") return;
        if (n.operator !== "||" && n.operator !== "??") return;
        // Only a literal on the right is a default. `a || b()` is a fallback
        // branch, where the two operators are not interchangeable.
        if (!isDefaultValue(n.right)) return;
        // `??` may not sit beside `||` or `&&` without parentheses (TS5076), so
        // flipping this operator alone does not compile and adding the
        // parentheses changes the expression. oxc keeps them, so a chain
        // somebody already bracketed is still a site.
        if (n.operator === "||") {
          const parent = ctx.ancestors[ctx.ancestors.length - 1];
          if (mixesWithNullish(n.left) || mixesWithNullish(parent)) return;
        }
        add({ node: n, conforming: n.operator === "??", where: declName(ctx.fn) });
      });
    },
  },

  {
    key: "non_null_assertion",
    tier: "syntactic",
    claim: "possibly-absent values are read with ?., not asserted with !",
    counterClaim: null, // the sentence would tell an agent to defeat the type checker
    precision: "partial",
    applicabilityPredicate: {
      sites: "a file holding a non-null assertion that heads a member read or a call the grammar would let carry ?., or an optional member read or call",
      blind: "a value narrowed by an if is a third form neither count sees",
    },
    langs: ["js", "jsx"],
    run(program, add) {
      walk(program, (n, ctx) => {
        if (n.type === "TSNonNullExpression") {
          // `x!` standing alone has no `?.` form at all: `x?` is TS1109. One
          // sitting in a write position, a `new` callee or a tagged template's
          // tag heads a chain the grammar refuses to make optional.
          const { outer, allowed } = optionalChain(n, ctx.ancestors);
          if (outer === n || !allowed) return;
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
    tier: "syntactic",
    claim: "an absent value is returned as null, not undefined",
    counterClaim: "an absent value is returned as undefined, not null",
    precision: "partial",
    applicabilityPredicate: {
      sites: "a file holding a function that returns an explicit null or undefined, from a return statement or an expression body; a React effect callback is not one, because React refuses null there",
      blind: "falling off the end of a function returns undefined with no site to count, and a function annotated `: void` still counts although `return null` there is TS2322, because the annotation is what the Flow retry blanks and reading it would make the row answer differently on a stripped tree",
    },
    langs: ["js", "jsx"],
    run(program, add) {
      walk(program, (n, ctx) => {
        if (!isFunctionLike(n)) return;
        const where = siteName(n, ctx);
        // React refuses `return null` from an effect in its own words, so
        // `undefined` there says "stop" rather than "an absent value is spelled
        // undefined", which is the same thing a bare return says.
        //
        // The other function that cannot answer, one annotated `: void`, is
        // deliberately still counted: the annotation is what the Flow retry
        // blanks, so reading it would make the row answer differently on a
        // stripped tree than on the same file unstripped, and a base stripped
        // beside an unstripped head would then cancel real findings. One
        // measured site is not worth that.
        // Both arms, which is what the sentence says and what the reason
        // argues: React refuses null there, so a `return null` in an effect is
        // not this repository choosing how it spells an absent value either.
        // Guarding only the undefined arms put those in the conforming
        // numerator of a row whose predicate says an effect is not a site.
        if (isEffectCallback(n, ctx)) return;
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
          else if (r.argument && isUndefined(r.argument)) add({ node: r, conforming: false, where });
        }
      });
    },
  },

  {
    key: "iterate_with_for_of",
    tier: "syntactic",
    claim: "collections are iterated with for...of, not .forEach",
    // `.forEach` cannot await, cannot break, and cannot return from the
    // enclosing function: a capability loss, not an axis, same as nullish_default.
    counterClaim: null,
    precision: "partial",
    applicabilityPredicate: {
      sites: "a file holding a for...of statement or a .forEach called on something",
      blind: "an indexed for loop is a third form the claim does not name and neither count reaches, and whether a receiver can be iterated at all is a tsconfig question (target, downlevelIteration, whether lib includes DOM.Iterable) this tier cannot see: a NodeList under an ES5 target answers TS2495 to the for...of the claim asks for",
    },
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
    tier: "syntactic",
    claim: "test cases are declared with test(), not it()",
    counterClaim: "test cases are declared with it(), not test()",
    precision: "precise",
    applicabilityPredicate: {
      sites: "a file calling it or test, through any chain of runner modifiers such as each, only or skip",
      blind: null,
    },
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
    tier: "syntactic",
    claim: "assertions are written with expect()",
    counterClaim: "assertions are written with assert(), not expect()",
    precision: "partial",
    applicabilityPredicate: {
      sites: "a file calling expect or assert, including a member chain rooted at assert",
      blind: "an assertion behind a helper, or from a third library, carries neither name",
    },
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

  {
    key: "doc_comment_style",
    tier: "syntactic",
    // The scan reads the gap in the blanked copy and the check reads the
    // original blob, and a type-only statement between comment and export is
    // whitespace in one and text in the other, so a stripped file holds no
    // answer the two passes can agree on.
    blindWhenStripped: true,
    claim: "exported functions carry a doc comment",
    counterClaim: "code here explains itself; exported functions carry no doc comment",
    precision: "partial",
    applicabilityPredicate: {
      sites: "a file exporting a top-level function or class, by name, as a default, or as a function-valued const; a comment opening with a tool directive is not a doc comment on either side",
      blind: "a doc comment on a re-export, or attached through a wrapper, is not seen",
    },
    langs: ["js", "jsx"],
    run(program, add, extra = {}) {
      // Nearest-first once per file rather than once per export: the walk above
      // steps upward through the directives it skips, so the run has to arrive
      // in the order it is walked.
      const comments = [...(extra.comments || [])].sort((a, b) => b.end - a.end);
      const source = extra.source || "";
      const site = (n, name) =>
        add({ node: n, conforming: attachedAbove(comments, n.start, source), where: name ?? null });
      walk(program, (n) => {
        if (n.type === "ExportNamedDeclaration" && n.declaration) {
          const d = n.declaration;
          if (d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") return site(n, d.id?.name);
          const holder = d.type === "VariableDeclaration" &&
            d.declarations.find((x) => x.init && isFunctionLike(value(x.init)));
          if (holder) return site(n, holder.id?.name);
        }
        if (n.type === "ExportDefaultDeclaration") {
          const d = n.declaration;
          if (d && (isFunctionLike(d) || d.type === "ClassDeclaration")) site(n, "default");
        }
      });
    },
  },
];

/**
 * Whether any comment sits directly above the offset: nothing but whitespace
 * between them, and the comment opening its own line, or the previous
 * statement's trailing comment would read as the next one's doc.
 */
/**
 * Comments that instruct a tool rather than a reader.
 *
 * None of these is documentation on either side of the claim: one silences a
 * lint rule, one acknowledges a type gap the compiler enforces, one is a
 * compiler directive, one folds an editor region. An agent told to delete a
 * doc comment that is really an `eslint-disable` un-silences a rule CI
 * enforces, or deletes a `@ts-expect-error` and breaks the build. The list is
 * finite and each entry is recognisable from the comment text this dimension
 * already reads. Commented-out code is harder to recognise and stays counted.
 */
const DIRECTIVE_COMMENT =
  /^\s*(?:\/\s*<reference\b|eslint-|@ts-(?:expect-error|ignore|nocheck)\b|prettier-ignore\b|biome-ignore\b|istanbul\s+ignore\b|[cv]8\s+ignore\b|#(?:end)?region\b)/;

const isDirectiveComment = (c) => DIRECTIVE_COMMENT.test(c.value ?? "");

/**
 * Whether a doc comment sits directly above this declaration.
 *
 * The contiguous run above is walked upward rather than only its last member,
 * because a directive between a doc comment and the export it documents must
 * not detach it. Comments arrive nearest-first, so the first one past the
 * declaration is the one to ask, and anything with text between it and the
 * declaration ends the run.
 */
function attachedAbove(comments, start, source) {
  let edge = start;
  for (const c of comments) {
    if (c.end > edge) continue;
    if (!/^\s*$/.test(source.slice(c.end, edge))) return false;
    const lineStart = source.lastIndexOf("\n", c.start) + 1;
    if (!/^\s*$/.test(source.slice(lineStart, c.start))) return false;
    if (!isDirectiveComment(c)) return true;
    edge = c.start;
  }
  return false;
}
