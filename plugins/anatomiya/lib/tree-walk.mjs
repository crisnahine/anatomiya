/**
 * A tree-sitter tree as plain objects, and the one walk over them.
 *
 * The copy is what lets the wasm tree be deleted before any row runs: a node
 * read after its tree is deleted answers wrongly and does not throw. This
 * module is handed a tree and loads no parser.
 */
import { assertKeyed, hostedBy } from "./langs.mjs";
import { SHAPES } from "./tree-shapes.mjs";

const TEXT_CAP = 256;

assertKeyed("SHAPES", SHAPES, hostedBy("tree-sitter"));

const KINDS = new Map(
  Object.entries(SHAPES).map(([lang, { fn, cls }]) => [lang, new Map([...fn.map((type) => [type, "fn"]), ...cls.map((type) => [type, "cls"])])])
);

/**
 * Named nodes only, as `{ type, start, end, line, field?, text?, tokens?, children }`,
 * the root also carrying `lang`. Offsets are UTF-16 units into `source`.
 */
export function copyTree(tree, source, lang) {
  const tokensOf = new Set(SHAPES[lang].tokensOf);
  const open = [];
  let root = null;
  let line = 1;
  let newline = source.indexOf("\n");
  const close = (node) => {
    if (!node.children.length) node.text = source.slice(node.start, Math.min(node.end, node.start + TEXT_CAP));
  };

  // A cursor and a list of open nodes, not recursion: a recursive copy overflows the JS stack near 10,000 levels.
  const cursor = tree.walk();
  try {
    for (;;) {
      const parent = open.length ? open[open.length - 1] : null;
      if (cursor.nodeIsNamed) {
        const start = cursor.startIndex;
        // Nodes arrive in source order, so each newline is found once and counted against the first node past it.
        for (; newline !== -1 && newline < start; newline = source.indexOf("\n", newline + 1)) line++;

        const node = { type: cursor.nodeType, start, end: cursor.endIndex, line };
        const field = cursor.currentFieldName;
        if (field) node.field = field;
        node.children = [];
        if (parent) parent.children.push(node);
        else root = node;

        if (cursor.gotoFirstChild()) {
          open.push(node);
          continue;
        }
        close(node);
      } else if (tokensOf.has(parent.type)) {
        (parent.tokens ??= []).push(cursor.nodeType);
      }
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) {
          root.lang = lang;
          return root;
        }
        close(open.pop());
      }
    }
  } finally {
    cursor.delete();
  }
}

const LEAVE = Symbol("leave");

/**
 * One walk over a plain tree. `visit(node, ctx)` receives what `walkRuby`'s
 * visitor does, with `fn` where that has `def`:
 *   ctx.stack     enclosing functions and class bodies, outermost first
 *   ctx.enclosing innermost of those, or null at file level
 *   ctx.fn        innermost enclosing function or method, or null
 *   ctx.cls       innermost enclosing class body, or null
 *   ctx.ancestors every node above this one
 *
 * The arrays are live: a visitor copies what it keeps past its own call.
 */
export function walkTree(program, visit) {
  const kinds = KINDS.get(program.lang);
  if (!kinds) throw new Error(`no node names for a ${program.lang} tree`);
  const stack = [];
  const ancestors = [];
  const fns = [];
  const classes = [];
  const work = [program];

  while (work.length) {
    const node = work.pop();
    if (node === LEAVE) {
      const kind = kinds.get(ancestors.pop().type);
      if (kind) {
        stack.pop();
        (kind === "fn" ? fns : classes).pop();
      }
      continue;
    }

    visit(node, {
      stack,
      ancestors,
      enclosing: stack.length ? stack[stack.length - 1] : null,
      fn: fns.length ? fns[fns.length - 1] : null,
      cls: classes.length ? classes[classes.length - 1] : null,
    });

    const { children } = node;
    if (!children.length) continue;
    const kind = kinds.get(node.type);
    if (kind) {
      stack.push(node);
      (kind === "fn" ? fns : classes).push(node);
    }
    ancestors.push(node);
    work.push(LEAVE);
    for (let i = children.length - 1; i >= 0; i--) work.push(children[i]);
  }
}

/** The first child filling this field of the node, or null. */
export const fieldOf = (node, name) => node.children.find((child) => child.field === name) ?? null;

/** The one field every entry of the table puts a definition's name in. A table naming two is refused: `nameOf` reads one. */
export function nameFieldOf(shapes) {
  const names = [...new Set(Object.values(shapes).map((entry) => entry.name))];
  if (names.length !== 1) throw new Error(`SHAPES names a definition's name field ${names.join(" and ")}: nameOf reads one`);
  return names[0];
}

// Read off the table, so the test that holds the table to each grammar holds this.
const NAME = nameFieldOf(SHAPES);

/** The text of the field all seven grammars put a definition's name in. */
export const nameOf = (node) => fieldOf(node, NAME)?.text ?? null;

/** The `node` every consumer destructures off a hit, in the shape the other two engines emit. */
export function site(node) {
  return { type: node.type, name: nameOf(node), line: node.line, start: node.start, end: node.end };
}
