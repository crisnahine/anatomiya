import { walk, isFunctionLike, declName, value, boundNames, optionalChain, whereOf } from "./walk.mjs";

/**
 * The five base oxc rows, and the selection every engine's rows go through.
 *
 * Apart from `dimensions.mjs`, which composes every engine's tables, so a parse
 * child loads its own engine's rows and the selection, and nothing else.
 */

const isThrow = (n) => n.type === "ThrowStatement";
const isCatch = (n) => n.type === "CatchClause";
const CATCH = new Set(["CatchClause"]);
const LOOPS = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);
const NAMESPACE = new Set(["TSModuleDeclaration"]);

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
    // A nested scope binding the same name hides the caught one:
    // `catch (e) { items.forEach((e) => log(e)) }` logs each item and drops
    // the error, and read by name it counted as handling it. The catch body
    // itself cannot rebind its own parameter with let or const, so only the
    // scopes below it are asked.
    if (ctx.ancestors.some((a) => a !== body && scopeBinds(a, n.name))) return;
    used = true;
  });
  return used;
}

const paramNames = (fn) =>
  (fn.params || []).flatMap((p) => boundNames(p.type === "TSParameterProperty" ? p.parameter : p));

const lexical = (decl) => decl && decl.type === "VariableDeclaration" && decl.kind !== "var";

/** Whether this node opens a scope that binds `name` for everything beneath it. */
function scopeBinds(node, name) {
  if (isFunctionLike(node)) {
    return paramNames(node).includes(name) || (node.type === "FunctionExpression" && node.id?.name === name);
  }
  if (node.type === "CatchClause") return boundNames(node.param).includes(name);
  if (node.type === "ForStatement") return lexical(node.init) && declared(node.init, name);
  if (node.type === "ForOfStatement" || node.type === "ForInStatement") {
    return lexical(node.left) && declared(node.left, name);
  }
  if (node.type === "BlockStatement" || node.type === "StaticBlock") {
    return (node.body || []).some((s) => {
      // A `var` belongs to the function around it, and one written straight
      // into a catch body assigns the caught binding rather than hiding it.
      if (s.type === "VariableDeclaration") return lexical(s) && declared(s, name);
      return (s.type === "FunctionDeclaration" || s.type === "ClassDeclaration") && s.id?.name === name;
    });
  }
  return false;
}

const declared = (decl, name) => (decl.declarations || []).some((d) => boundNames(d.id).includes(name));

/**
 * The names this node assigns to, gathered over every node of the program.
 *
 * A member assignment binds nothing: `obj.x = 1` writes a property, which is the
 * distinction `usesParam` already draws for a catch parameter, and `boundNames`
 * has no member case so it falls out. A for-of or for-in head with no
 * declaration writes its target on every turn without declaring it.
 */
