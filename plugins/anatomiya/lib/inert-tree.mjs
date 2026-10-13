/**
 * The reuse check's line rule for the tree-sitter languages, read off the
 * file's tree rather than its text (A91).
 *
 * A line asks nothing where it is blank, or everything on it is a closing
 * bracket, a separator, or part of a node that defines nothing callable: a
 * comment, an import, a package line, a docstring, or a name bound to a
 * literal. Every other line asks. Like the line rules it names what defines
 * nothing, so a shape nobody listed asks.
 *
 * The tree is walked with a cursor and deleted before this returns: a wasm tree
 * is never collected, and a copy of a large one costs more than its parse.
 */
import { LINE_READ } from "./limits.mjs";
import { SHAPES } from "./tree-shapes.mjs";
import { parseForLines } from "./tree-sitter-runtime.mjs";

// The words this grammar spells as identifiers where others have literal nodes.
const WORDS = new Set(["true", "false", "null"]);

// The only tokens that open nothing: a closing bracket, a separator and the end of a conditional. Any
// other may open a callable with no name on its line, as `get`, `func` and a lambda's `{` do.
const CLOSER = /^(?:[)\]};,]|#endif)$/;

// The one operator that joins types and computes nothing.
const UNION = "|";

// Where a language lists what each sign may stand before, the list a sign reads.
const SIGNS = { "-": "signed", "+": "signed", "~": "inverted", "!": "negated" };
// A sign before an unsigned number asks. Kotlin defines no `-` for one. C# defines both signs and
// takes the false ask, so one check serves both.
const UNSIGNED = /(?:u|ul|lu)$/i;
const BOOLEAN = /^(?:true|false)$/;

