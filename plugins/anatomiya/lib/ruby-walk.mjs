/**
 * Reading a prism tree, with nothing here that knows how one is produced.
 *
 * Apart from the bridge that spawns Ruby, because both directions need these: a
 * dimension reads a tree the bridge hands it, and the bridge reads the facets
 * off the same tree before dropping it. Left in `ruby.mjs`, that second reader
 * would have to import the module importing it, and a cycle in `lib/` loads
 * under ESM hoisting and fails later, as a half-initialised binding.
 */

const DECL = new Set(["def", "class", "module", "singleton_class"]);

/**
 * A method this class or module defines on itself, instance or singleton.
 *
 * `def self.call` is how a good deal of Ruby spells an entry point, and four
 * measured migration files are written that way. A def on any other receiver
 * belongs to that object rather than to the body it is sitting in.
 */
export const ownDef = (n) => n.t === "def" && (!n.receiver || n.receiver.t === "self");

/**
 * One walk over a prism tree, carrying the chain of declarations enclosing
 * every node, exactly as the oxc walk does.
 *
 * Scope attribution comes from the traversal rather than from a second pass: a
 * match holding a byte offset and no enclosing declaration needs an interval
 * join to answer "which method", and prism counts UTF-8 bytes where oxc counts
 * UTF-16 code units, so that join is the one place the two engines' conventions
 * could silently mix. There are no offsets in this tree to mix.
 *
 * A block is not a declaration: `items.each do |i| ... end` inside a method
 * still reports that method, which is what a human reading the map wants.
 *
 * `visit(node, ctx)` receives:
 *   ctx.stack     enclosing declarations, outermost first
 *   ctx.enclosing innermost enclosing declaration, or null at file level
 *   ctx.def       innermost enclosing method definition, or null
 *   ctx.cls       innermost enclosing class or module, or null
 *   ctx.ancestors every node above this one, blocks included
 */
export function walkRuby(ast, visit) {
  const stack = [];
  const ancestors = [];

  const step = (node) => {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      for (const child of node) step(child);
      return;
    }
    if (typeof node.t !== "string") return;

    const isDecl = DECL.has(node.t);
    visit(node, {
      stack,
      ancestors,
      enclosing: stack.length ? stack[stack.length - 1] : null,
      def: last(stack, (n) => n.t === "def"),
      cls: last(stack, (n) => n.t === "class" || n.t === "module"),
    });

    if (isDecl) stack.push(node);
    ancestors.push(node);
    for (const key of Object.keys(node)) step(node[key]);
    ancestors.pop();
    if (isDecl) stack.pop();
  };

  step(ast);
}

function last(stack, pred) {
  for (let i = stack.length - 1; i >= 0; i--) if (pred(stack[i])) return stack[i];
  return null;
}

/**
 * The `node` every consumer destructures off a hit, in the one shape the JS
 * dimensions also emit.
 *
 * `start` and `end` are null rather than absent: B5 forbids an offset here at
 * all, and an absent bound would make a consumer's `source.slice(start, end)`
 * hand back the whole file as the matched text. `type` plus `name` is what
 * stays of a site's identity without one.
 */
export const site = (n) => ({
  type: n.t,
  name: typeof n.name === "string" ? n.name : null,
  line: typeof n.line === "number" ? n.line : null,
  start: null,
  end: null,
});

/** The arguments of a call, and none for anything that is not one. */
export const args = (call) => call?.arguments?.arguments ?? [];

/** Statements written directly in a body, skipping the statements wrapper. */
export function bodyOf(node) {
  const b = node && node.body;
  if (!b) return [];
  if (Array.isArray(b)) return b;
  if (b.t === "statements") return Array.isArray(b.body) ? b.body : [];
  return [b];
}

/** The dotted name of a constant reference: Foo, or ActiveRecord::Base. */
export function constName(node) {
  if (!node) return null;
  if (node.t === "constant_read") return node.name ?? null;
  if (node.t === "constant_path") {
    const parent = constName(node.parent);
    return parent ? `${parent}::${node.name}` : (node.name ?? null);
  }
  return null;
}