function noteAssigned(n, names) {
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
    // A closure inside the catch can be what reads the error.
    judgesBody: true,
    applicabilityPredicate: {
      sites: "a file holding at least one catch clause, whether or not it binds the error",
      blind: null,
    },
    langs: ["js", "jsx", "vue", "svelte"],
    visitor(program, add) {
      return {
        node(n, ctx) {
          if (!isCatch(n)) return;
          const names = boundNames(n.param);
          const handled = !bodyIsEmpty(n.body) && (usesParam(n.body, names) || hasRethrow(n.body));
          add({ node: n, conforming: handled, where: whereOf(ctx.enclosing, ctx) });
        },
      };
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
      sites: "a file that throws outside a catch, or returns a result: a Result.* call, an ok(), err(), Ok() or Err() call, or an object literal carrying an ok key, or one carrying an error or success key whose every key is error, success, data, value, result, valid or isValid. An object carrying any other key beside error is a view-model or state, not a result, and so is whatever getDerivedStateFromError returns",
      blind: "a throw inside a helper the caller wraps is invisible from the file that throws",
    },
    langs: ["js", "jsx", "svelte"],
    visitor(program, add) {
      // Every throw before every result, the order two walks gave.
      const results = [];
      return {
        node(n, ctx) {
          if (isThrow(n)) {
            // A rethrow inside a catch is deliberate, not a policy violation.
            const inCatch = ctx.within(CATCH);
            if (inCatch) return;
            return add({ node: n, conforming: false, where: whereOf(ctx.fn, ctx) });
          }
          if (n.type !== "ReturnStatement" || !n.argument) return;
          // React merges what this returns into component state, `{ error }` included.
          if (declName(ctx.fn) === "getDerivedStateFromError") return;
          if (!isResultShaped(value(n.argument))) return;
          results.push({ node: n, conforming: true, where: whereOf(ctx.fn, ctx) });
        },
        done() {
          for (const hit of results) add(hit);
        },
      };
    },
  },

  {
    key: "module_state_const",
    tier: "syntactic",
    claim: "module-level bindings are const",
    counterClaim: null, // the inverse is mutable module state, which no repository chose on purpose
    precision: "precise",
    applicabilityPredicate: {
      sites: "a file holding a variable declaration at module level, outside any loop and other than a using or await using; a let or var is one only where const was available, meaning every declarator is initialised and no name it binds is assigned or declared a second time anywhere in the file",
      blind: null,
    },
    langs: ["js", "jsx"],
    visitor(program, add) {
      const assigned = new Set();
      const bindings = new Map();
      const sites = [];
      return {
        node(n, ctx) {
          noteAssigned(n, assigned);
          if (n.type !== "VariableDeclaration") return;
          // Module level is exactly "no enclosing declaration". A top-level for
          // loop binding sits at module level by position and is not module
          // state, so it is excluded by its enclosing statement.
          if (ctx.enclosing !== null) return;
          if (ctx.within(LOOPS)) return;
          // `declare const x: number` binds nothing at run time, so it is not
          // state this claim is about either way, and a binding inside a
          // namespace or an ambient module is scoped to that block rather than to
          // the module.
          if (n.declare) return;
          if (ctx.within(NAMESPACE)) return;
          // `using r = open()` and `await using` dispose r when the module's
          // evaluation ends. The binding is already immutable, and the `const`
          // the violation asked for keeps it while dropping the disposal.
          if (n.kind === "using" || n.kind === "await using") return;
          sites.push(n);
          for (const d of n.declarations || []) {
            for (const name of boundNames(d.id)) bindings.set(name, (bindings.get(name) ?? 0) + 1);
          }
        },
        // Judged after the walk, because whether `const` was available needs the
        // whole file: the name may be assigned below the declaration, or declared
        // twice.
        done() {
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
      };
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
    judgesBody: true,
    applicabilityPredicate: {
      sites: "a file declaring at least one async function",
      blind: "a caller-level wrapper handling the failure is invisible from the function that fails",
    },
    langs: ["js", "jsx", "vue", "svelte"],
    visitor(program, add) {
      return {
        node(n, ctx) {
          if (!isFunctionLike(n) || !n.async) return;
          let handled = false;
          walk(n.body, (m, mctx) => {
            // Only a catch handles anything. A try with just a finally re-throws
            // once the cleanup runs, and lock, transaction and cleanup helpers
            // are written that way everywhere: counted, they stated this claim
            // at 80 of 80 over code that caught nothing.
            if (m.type !== "TryStatement" || !m.handler) return;
            // The handler must belong to THIS function, not to an inner arrow or
            // a nested method that happens to sit inside its byte range.
            if (mctx.enclosing !== null) return;
            handled = true;
          });
          add({ node: n, conforming: handled, where: whereOf(n, ctx) });
        },
      };
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
      notCounted:
        "a computed read, and one the grammar refuses ?. on: a write target, a new callee, a tagged tag",
      blind: "the receiver's name is the only signal of optionality this tier has, and it is a poor one: a measured 2,485-file repository writes ?. 2,627 times across 672 files, while this row sees 538 sites in 202 of them. A destructured or interface-declared optional carries none of the six names, and a read off a name that does carries one whether or not the value is optional. Answering it properly needs the checker, which knows whether a receiver's type includes null or undefined",
    },
    langs: ["js", "jsx"],
    visitor(program, add) {
      return {
        node(n, ctx) {
          if (n.type !== "MemberExpression") return;
          if (n.computed) return;
          const obj = n.object;
          if (!obj || obj.type !== "Identifier") return;
          if (!/^(opts|options|params|props|config|input)$/.test(obj.name)) return;
          // A read in a write position, a `new` callee or a tagged template's tag
          // cannot carry `?.` at all, so the conforming form does not exist there.
          if (!optionalChain(n, ctx.ancestors).allowed) return;
          add({ node: n, conforming: n.optional === true, where: whereOf(ctx.fn, ctx) });
        },
      };
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
  // An `error` key alone is not a result: a view-model hook hands its field
  // message out as `{ label, error, disabled }`. Without the `ok` discriminant,
  // every key has to be one a result is made of.
  if (node.type === "ObjectExpression") {
    const keys = node.properties.map((p) => (p.key && !p.computed ? p.key.name ?? p.key.value : null));
    if (keys.includes("ok")) return true;
    return keys.some((k) => k === "error" || k === "success") && keys.every((k) => RESULT_KEYS.has(k));
  }
  return false;
}

const RESULT_KEYS = new Set(["error", "success", "data", "value", "result", "valid", "isValid"]);

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
 * `rows` is the list the selection runs over, and the caller names it: the
 * registry's tree rows in the parent, one engine's own tables in a parse child,
 * so a child loads no other engine's rows. A reader that wants an obligation or a filename row asks the
 * registry for it, because neither is a question asked of a walked tree.
 */
export function dimensionsFor(langs, { frameworks, tier = "syntactic", capabilities, rows }) {
  const known = frameworks ? new Set(frameworks) : null;
  // The same shape as frameworks: a routing claim is offered only where the
  // corpus shows a wrapper for it, and a caller that cannot know is offered
  // everything, whose extra hits go unread.
  const caps = capabilities ?? null;
  return rows.filter(
    (d) =>
      d.langs.some((l) => langs.includes(l)) &&
      // A caller that does not ask for the semantic tier must never be handed
      // a claim that needs a checker nobody ran.
      (tier === "all" || d.tier === tier) &&
      (!known || !d.framework || known.has(d.framework)) &&
      (!caps || !d.capability || caps.has(d.capability))
  );
}