// An import of "C" alone, which makes the comment directly above it C code that cgo compiles.
const IMPORTS_C = /^(?:import\s*(?:\(\s*)?)?(?:"C"|`C`)(?:\s*\))?$/;
const NAMES_C = /["`]C["`]/;

// What makes inline markup code in another language.
const SCRIPT = /<script/i;

// The modifier under which the compiler admits no conversion a user wrote.
const CONSTANT = "const";

/** The nodes that hold no callable, by kind, read once per language. */
function rulesOf(lang) {
  const s = SHAPES[lang];
  const docstring = s.docstring ?? [];
  return {
    s,
    whole: new Set([...s.comment, ...s.import, ...(s.closes ?? [])]),
    header: new Set(s.header ?? []),
    markup: new Set(s.markup ?? []),
    preambleOf: new Set(s.preambleOf ?? []),
    binding: new Set(s.binding),
    declaration: new Set(s.declaration ?? []),
    docstring: docstring.length > 0 ? { statement: docstring[0], strings: new Set(docstring.slice(1)) } : null,
    literal: new Set(s.literal),
    literalPart: new Set(s.literalPart),
    builtin: new Set(s.builtin ?? []),
    nothing: new Set(s.nothing ?? []),
    word: new Set(s.word ?? []),
    unary: new Set(s.unary),
    collection: new Set(s.collection),
    comment: new Set(s.comment),
    part: new Set(s.part),
    union: new Set(s.union ?? []),
    bound: new Set(s.bound ?? []),
    statement: new Set(s.statement ?? []),
    counted: new Set(s.counted ?? []),
    countedPart: new Set(s.countedPart ?? []),
    annotation: s.annotation,
    interpolation: s.interpolation ?? [],
    bare: s.bareInterpolation ?? [],
  };
}

const RULES = new Map();
const rulesFor = (lang) => RULES.get(lang) ?? RULES.set(lang, rulesOf(lang)).get(lang);

// The walk reads the clock once in this many nodes: a read costs more than a node does.
const CLOCK_EVERY = 4096;
// One walk runs at a time and never yields, so its clock is held here and not passed to every reader,
// beside the file's root and where each of its annotations starts, searched for once.
const clock = { deadline: Infinity, left: CLOCK_EVERY, root: null, annotations: null };

/** Counts `nodes` read, and throws once the walk has run past its deadline. */
function tick(nodes = 1) {
  if ((clock.left -= nodes) > 0) return;
  clock.left = CLOCK_EVERY;
  if (performance.now() > clock.deadline) throw new Error("past the deadline");
}

/** A search of a whole subtree, counted as the nodes it reads. */
function within(node, types) {
  tick(node.descendantCount);
  return node.descendantsOfType(types);
}

function named(node) {
  tick();
  return node.namedChildren.filter(Boolean);
}

function interpolates(node, r) {
  if (r.interpolation.length > 0 && within(node, r.interpolation).length > 0) return true;
  return r.bare.length > 0 && within(node, r.bare).some((n) => n.text === "$");
}

/** Whether a literal holds its own text and nothing else: an interpolation, however it is spelt, is no part of one. */
const textOnly = (node, r) => named(node).every((n) => (r.literal.has(n.type) || r.literalPart.has(n.type)) && textOnly(n, r));

/** Whether a value is a literal: a number, a string that interpolates nothing, a word, or a collection of literals. */
function isLiteral(node, r) {
  const type = node.type;
  if (r.literal.has(type)) return !interpolates(node, r) && textOnly(node, r);
  if (r.word.has(type)) return WORDS.has(node.text);
  const parts = named(node).filter((n) => !r.comment.has(n.type));
  if (r.unary.has(type)) return parts.length === 1 && isLiteral(parts[0], r) && paired(node, parts[0], r);
  if (!r.collection.has(type)) return false;
  // A composite literal's type says what it builds: it is read as a type, and the rest as values.
  const typed = r.s.collectionType ? node.childForFieldName(r.s.collectionType) : null;
  return parts.every((n) => (n.id === typed?.id ? plain(n, r.part, r) : isLiteral(n, r)));
}

/** Whether a sign stands before what its language pairs it with, where it lists pairs: any other pair may be a user's operator. */
function paired(node, operand, r) {
  if (r.s.signed === undefined) return true;
  const list = SIGNS[node.firstChild.type];
  if (list === undefined || node.childCount !== 2 || !(r.s[list] ?? []).includes(operand.type)) return false;
  return list === "negated" ? BOOLEAN.test(operand.text) : list !== "signed" || !UNSIGNED.test(operand.text);
}

/**
 * Whether a node holds an annotation: whether one starts inside it. The file is
 * searched once for all of them, since bindings nest and a search under each
 * reads a deep file once per level.
 */
function annotated(node, r) {
  if (r.annotation.length === 0) return false;
  const starts = (clock.annotations ??= within(clock.root, r.annotation).map((n) => n.startIndex));
  let [low, high] = [0, starts.length];
  while (low < high) {
    const mid = (low + high) >> 1;
    if (starts[mid] < node.startIndex) low = mid + 1;
    else high = mid;
  }
  return low < starts.length && starts[low] < node.endIndex;
}

/**
 * Whether every named node of a subtree is a literal or one of `types`, a kind
 * listed as computing nothing. An operator is listed for the one that joins
 * types, and any other computes.
 */
function plain(node, types, r) {
  if (!types.has(node.type)) return isLiteral(node, r);
  if (r.union.has(node.type) && node.children.some((n) => n && !n.isNamed && n.type !== UNION)) return false;
  return named(node).every((n) => r.comment.has(n.type) || plain(n, types, r));
}

/** Whether a target introduces names and nothing else: a name, or a pattern holding only names. */
const binds = (node, r) => r.bound.has(node.type) && named(node).every((n) => binds(n, r));

/**
 * Whether the type a literal is declared as may convert it with a function
 * somebody wrote, where the language has such conversions: any type but its
 * own, outside a constant. `parent` and `outer` are the two nodes that hold it.
 */
function converts(node, value, r, parent, outer) {
  if (r.s.declared === undefined || value === null || r.nothing.has(value.type)) return false;
  const holder = parent?.node ?? node.parent;
  const type = holder.childForFieldName(r.s.declared);
  if (type !== null && plain(type, r.builtin, r)) return false;
  return !named(outer?.node ?? holder.parent).some((n) => n.text === CONSTANT);
}

/**
 * A name bound to a literal, or a constant that repeats the one above it or
 * is counted off its place in a group. Every named node outside the value, in
 * the target, the pattern, the type and the modifiers, is a literal or a kind
 * listed as computing nothing, so a call in an array's length asks. So does a
 * literal its declared type may convert, a binding with no value, one with an
 * annotation, one that carries a block to run when it does not match, an
 * assignment that is part of a larger expression, and one whose target is
 * anything but names: a write through a member or a subscript may run a setter.
 * `parent` and `outer` are the node that holds it and the one that holds that,
 * each as `{ type, node }`: handed down, since the tree answers for a parent
 * by reading down from its root.
 */
function inertBinding(node, r, parent, outer) {
  if (annotated(node, r)) return false;
  if (r.statement.size > 0 && !r.statement.has(parent?.type) && !r.declaration.has(parent?.type)) return false;
  if (r.s.alternative && node.childForFieldName(r.s.alternative) !== null) return false;
  const own = r.s.value ? node.childForFieldName(r.s.value) : null;
  const counted = r.counted.has(node.type);
  const value = own ?? (counted ? null : node.lastNamedChild);
  if (value === null ? !counted : !(counted ? plain(value, r.countedPart, r) : isLiteral(value, r))) return false;
  if (converts(node, value, r, parent, outer)) return false;
  const target = r.s.target ? node.childForFieldName(r.s.target) : null;
  if (target !== null && !binds(target, r)) return false;
  return named(node).every((n) => n.id === value?.id || n.id === target?.id || r.comment.has(n.type) || plain(n, r.part, r));
}

/** Bindings, every one of them inert, beside modifiers and a type that compute nothing, and no other node. */
function inertDeclaration(node, r, parent) {
  if (annotated(node, r)) return false;
  const self = { type: node.type, node };
  return named(node).every((child) => {
    if (r.binding.has(child.type)) return inertBinding(child, r, self, parent);
    if (r.declaration.has(child.type)) return inertDeclaration(child, r, self);
    return r.comment.has(child.type) || plain(child, r.part, r);
  });
}

function inertNode(node, r, parent, outer) {
  const type = node.type;
  // A group of imports that holds a comment and "C" is read inside, where the comment may stand on that import.
  if (r.preambleOf.has(type) && NAMES_C.test(node.text) && within(node, r.s.comment).length > 0) return false;
  if (r.whole.has(type)) return true;
  // An annotation on a package is still an annotation, which may run something.
  if (r.markup.has(type) && SCRIPT.test(node.text)) return false;
  if (r.header.has(type)) return !annotated(node, r);
  if (r.binding.has(type)) return inertBinding(node, r, parent, outer);
  if (r.declaration.has(type)) return inertDeclaration(node, r, parent);
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
 * runtime reads it. A file the grammar rejects, one whose parse or walk ran
 * past `deadline` and one the runtime failed on ask about every line but the
 * blank ones.
 */
export async function treeInertLines(source, lang, deadline, { grammars } = {}) {
  const lines = source.split("\n");
  const unread = () => lines.map((line) => line.trim() === "");
  try {
    const parsed = await parseForLines(source, lang, { cancel: () => performance.now() > deadline, ...(grammars ? { grammars } : {}) });
    if (parsed === null) return null;
    return parsed.tree ? walked(parsed.tree, lines, lang, deadline) : unread();
  } catch {
    // A trap or a heap at its cap, in the parse or the walk, or a walk past the deadline: nothing here
    // can say what the file holds, and a throw past here reaches the hook's boundary, which answers
    // nothing for the stop.
    return unread();
  }
}

/** The line rule over a parsed tree, which it deletes. It throws where the walk runs past `deadline`. */
function walked(tree, lines, lang, deadline) {
  const asks = new Array(lines.length).fill(false);
  const mark = ([from, to]) => {
    for (let row = from; row <= to; row++) asks[row] = true;
  };
  let cursor = null;
  try {
    const r = rulesFor(lang);
    cursor = tree.walk();
    Object.assign(clock, { deadline, left: CLOCK_EVERY, root: tree.rootNode, annotations: null });
    // Each open node, with its type, the node itself where the rule read it, and whether a named
    // node was seen under it: a named node with none is a leaf.
    const open = [];
    // The rows of the comments just read, where no line stands between them or after them.
    let comments = null;
    for (;;) {
      tick();
      const isNamed = cursor.nodeIsNamed;
      if (r.preambleOf.size > 0) {
        const [from, to] = rowsOf(cursor.startPosition, cursor.endPosition);
        if (r.comment.has(cursor.nodeType)) comments = comments !== null && from <= comments[1] + 1 ? [comments[0], to] : [from, to];
        else {
          if (comments !== null && from === comments[1] + 1 && r.preambleOf.has(cursor.nodeType) && IMPORTS_C.test(cursor.nodeText)) mark(comments);
          comments = null;
        }
      }
      if (isNamed && open.length > 0) open[open.length - 1].sawNamed = true;
      const candidate = isNamed && (r.whole.has(cursor.nodeType) || r.header.has(cursor.nodeType) || r.binding.has(cursor.nodeType) || r.declaration.has(cursor.nodeType) || cursor.nodeType === r.docstring?.statement);
      // An inert node's leaves are not read: none of them asks.
      const node = candidate ? cursor.currentNode : null;
      if (!(candidate && inertNode(node, r, open.at(-1), open.at(-2)))) {
        const rows = rowsOf(cursor.startPosition, cursor.endPosition);
        const type = cursor.nodeType;
        // A literal met here is under no inert node, and a row of its text may hold no token to ask for it.
        if (r.literal.has(type)) mark(rows);
        if (cursor.gotoFirstChild()) {
          open.push({ rows, type, node, isNamed, sawNamed: false });
          continue;
        }
        if (isNamed || !CLOSER.test(cursor.nodeType)) mark(rows);
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
    cursor?.delete();
    tree.delete();
  }
}
