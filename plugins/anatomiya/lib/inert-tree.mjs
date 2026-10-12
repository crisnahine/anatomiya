/**
 * The reuse check's line rule for the tree-sitter languages, read off the
 * file's tree rather than its text (A91).
 *
 * A line asks nothing where it is blank, holds only anonymous tokens (a
 * closing bracket, `else:`), or every named leaf on it sits under a node that
 * defines nothing callable: a comment, an import, a package line, a docstring,
 * or a name bound to a literal. Every other line asks. Like the line rules it
 * names what defines nothing, so a shape nobody listed asks.
 *
 * The tree is walked with a cursor and deleted before this returns: a wasm tree
 * is never collected, and a copy of a large one costs more than its parse.
 */
import { SHAPES } from "./tree-shapes.mjs";
import { parseForLines } from "./tree-sitter-runtime.mjs";

// Past this a line asks unread, as it does in the line rules.
const LINE_READ = 400;

// The words this grammar spells as identifiers where others have literal nodes.
const WORDS = new Set(["true", "false", "null"]);

/** The nodes that hold no callable, by kind, read once per language. */
function rulesOf(lang) {
  const s = SHAPES[lang];
  const docstring = s.docstring ?? [];
  return {
    s,
    whole: new Set([...s.comment, ...s.import]),
    header: new Set(s.header ?? []),
    binding: new Set(s.binding),
    declaration: new Set(s.declaration ?? []),
    docstring: docstring.length > 0 ? { statement: docstring[0], strings: new Set(docstring.slice(1)) } : null,
    literal: new Set(s.literal),
    word: new Set(s.word ?? []),
    unary: new Set(s.unary),
    collection: new Set(s.collection),
    comment: new Set(s.comment),
    annotation: s.annotation,
    interpolation: s.interpolation ?? [],
    bare: s.bareInterpolation ?? [],
  };
}

const RULES = new Map();
const rulesFor = (lang) => RULES.get(lang) ?? RULES.set(lang, rulesOf(lang)).get(lang);

const named = (node) => node.namedChildren.filter(Boolean);

function interpolates(node, r) {
  if (r.interpolation.length > 0 && node.descendantsOfType(r.interpolation).length > 0) return true;
  return r.bare.length > 0 && node.descendantsOfType(r.bare).some((n) => n.text === "$");
}

/** Whether a value is a literal: a number, a string that interpolates nothing, a word, or a collection of literals. */
function isLiteral(node, r) {
  const type = node.type;
  if (r.literal.has(type)) return !interpolates(node, r);
  if (r.word.has(type)) return WORDS.has(node.text);
  const parts = named(node).filter((n) => !r.comment.has(n.type));
  if (r.unary.has(type)) return parts.length === 1 && isLiteral(parts[0], r);
  if (!r.collection.has(type)) return false;
  // A composite literal's type says what it builds and is no value.
  const typed = r.s.collectionType ? node.childForFieldName(r.s.collectionType) : null;
  return parts.every((n) => (typed !== null && n.id === typed.id) || isLiteral(n, r));
}

const annotated = (node, r) => r.annotation.length > 0 && node.descendantsOfType(r.annotation).length > 0;

/** A name bound to a literal, with no annotation on it. A binding with no value asks. */
function inertBinding(node, r) {
  if (annotated(node, r)) return false;
  const value = (r.s.value ? node.childForFieldName(r.s.value) : null) ?? node.lastNamedChild;
  return value !== null && isLiteral(value, r);
}

/** Bindings beside the modifiers and the type they share, every one of them inert. */
function inertDeclaration(node, r) {
  if (annotated(node, r)) return false;
  return named(node).every(
    (child) => (r.binding.has(child.type) ? inertBinding(child, r) : r.declaration.has(child.type) ? inertDeclaration(child, r) : true)
  );
}

function inertNode(node, r) {
  const type = node.type;
  if (r.whole.has(type)) return true;
  // An annotation on a package is still an annotation, which may run something.
  if (r.header.has(type)) return !annotated(node, r);
  if (r.binding.has(type)) return inertBinding(node, r);
  if (r.declaration.has(type)) return inertDeclaration(node, r);
  if (r.docstring !== null && type === r.docstring.statement) {
    const parts = named(node);
    return parts.length === 1 && r.docstring.strings.has(parts[0].type) && isLiteral(parts[0], r);
  }
  return false;
}

/** The rows a node covers, its last one left out where it ends at the start of a line. */
function rowsOf(start, end) {
  return [start.row, end.column === 0 && end.row > start.row ? end.row - 1 : end.row];
}

/**
 * Which of a file's lines define nothing callable, or null where no grammar or
 * runtime reads it. A file the grammar rejects, one whose parse ran past
 * `deadline` and one the runtime failed on ask about every line but the blank
 * ones.
 */
export async function treeInertLines(source, lang, deadline, { grammars } = {}) {
  const lines = source.split("\n");
  const unread = () => lines.map((line) => line.trim() === "");
  let parsed;
  try {
    parsed = await parseForLines(source, lang, { cancel: () => performance.now() > deadline, ...(grammars ? { grammars } : {}) });
  } catch {
    // A trap or a heap at its cap: nothing here can say what the file holds.
    return unread();
  }
  if (parsed === null) return null;
  if (!parsed.tree) return unread();
  const r = rulesFor(lang);
  const asks = new Array(lines.length).fill(false);
  const mark = ([from, to]) => {
    for (let row = from; row <= to; row++) asks[row] = true;
  };
  const tree = parsed.tree;
  const cursor = tree.walk();
  try {
    // Each open node, and whether a named node was seen under it: a named node with none is a leaf.
    const open = [];
    for (;;) {
      const isNamed = cursor.nodeIsNamed;
      if (isNamed && open.length > 0) open[open.length - 1].sawNamed = true;
      const candidate = isNamed && (r.whole.has(cursor.nodeType) || r.header.has(cursor.nodeType) || r.binding.has(cursor.nodeType) || r.declaration.has(cursor.nodeType) || cursor.nodeType === r.docstring?.statement);
      // An inert node's leaves are not read: none of them asks.
      if (!(candidate && inertNode(cursor.currentNode, r))) {
        const rows = rowsOf(cursor.startPosition, cursor.endPosition);
        if (cursor.gotoFirstChild()) {
          open.push({ rows, isNamed, sawNamed: false });
          continue;
        }
        if (isNamed) mark(rows);
      }
      for (;;) {
        if (cursor.gotoNextSibling()) break;
        if (!cursor.gotoParent()) {
          for (const node of open.reverse()) if (node.isNamed && !node.sawNamed) mark(node.rows);
          return lines.map((line, i) => line.trim() === "" || (!asks[i] && line.length <= LINE_READ));
        }
        const closed = open.pop();
        if (closed.isNamed && !closed.sawNamed) mark(closed.rows);
        // An anonymous node with a named one under it passes that on.
        else if (!closed.isNamed && closed.sawNamed && open.length > 0) open[open.length - 1].sawNamed = true;
      }
    }
  } finally {
    cursor.delete();
    tree.delete();
  }
}
