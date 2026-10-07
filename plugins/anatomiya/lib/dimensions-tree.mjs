// Rows over a tree-sitter tree. No row spells a node type: each asks `SHAPES` what its language calls the thing.
import { assertKeyed } from "./langs.mjs";
import { isTestFile } from "./layout.mjs";
import { treeFacets } from "./tree-facets.mjs";
import { SHAPES } from "./tree-shapes.mjs";
import { fieldOf, nameOf, site } from "./tree-walk.mjs";

const KINDS = [
  "fn", "cls", "scope", "wrap", "comment", "annotation", "inner", "directive", "catch", "raise", "ident", "variable",
  "block", "docstring", "doc", "args", "iface", "receiverType",
];
const SETS = new Map(
  Object.entries(SHAPES).map(([lang, shapes]) => [lang, Object.fromEntries(KINDS.map((kind) => [kind, new Set(shapes[kind] ?? [])]))])
);

const IDLE = { node() {} };

/** Whether a runner collects this file, off the facets the caller already read where it hands them over. */
const inTestFile = (program, { rel = "", facets } = {}) =>
  isTestFile({ rel, lang: program.lang, facets: facets ?? treeFacets(program, program.lang, rel) });

/** An annotation's own name, past its package and without its arguments. */
function annotationName(node, args) {
  let at = node;
  for (;;) {
    const named = at.children.filter((child) => !args.has(child.type));
    if (!named.length) return at.text ?? "";
    at = named.at(-1);
  }
}

/** The words ahead of a declaration's name: each modifier, and each annotation as `@Name`, those written above the function included. */
function headerOf(fn, ctx, sets, shapes) {
  const words = new Set();
  const work = [];
  const siblings = ctx.ancestors.at(-1).children;
  for (let i = siblings.indexOf(fn) - 1; i >= 0; i--) {
    if (sets.annotation.has(siblings[i].type)) work.push(siblings[i]);
    else if (!sets.comment.has(siblings[i].type)) break;
  }
  for (const child of fn.children) {
    if (child.field === shapes.name) break;
    work.push(child);
  }
  while (work.length) {
    const node = work.pop();
    for (const token of node.tokens ?? []) words.add(token);
    if (sets.annotation.has(node.type)) words.add(`@${annotationName(node, sets.args)}`);
    else if (!node.children.length) words.add(node.text);
    else work.push(...node.children);
  }
  return words;
}

/** Straight in the file, or in the body of a named class or module: what a function sits in, so a block, a lambda and an anonymous body all fall out. */
function standsAlone(ctx, sets) {
  if (ctx.fn !== null) return false;
  let at = ctx.ancestors.length - 1;
  while (sets.wrap.has(ctx.ancestors[at].type)) at--;
  return at === 0 || sets.cls.has(ctx.ancestors[at - 1].type) || sets.scope.has(ctx.ancestors[at - 1].type);
}

/** A Rust attribute written `name(word)` or `name(all(.., word, ..))`: `cfg(not(test))` and `cfg(any(test, x))` are neither. */
function attributeSays(item, sets, name, word) {
  const [attribute] = item.children;
  if (attribute?.children[0]?.text !== name) return false;
  let args = attribute.children.find((child) => sets.args.has(child.type));
  if (args?.children[0]?.text === "all") args = args.children[1];
  return args?.children.some((child) => child.text === word) === true;
}

// Rust keeps a file's unit tests in the file, and marks what it takes out of the documented surface.
const OUTSIDE = {
  rust: (item, sets) => attributeSays(item, sets, "cfg", "test") || attributeSays(item, sets, "doc", "hidden"),
};

/** Which nodes an attribute takes out of the documented surface, so the row passes over each and all it holds. */
function outside(lang, sets) {
  const says = OUTSIDE[lang];
  if (!says) return { note() {}, holds: () => false };
  const marked = new Set();
  return {
    note(node, ctx) {
      if (!sets.annotation.has(node.type) || !says(node, sets)) return;
      const parent = ctx.ancestors.at(-1);
      const after = parent.children.slice(parent.children.indexOf(node) + 1);
      const on = sets.inner.has(node.type) ? parent : after.find((n) => !sets.annotation.has(n.type) && !sets.comment.has(n.type));
      if (on) marked.add(on);
    },
    holds: (node, ctx) => marked.size > 0 && (marked.has(node) || ctx.ancestors.some((a) => marked.has(a))),
  };
}

