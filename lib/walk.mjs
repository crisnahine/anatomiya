import { createRequire } from "node:module";

/**
 * One walk over an oxc program that yields, for every node, the chain of
 * declarations enclosing it.
 *
 * Scope attribution is the reason the engine is a real parser rather than a
 * syntax matcher: a pattern matcher returns matches with no field naming the
 * containing function, so every per-method claim needs a second pass and a
 * byte-offset interval join. Here the walk maintains it.
 *
 * Walking outermost-first also gives containment collapse for free: a nested
 * match is visited after the node that contains it, so the outer one wins
 * without a separate dedup pass.
 */

const DECL = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassDeclaration",
  "ClassExpression",
  "MethodDefinition",
  "PropertyDefinition",
  "AccessorProperty",
]);

const SKIP = new Set(["start", "end", "type", "loc", "range", "parent"]);

/**
 * Which properties of each node type hold children, published by the parser
 * for all 165 types it emits.
 *
 * Required rather than imported, inside a try: this module is loaded by the
 * worker before the parser is, and an absent `oxc-parser` has to reach the
 * caller as the install error it is rather than as a worker that will not
 * start. Without the table every node falls back to `Object.keys`, which is
 * what the walk did before and is correct, only slower.
 */
const CHILD_KEYS = (() => {
  try {
    return createRequire(import.meta.url)("oxc-parser").visitorKeys ?? {};
  } catch {
    return {};
  }
})();

// A function carries no name of its own in `class C { m() {} }`, `{ m() {} }`
// or `const m = () => {}`: the name sits on the member or the declarator above
// it. The walk records that binding as it passes so every site inside the body
// still reports a name, rather than each dimension re-deriving it from the
// stack and three of them forgetting to.
const BINDS = new Set([
  "MethodDefinition",
  "PropertyDefinition",
  "AccessorProperty",
  "Property",
  "ObjectProperty",
  "VariableDeclarator",
]);
const NAMED = new WeakMap();

export function declName(node) {
  if (!node) return null;
  if (node.id && node.id.name) return node.id.name;
  // A computed key spells an expression, not a name: in `{ [status]: fn }` the
  // identifier `status` is the variable read, never what the member is called.
  if (node.computed) return NAMED.get(node) ?? null;
  if (node.key && node.key.name) return node.key.name;
  if (node.key && node.key.value != null) return String(node.key.value);
  return NAMED.get(node) ?? null;
}

function bind(node) {
  const child = node.value ?? node.init;
  if (!child || typeof child !== "object" || !isFn(child)) return;
  const name = declName(node);
  if (name) NAMED.set(child, name);
}

/**
 * Depth-first walk. `visit(node, ctx)` receives:
 *   ctx.stack     enclosing declaration nodes, outermost first
 *   ctx.ancestors every node above this one, outermost first, blocks included
 *   ctx.enclosing innermost enclosing declaration, or null at module level
 *   ctx.fn        innermost enclosing function-like, or null
 *   ctx.cls       innermost enclosing class, or null
 *
 * A null `enclosing` is how module-level state is identified, so it is a
 * meaningful value rather than a missing one.
 *
 * Both arrays are live and are unwound as the walk leaves a node, so a visitor
 * may read them but must copy anything it keeps past its own call.
 */
export function walk(program, visit) {
  const stack = [];
  const ancestors = [];
  // Explicit work stack, not recursion: an expression chain nests one AST level
  // per operand and measured overflowing the JS stack between 3,000 and 4,000
  // of them. A generated file reaches that, and the RangeError lands in the
  // reducer, where one file would abort the scan of every other. It is also
  // 1.6x faster than the recursive form on a real file.
  const work = [program];

  while (work.length) {
    const node = work.pop();

    if (node === LEAVE) {
      ancestors.pop();
      continue;
    }
    if (node === LEAVE_DECL) {
      ancestors.pop();
      stack.pop();
      continue;
    }
    if (!node || typeof node !== "object") continue;

    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) work.push(node[i]);
      continue;
    }
    if (typeof node.type !== "string") continue;

    const isDecl = DECL.has(node.type);
    if (BINDS.has(node.type)) bind(node);
    const ctx = {
      stack,
      ancestors,
      enclosing: stack.length ? stack[stack.length - 1] : null,
      fn: last(stack, isFn),
      cls: last(stack, isClass),
    };

    visit(node, ctx);

    if (isDecl) stack.push(node);
    ancestors.push(node);
    work.push(isDecl ? LEAVE_DECL : LEAVE);

    // The parser publishes, per node type, exactly which properties hold
    // children. Enumerating the object instead pushed every scalar too: on a
    // measured corpus 63% of the work stack was strings and numbers pushed and
    // discarded one iteration later, and using the published keys visits the
    // same 630,000 nodes 2.5x faster. `Object.keys` stays as the fallback for a
    // node type the table does not know, which no measured file produced.
    const keys = CHILD_KEYS[node.type];
    if (keys === undefined) {
      const all = Object.keys(node);
      for (let i = all.length - 1; i >= 0; i--) {
        if (SKIP.has(all[i])) continue;
        work.push(node[all[i]]);
      }
      continue;
    }
    for (let i = keys.length - 1; i >= 0; i--) {
      const child = node[keys[i]];
      if (child) work.push(child);
    }
  }
}