/** The first node of one of these types under a node, in source order. */
function firstOf(node, types) {
  const work = [node];
  while (work.length) {
    const n = work.pop();
    if (types.has(n.type)) return n;
    for (let i = n.children.length - 1; i >= 0; i--) work.push(n.children[i]);
  }
  return null;
}

const capitalised = (name) => /^\p{Lu}/u.test(name);

/** A Go method is offered only where its receiver's type is: nobody outside the package can name the other kind. */
function goExports(name, fn, sets) {
  const receiver = fieldOf(fn, SHAPES.go.receiver);
  return capitalised(name) && (receiver === null || capitalised(firstOf(receiver, sets.receiverType)?.text ?? ""));
}

const HIDDEN = ["private", "protected", "internal"];
const shown = (words) => !HIDDEN.some((word) => words.has(word));

/** Public by each language's own rule. An interface's members are public where the language says so without a modifier. */
const PUBLIC = {
  python: (name) => !name.startsWith("_"),
  go: (name, words, inInterface, fn, sets) => goExports(name, fn, sets),
  // `pub(crate)` holds a node of its own, so only a bare `pub` is a word here.
  rust: (name, words) => words.has("pub"),
  php: (name, words) => shown(words),
  kotlin: (name, words) => shown(words),
  java: (name, words, inInterface) => words.has("public") || (inInterface && !words.has("private")),
  csharp: (name, words, inInterface) => words.has("public") || (inInterface && shown(words)),
};

// An override, and a Kotlin `actual`, take their name and their documentation from what they implement.
const INHERITED = ["@Override", "@override", "override", "actual"];
const inherited = (words) => INHERITED.some((word) => words.has(word));

// Documented on another function (an overload stub, a property's setter), or a test case written among the source.
const NOT_OFFERED = { python: ["@overload", "@setter", "@deleter"], rust: ["@test"] };

const BLOCK_DOC = /^\/\*\*(?!\/)/;
// What `go/ast` calls a directive: a comment the toolchain reads, which `go doc` leaves out.
const GO_DIRECTIVE = /^\/\/(?:[a-z0-9]+:[a-z0-9]|(?:line|export|extern) )/;

// `doc` reads a comment's opening, `attribute` an attribute that documents, and `tight` is Go's rule that a blank line detaches the comment.
const DOC = {
  php: { doc: (text) => BLOCK_DOC.test(text) },
  java: { doc: (text) => BLOCK_DOC.test(text) },
  kotlin: { doc: (text) => BLOCK_DOC.test(text) },
  csharp: { doc: (text) => /^\/\/\/(?!\/)/.test(text) || BLOCK_DOC.test(text) },
  go: { doc: (text) => !GO_DIRECTIVE.test(text), tight: true },
  rust: { attribute: /^#\[doc\s*=/ },
};

const LOOSE = /^\s*$/;
const TIGHT = /^[ \t]*\r?\n?[ \t]*$/;

/** Whether the comments, attributes and directive lines that end on the line above this function hold a doc comment. */
function documentedAbove(fn, ctx, sets, rule, source) {
  const siblings = ctx.ancestors.at(-1).children;
  const gap = rule.tight ? TIGHT : LOOSE;
  let below = fn;
  for (let i = siblings.indexOf(fn) - 1; i >= 0; i--) {
    const above = siblings[i];
    const comment = sets.comment.has(above.type);
    if (!comment && !sets.annotation.has(above.type) && !sets.directive.has(above.type)) return false;
    if (!gap.test(source.slice(above.end, below.start))) return false;
    if (!comment) {
      if (rule.attribute?.test(source.slice(above.start, above.end))) return true;
    } else {
      // Asked of the line, not of the node before: a Rust doc comment's node ends past its own line break.
      if (/\S/.test(source.slice(source.lastIndexOf("\n", above.start - 1) + 1, above.start))) return false;
      if (sets.doc.size > 0 ? above.children.some((child) => sets.doc.has(child.type)) : rule.doc(source.slice(above.start, above.start + 40))) return true;
    }
    below = above;
  }
  return false;
}

// Python makes a docstring of a plain string, raw or not, and of no f-string or bytes literal.
const PLAIN_STRING = /^[ru]?['"]/i;

/** A plain string that is the first statement of the body, with only comments ahead of it. */
function hasDocstring(fn, sets, source) {
  const body = fn.children.find((child) => sets.block.has(child.type));
  const first = body?.children.find((child) => !sets.comment.has(child.type));
  if (first === undefined || !sets.docstring.has(first.type) || first.children.length !== 1) return false;
  const [literal] = first.children;
  if (!sets.docstring.has(literal.type)) return false;
  const parts = literal.children.filter((child) => sets.docstring.has(child.type));
  return (parts.length ? parts : [literal]).every((part) => PLAIN_STRING.test(source.slice(part.start, part.start + 2)));
}

/** The name a catch clause binds, or null where it names a type alone. */
function caughtName(header, shapes, sets) {
  const holder = [...header, ...header.flatMap((child) => child.children)].find((node) => node.field === shapes.caught);
  return (holder && firstOf(holder, sets.ident)?.text) ?? null;
}

/** Whether anything under a handler's body reads the name, a closure's body included. A member spelling it reads nothing. */
function readsName(body, name, shapes, sets) {
  const reads = (node, parent) =>
    sets.variable.size > 0 ? sets.variable.has(parent.type) : !(node.field && (node.field === shapes.name || node.field === shapes.member));
  const work = [body];
  while (work.length) {
    const parent = work.pop();
    for (const node of parent.children) {
      if (node.children.length) work.push(node);
      else if (sets.ident.has(node.type) && node.text === name && reads(node, parent)) return true;
    }
  }
  return false;
}

// A constructor and a destructor declare no return type, and a Python dunder's is fixed by its protocol.
const UNTYPED = { python: /^__\w+__$/, php: /^__(?:construct|destruct)$/i };

// A function row reports the function's name as its site: a site is known again by its text, and a line added to the body would make an old function a new one.
export const TREE_DIMENSIONS = [
  {
    key: "caught_error_used",
    tier: "syntactic",
    claim: "exception handlers use the error they caught",
    counterClaim: null, // discarding the error is an absence, not a style anyone picked
    precision: "partial",
    applicabilityPredicate: {
      sites: "a PHP or Java file holding a catch clause that binds the error to a name, each such clause of a chain counted; a PHP clause that names a type and binds no name has used what it was given and is not a site. A clause uses the error when its body reads the name it bound, inside a closure or an interpolated string too, or when its body throws: the error again, or another in its place. A property, a field or a method spelling the same name reads nothing",
      blind: "a lambda, a closure or a nested handler that binds the same name again hides the caught one, and a read of the inner name counts as a read of the error",
    },
    langs: ["php", "java"],
    visitor(program, add) {
      const shapes = SHAPES[program.lang];
      const sets = SETS.get(program.lang);
      return {
        node(node, ctx) {
          if (!sets.catch.has(node.type)) return;
          const body = node.children.findLast((child) => sets.block.has(child.type));
          if (!body) return;
          const name = caughtName(node.children.filter((child) => child !== body && !sets.comment.has(child.type)), shapes, sets);
          if (name === null) return;
          const used = readsName(body, name, shapes, sets) || firstOf(body, sets.raise) !== null;
          add({ node: site(node), conforming: used, where: (ctx.fn && nameOf(ctx.fn)) ?? null });
        },
      };
    },
  },

  {
    key: "public_doc_comment",
    tier: "syntactic",
    claim: "public functions carry a doc comment",
    counterClaim: "public functions carry no doc comment",
    precision: "partial",
    applicabilityPredicate: {
      sites: "a function or method outside a test file, straight in the file or in the body of a named class or module (so not one inside a function, a block, an `if` or an anonymous class), that is public by its language's rule: in Python a name with no leading underscore, in Go a capitalised name, on a capitalised receiver type where it is a method, in Rust a bare `pub`, in PHP and Kotlin no private, protected or internal modifier, in Java and C# the `public` modifier or membership of an interface. A method marked as an override is not a site, nor is a Kotlin `actual` function, which is documented on its `expect`, a Python `@overload` stub or property setter or deleter, a Rust `#[test]` function, or anything under a Rust `#[cfg(test)]`, alone or inside `all(..)`, on an item or as `#![cfg(test)]` on the file, or under `#[doc(hidden)]`. A Rust trait's methods are not counted: a required one is a signature and a provided one carries no `pub`. It is documented by a docstring in Python, a plain string and never an f-string or bytes, and elsewhere by a doc comment in the comments and attributes that end on the line above it, a C# directive line between them passed over: `/** */` in PHP, Java and Kotlin, `///` or `/** */` in C# and Rust, `#[doc = \"..\"]` in Rust, and in Go any comment but a directive, with no blank line under it",
      blind: `whether the module or the class around a function is itself public is not read, so a function in a private module, under a non-public class or left out of \`__all__\` counts as public. Rust code inside a macro call is not in the tree, so a function written there is not counted`,
    },
    langs: ["python", "php", "go", "java", "csharp", "rust", "kotlin"],
    visitor(program, add, extra = {}) {
      if (inTestFile(program, extra)) return IDLE;
      const { source = "" } = extra;
      const lang = program.lang;
      const shapes = SHAPES[lang];
      const sets = SETS.get(lang);
      const out = outside(lang, sets);
      const notOffered = NOT_OFFERED[lang] ?? [];
      return {
        node(node, ctx) {
          out.note(node, ctx);
          if (!sets.fn.has(node.type) || !standsAlone(ctx, sets) || out.holds(node, ctx)) return;
          const named = fieldOf(node, shapes.name);
          const name = named?.text;
          if (!name) return;
          const words = headerOf(node, ctx, sets, shapes);
          if (!PUBLIC[lang](name, words, ctx.cls !== null && sets.iface.has(ctx.cls.type), node, sets)) return;
          if (inherited(words) || notOffered.some((word) => words.has(word))) return;
          const documented = sets.docstring.size > 0 ? hasDocstring(node, sets, source) : documentedAbove(node, ctx, sets, DOC[lang], source);
          add({ node: site(named), conforming: documented, where: name });
        },
      };
    },
  },

  {
    key: "declared_return_type",
    tier: "syntactic",
    claim: "functions declare what they return",
    counterClaim: "functions declare no return type",
    precision: "precise",
    applicabilityPredicate: {
      sites: "a Python or PHP file outside the tests declaring a named function or method, at any depth; a lambda, a closure and an arrow function carry no name and are not sites, and neither is a Python method named with double underscores on both sides or a PHP __construct or __destruct",
      blind: null,
    },
    langs: ["python", "php"],
    visitor(program, add, extra) {
      if (inTestFile(program, extra)) return IDLE;
      const shapes = SHAPES[program.lang];
      const sets = SETS.get(program.lang);
      const untyped = UNTYPED[program.lang];
      return {
        node(node) {
          if (!sets.fn.has(node.type)) return;
          const named = fieldOf(node, shapes.name);
          const name = named?.text;
          if (!name || untyped.test(name)) return;
          add({ node: site(named), conforming: fieldOf(node, shapes.returnType) !== null, where: name });
        },
      };
    },
  },
];

// Held to the rows that read them, here because a row's `langs` is the list: a
// language a row lists and a table lacks is a TypeError on its first file.
const asked = (key) => TREE_DIMENSIONS.find((row) => row.key === key).langs;
assertKeyed("PUBLIC", PUBLIC, asked("public_doc_comment"));
assertKeyed("DOC", DOC, asked("public_doc_comment").filter((lang) => !SHAPES[lang].docstring));
assertKeyed("NOT_OFFERED", NOT_OFFERED, [], asked("public_doc_comment"));
assertKeyed("OUTSIDE", OUTSIDE, [], asked("public_doc_comment"));
assertKeyed("UNTYPED", UNTYPED, asked("declared_return_type"));