// Popped after a node's children, to undo what entering it pushed.
const LEAVE = Symbol("leave");
const LEAVE_DECL = Symbol("leave-decl");

const isFn = (n) =>
  n.type === "FunctionDeclaration" ||
  n.type === "FunctionExpression" ||
  n.type === "ArrowFunctionExpression";

const isClass = (n) => n.type === "ClassDeclaration" || n.type === "ClassExpression";

function last(stack, pred) {
  for (let i = stack.length - 1; i >= 0; i--) if (pred(stack[i])) return stack[i];
  return null;
}

export const isFunctionLike = isFn;

/**
 * Every dimension's sites for one tree, keyed for the reducer.
 *
 * Here rather than beside the registry it walks, because `dimensions-ruby.mjs`
 * takes the Ruby AST helpers from `ruby.mjs`, so a Ruby bridge that imported
 * the registry back would close a cycle. This module imports nothing of ours,
 * which is what lets both bridges reach it.
 *
 * One copy, because both parser bridges ran this loop and its one guarantee has
 * to hold in both: a dimension that throws on one odd tree costs that
 * dimension's count for this file, not the file and not the other twenty.
 *
 * A site keeps its conforming flag and the scope it sits in, and drops its
 * node. The reducer counts sites and names files, never positions, and on the
 * JavaScript side this crosses a process boundary where an AST serialises to
 * about 16x the source it came from.
 */
export function collectHits(program, dimensions, extra = {}) {
  const hits = {};
  for (const dim of dimensions) {
    const sites = [];
    try {
      dim.run(
        program,
        (hit) =>
          sites.push({
            conforming: !!hit.conforming,
            where: hit.where ?? null,
            // A learned-class dimension votes with its class; the reducer
            // decides the majority, so conforming is settled there, not here.
            ...(hit.class ? { class: hit.class } : {}),
            // Which enclosing body a site belongs to, on the rows whose site is
            // the body rather than the construct. Stable within this parse and
            // meaningless outside it, which is all the reducer asks of it.
            ...(hit.group === undefined || hit.group === null ? {} : { group: hit.group }),
          }),
        // The tree's own side channel: the comments the parser reported and the
        // exact string it parsed, for the rows whose question the tree alone
        // cannot answer. Same string, never the disk buffer (B5).
        extra
      );
    } catch {
      continue;
    }
    if (sites.length) hits[dim.key] = sites;
  }
  return hits;
}

/**
 * The value inside its type wrappers.
 *
 * `null as any`, `null satisfies any`, `null!` and `<any>null` are all null,
 * and a walker matching on an expression's node type sees the wrapper instead.
 * Here rather than beside one dimension, because three files read values and
 * the first version of this lived in one of them: `error_shape` kept matching
 * the raw argument and stopped counting `return { ok: true } as Result`, which
 * is the ordinary way to write it in a typed repository.
 *
 * Only for reading a value's shape. A dimension whose site is the wrapper
 * itself, like `non_null_assertion`, reads the node before this.
 */
export const value = (n) => {
  let out = n;
  while (
    out &&
    (out.type === "TSAsExpression" ||
      out.type === "TSSatisfiesExpression" ||
      out.type === "TSNonNullExpression" ||
      out.type === "TSTypeAssertion" ||
      out.type === "TSInstantiationExpression" ||
      out.type === "ParenthesizedExpression")
  ) {
    out = out.expression;
  }
  return out;
};
