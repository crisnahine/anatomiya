// Rows over a tree-sitter tree. No row spells a node type: each asks `SHAPES` what its language calls the thing.
import { addPathSites, namesWellKnown } from "./stems.mjs";
import { implementsCapability } from "./dimensions-capability.mjs";
import { assertKeyed, familyOf } from "./langs.mjs";
import { isTestFile } from "./layout.mjs";
import { dirOf, escapeRe } from "./paths.mjs";
import { underTestTree } from "./test-shape.mjs";
import { treeFacets } from "./tree-facets.mjs";
import { SHAPES } from "./tree-shapes.mjs";
import { fieldOf, lastLeaf, nameOf, site } from "./tree-walk.mjs";

const KINDS = [
  "fn", "cls", "scope", "wrap", "comment", "annotation", "inner", "directive", "catch", "raise", "ident", "variable",
  "block", "docstring", "doc", "args", "iface", "receiverType", "receiverBeforeName", "paren", "property", "label", "reference", "conditional",
  "import", "route", "routeArgs", "argument", "array", "string", "stringText", "quote",
  "inherits", "superList", "superCall", "superType", "generic", "typeArgs", "splat", "filter", "templateText", "namedArgument", "initializer", "initializerEntry", "template", "outputCall", "outputArgs", "printStatement",
];
const SETS = new Map(
  Object.entries(SHAPES).map(([lang, shapes]) => [lang, Object.fromEntries(KINDS.map((kind) => [kind, new Set(shapes[kind] ?? [])]))])
);

const IDLE = { node() {} };

// Where each child sits among its parent's children, built once for a parent. Every function asks it, and a search
// of the siblings for each took 2.2 s on 40,000 functions in one file, where their parse took 0.5.
const PLACES = new WeakMap();

function placeAmong(parent, child) {
  let places = PLACES.get(parent);
  if (!places) PLACES.set(parent, (places = new Map(parent.children.map((node, i) => [node, i]))));
  return places.get(child);
}

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
  for (let i = placeAmong(ctx.ancestors.at(-1), fn) - 1; i >= 0; i--) {
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
const inTests = (item, sets) => attributeSays(item, sets, "cfg", "test");
const OUTSIDE = {
  rust: (item, sets) => inTests(item, sets) || attributeSays(item, sets, "doc", "hidden"),
};
// What holds a file's own tests, in a language that keeps them in the file.
const TEST_ITEMS = { rust: inTests };

/** The first node after an attribute among its siblings that is neither an attribute nor a comment, or null. */
function standsOn(parent, attribute, sets) {
  for (let i = placeAmong(parent, attribute) + 1; i < parent.children.length; i++) {
    const next = parent.children[i];
    if (!sets.annotation.has(next.type) && !sets.comment.has(next.type)) return next;
  }
  return null;
}

/**
 * Whether another attribute standing on the item `own` stands on `says` so, above it or below: the
 * attributes and comments run unbroken up to their item, so only that run is read.
 */
function besideOwn(says, own, container, sets) {
  const kids = container.children;
  const inRun = (node) => sets.annotation.has(node.type) || sets.comment.has(node.type);
  const said = (node) => sets.annotation.has(node.type) && says(node, sets);
  const at = placeAmong(container, own);
  for (let i = at - 1; i >= 0 && inRun(kids[i]); i--) if (said(kids[i])) return true;
  for (let i = at + 1; i < kids.length && inRun(kids[i]); i++) if (said(kids[i])) return true;
  return false;
}

/** Which nodes an attribute `says` marks, so a row passes over each and all it holds. */
function outside(says, sets) {
  if (!says) return { note() {}, holds: () => false };
  const marked = new Set();
  return {
    note(node, ctx) {
      if (!sets.annotation.has(node.type) || !says(node, sets)) return;
      const parent = ctx.ancestors.at(-1);
      const on = sets.inner.has(node.type) ? parent : standsOn(parent, node, sets);
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

/** The type a Go method is written on, `""` where the receiver names none, or null for a function with no receiver. */
const goReceiver = (fn, sets) => {
  const receiver = fieldOf(fn, SHAPES.go.receiver);
  return receiver === null ? null : (firstOf(receiver, sets.receiverType)?.text ?? "");
};

/** A Go method is offered only where its receiver's type is: nobody outside the package can name the other kind. */
function goExports({ name, fn, sets }) {
  const type = goReceiver(fn, sets);
  return capitalised(name) && (type === null || capitalised(type));
}

const HIDDEN = ["private", "protected", "internal"];
const shown = (words) => !HIDDEN.some((word) => words.has(word));

/**
 * Public by each language's own rule. An interface's members are public where the language says so without a modifier.
 *
 * Asked of one function as `{ name, fn, words, ctx, sets, inInterface }`, which is what `NO_SITE` is asked of too.
 */
const PUBLIC = {
  python: ({ name }) => !name.startsWith("_"),
  go: goExports,
  // `pub(crate)` holds a node of its own, so only a bare `pub` is a word here.
  rust: ({ words }) => words.has("pub"),
  // PHP reads a keyword without its case: `PRIVATE function` is private.
  php: ({ words }) => shown(new Set([...words].map((word) => word.toLowerCase()))),
  kotlin: ({ words }) => shown(words),
  java: ({ words, inInterface }) => words.has("public") || (inInterface && !words.has("private")),
  csharp: ({ words, inInterface }) => words.has("public") || (inInterface && shown(words)),
};

// The methods golint asks no doc comment of: `commonMethods` in golang/lint's lint.go, and the three of `sort.Interface` on a type that has all three.
const GO_COMMON_METHODS = new Set(["Error", "Read", "ServeHTTP", "String", "Write", "Unwrap"]);
const GO_SORT_METHODS = ["Len", "Less", "Swap"];

/** A Go method that satisfies a standard interface by its name. golint reads a package for the sortable types and this reads the file. */
function goNamedByInterface(program, sets) {
  // Each type's method names, read once: searched again for every method, 20,000 methods of one type took 13 s.
  const named = new Map();
  for (const node of program.children) {
    const type = sets.fn.has(node.type) ? goReceiver(node, sets) : null;
    if (type === null) continue;
    if (!named.has(type)) named.set(type, new Set());
    named.get(type).add(nameOf(node));
  }
  const sortable = (type) => GO_SORT_METHODS.every((name) => named.get(type).has(name));
  return ({ name, fn }) => {
    const type = goReceiver(fn, sets);
    return type !== null && (GO_COMMON_METHODS.has(name) || (GO_SORT_METHODS.includes(name) && sortable(type)));
  };
}

/** A node's text with every node of these types under it cut out. */
function textWithout(node, types, source) {
  let text = "";
  let at = node.start;
  const work = [node];
  while (work.length) {
    const n = work.pop();
    if (types.has(n.type)) {
      text += source.slice(at, n.start);
      at = n.end;
    } else {
      for (let i = n.children.length - 1; i >= 0; i--) work.push(n.children[i]);
    }
  }
  return text + source.slice(at, node.end);
}

/**
 * The receiver a Kotlin extension function is written on, as written with one space for each run of them and no comment, or null
 * for any other function. A comment is no part of the type, and its text would print in a finding as part of a name.
 */
function extendedType(fn, shapes, sets, source) {
  for (const child of fn.children) {
    if (child.field === shapes.name) return null;
    if (!sets.receiverBeforeName.has(child.type)) continue;
    // With no source the name would print as `.name`, which is no function's.
    if (!source) throw new TypeError("a receiver is read off the source, and this row was handed none");
    return textWithout(child, sets.comment, source).replace(/\s+/g, " ");
  }
  return null;
}

/**
 * What a function is written in: in Go its receiver's type, and else the nearest class around it that has a name or the type
 * a Rust `impl` is for, then in Kotlin the receiver an extension function is written on, read off `source`. Null at file
 * level with no receiver.
 */
function ownerOf(fn, ctx, shapes, sets, source) {
  if (shapes.receiver) return goReceiver(fn, sets) || null;
  const extended = extendedType(fn, shapes, sets, source);
  for (let i = ctx.stack.length - 1; i >= 0; i--) {
    const body = ctx.stack[i];
    if (!sets.cls.has(body.type)) continue;
    const implFor = shapes.implFor ? fieldOf(body, shapes.implFor) : null;
    const name = nameOf(body) ?? (implFor && firstOf(implFor, sets.receiverType)?.text);
    if (name) return extended === null ? name : within(name, extended);
  }
  return extended;
}

// A site is told from another of its text by the declaration around it, and two classes each hold a `run`.
const within = (owner, name) => (owner === null ? name : `${owner}.${name}`);

const PHP_BUILDS = /^__(?:construct|destruct)$/i;
const atTopOfFile = (ctx) => ctx.ancestors.length === 1;

// Public and still no site, as a question built once per file: what a runtime calls and no reader looks up, a constructor, and a
// method whose interface names it. A Java, C# or Kotlin constructor is no function to its grammar and never reaches this.
const NO_SITE = {
  go: goNamedByInterface,
  php: () => ({ name }) => PHP_BUILDS.test(name),
  java: () => ({ name, words }) => name === "main" && words.has("static"),
  csharp: () => ({ name, words }) => name === "Main" && words.has("static"),
  rust: () => ({ name, ctx }) => name === "main" && atTopOfFile(ctx),
  kotlin: () => ({ name, ctx }) => name === "main" && atTopOfFile(ctx),
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

/**
 * Whether the comments, attributes and directive lines that end on the line above this function hold a doc comment.
 *
 * A conditional that opens on the function is passed over as a directive line is: the comment above it is the function's, which
 * is what the same file answers when it is read with one branch kept.
 */
function documentedAbove(fn, ctx, sets, rule, source, shapes) {
  let depth = ctx.ancestors.length - 1;
  let siblings = ctx.ancestors[depth].children;
  const gap = rule.tight ? TIGHT : LOOSE;
  let below = fn;
  for (let i = placeAmong(ctx.ancestors[depth], fn) - 1; i >= 0; i--) {
    const above = siblings[i];
    const comment = sets.comment.has(above.type);
    if (!gap.test(source.slice(above.end, below.start))) return false;
    if (!comment && !sets.annotation.has(above.type) && !sets.directive.has(above.type)) {
      const holder = ctx.ancestors[depth];
      if (!sets.conditional.has(holder.type) || above.field !== shapes.condition) return false;
      below = holder;
      siblings = ctx.ancestors[--depth].children;
      i = placeAmong(ctx.ancestors[depth], holder);
      continue;
    }
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
  let [literal] = first.children;
  // `("doc")` is the string to Python, at any depth of parentheses.
  while (literal && sets.paren.has(literal.type)) literal = literal.children.find((child) => !sets.comment.has(child.type));
  if (!literal || !sets.docstring.has(literal.type)) return false;
  const parts = literal.children.filter((child) => sets.docstring.has(child.type));
  return (parts.length ? parts : [literal]).every((part) => PLAIN_STRING.test(source.slice(part.start, part.start + 2)));
}

/** The name a catch clause binds, or null where it names a type alone; with no field to say, the clause's first name. */
function caughtName(header, shapes, sets) {
  if (!shapes.caught) return header.find((node) => sets.ident.has(node.type))?.text ?? null;
  const holder = [...header, ...header.flatMap((child) => child.children)].find((node) => node.field === shapes.caught);
  return (holder && firstOf(holder, sets.ident)?.text) ?? null;
}

/**
 * Whether anything under a handler's body reads the name, a closure's body included. A member spelling it reads nothing, and
 * neither does a property read off a class or declared in one, an annotation's argument or its name, a label, a case's
 * constant, or the method a reference names: only what the reference is taken from, its first child, is read.
 */
function readsName(body, name, shapes, sets) {
  const spelled = [shapes.name, shapes.member, shapes.key];
  const named = (node, parent) =>
    sets.label.has(parent.type) ||
    (sets.reference.has(parent.type) && node !== parent.children[0]) ||
    (sets.namedArgument.has(parent.type) && node === parent.children[0] && parent.tokens?.includes("=") === true);
  const reads = (node, parent) =>
    sets.variable.size > 0 ? sets.variable.has(parent.type) : !(node.field && spelled.includes(node.field)) && !named(node, parent);
  // tree-sitter-kotlin 1.1.0 reads `"$e"` as text, a `$` piece and then one starting with the name; `"${e}"` it parses.
  const templated = sets.templateText.size > 0 ? new RegExp(`^${escapeRe(name)}(?![\\p{L}\\p{N}_])`, "u") : null;
  const work = [[body, null]];
  while (work.length) {
    const [parent, above] = work.pop();
    for (const [i, node] of parent.children.entries()) {
      if (sets.property.has(parent.type) && node.field === shapes.name && sets.variable.has(node.type)) continue;
      if (above && sets.initializer.has(above.type) && sets.initializerEntry.has(parent.type) && node.field === shapes.initialized && sets.ident.has(node.type)) continue;
      if (node.children.length) work.push([node, parent]);
      else if (sets.ident.has(node.type) && node.text === name && reads(node, parent)) return true;
      else if (templated && sets.templateText.has(node.type) && parent.children[i - 1]?.text === "$" && templated.test(node.text)) return true;
    }
  }
  return false;
}

// A constructor and a destructor declare no return type, and a Python dunder's is fixed by its protocol.
const UNTYPED = { python: /^__\w+__$/, php: PHP_BUILDS };

// A name that says the handler binds nothing, as `_` says it: of the names IntelliJ's Java inspection (`ignored?[A-Za-z\d]*`)
// and detekt's `SwallowedException` (`_|(ignore|expected).*`) pass over, only this one is read.
const UNBOUND = { java: new Set(["ignored"]), kotlin: new Set(["_", "ignored"]), python: new Set(["_"]), csharp: new Set(["_"]) };

/** A string's text where it is written whole, with whether the walk cut it, or null: an interpolation, an escape or a concatenation is built. */
function wholeString(node, sets) {
  if (!sets.string.has(node.type)) return null;
  let text = "";
  let cut = false;
  for (const child of node.children) {
    if (sets.quote.has(child.type)) continue;
    if (!sets.stringText.has(child.type) || child.children.length) return null;
    text += child.text;
    cut ||= child.text.length < child.end - child.start;
  }
  return { text, cut };
}

/** The values a route's path may be: its first positional argument where `positional`, and any named in `keys`, an array element by element. */
function pathValues(list, { positional = true, keys = [] }, shapes, sets) {
  const values = [];
  let first = positional;
  for (const arg of list.children) {
    if (sets.comment.has(arg.type)) continue;
    const wrapped = sets.argument.has(arg.type);
    const key = wrapped && shapes.key ? (fieldOf(arg, shapes.key)?.text ?? null) : null;
    const value = wrapped ? arg.children.at(-1) : arg;
    if (key === null) {
      if (!first) continue;
      first = false;
    } else if (!keys.includes(key)) continue;
    values.push(...(sets.array.has(value.type) ? value.children : [value]));
  }
  return values;
}

const VERBS = ["get", "post", "put", "patch", "delete", "head", "options"];
const PY_DECORATORS = new Set([...VERBS, "route", "api_route", "websocket"]);
const PY_PREFIXES = new Map([["APIRouter", "prefix"], ["include_router", "prefix"], ["Blueprint", "url_prefix"], ["register_blueprint", "url_prefix"]]);
const SPRING_MAPPINGS = new Set(["GetMapping", "PostMapping", "PutMapping", "PatchMapping", "DeleteMapping", "RequestMapping"]);
const ASPNET_ATTRIBUTES = new Set(["Route", "HttpGet", "HttpPost", "HttpPut", "HttpPatch", "HttpDelete", "HttpHead", "HttpOptions"]);
const MINIMAL_API = new Set(["MapGet", "MapPost", "MapPut", "MapPatch", "MapDelete", "MapGroup", "MapMethods"]);
const RUST_ATTRIBUTES = new Set([...VERBS, "route"]);
const RUST_CALLS = new Set(["route", "nest", "mount", "resource", "scope"]);
// Django's `re_path` and `url` take a regular expression, which is no path.
const DJANGO_URLS = /^(?:from\s+django\.urls\s+import|import\s+django\.urls)\b/;

/**
 * Which arguments of a call or an annotation declare a route's path, by its name and whether it sits on a declaration;
 * `{ client: true }` for an annotation marking its class's mappings as another service's; or null.
 * `slash` asks the path to start with `/`, where the name alone is some other library's too, and `topLevel` asks the
 * declaration's class to be no other class's member.
 */
const ROUTE_FORMS = {
  python: (name, onDeclaration, django) => {
    if (onDeclaration) return PY_DECORATORS.has(name) ? { slash: true, keys: ["path", "rule"] } : null;
    if (name === "add_url_rule") return { slash: true, keys: ["rule"] };
    if (name === "path" && django) return { keys: ["route"] };
    return PY_PREFIXES.has(name) ? { positional: false, keys: [PY_PREFIXES.get(name)], slash: true } : null;
  },
  // A Feign client's mappings name another service's routes.
  java: (name, onDeclaration) =>
    !onDeclaration ? null : SPRING_MAPPINGS.has(name) ? { keys: ["value", "path"] } : name === "FeignClient" ? { client: true } : null,
  // ASP.NET Core takes a public top-level class alone for a controller.
  csharp: (name, onDeclaration) =>
    onDeclaration ? (ASPNET_ATTRIBUTES.has(name.replace(/Attribute$/, "")) ? { keys: ["template"], topLevel: true } : null) : MINIMAL_API.has(name) ? { keys: ["pattern"] } : null,
  rust: (name, onDeclaration) => ((onDeclaration ? RUST_ATTRIBUTES : RUST_CALLS).has(name) ? { slash: true } : null),
};

// A C# base list names the base class first only where there is one, and an interface by convention starts `I` and a capital.
const INTERFACE_NAMED = /^I[A-Z]/;

// What a Python class lists among its bases and inherits no behaviour from: typing's markers, and `object`.
const PY_NOT_BASES = new Set(["object", "Generic", "Protocol"]);

/** The class a declaration inherits, by its last segment, or null where it names none. */
function baseOf(cls, lang, shapes, sets) {
  const holder = (shapes.superclass && fieldOf(cls, shapes.superclass)) || cls.children.find((child) => sets.superList.has(child.type));
  for (const child of holder?.children ?? []) {
    if (sets.argument.has(child.type) || sets.comment.has(child.type) || sets.splat.has(child.type)) continue;
    // Where a constructor call marks the class among the interfaces, only the specifier holding one is a base.
    const call = sets.superCall.size > 0 ? child.children.find((part) => sets.superCall.has(part.type)) : child;
    if (!call) continue;
    const named = sets.superType.size > 0 ? (call.children.find((part) => sets.superType.has(part.type)) ?? call) : call;
    // Its last segment, past a package or a namespace and without type arguments.
    const head = sets.generic.has(named.type) ? (fieldOf(named, shapes.genericBase) ?? named) : named;
    const base = lastLeaf(head, sets.typeArgs);
    if (lang === "python" && PY_NOT_BASES.has(base)) continue;
    return lang === "csharp" && INTERFACE_NAMED.test(base ?? "") ? null : base;
  }
  return null;
}

// What writes straight to the console, by the callee as written.
const PRINTS = {
  python: /^print$/,
  php: /^(var_dump|print_r|printf|var_export)$/,
  java: /^System\.(out|err)\.print(ln|f)?$/,
  csharp: /^(System\.)?Console\.(Write|WriteLine)$/,
  rust: /^(std::)?(println|print|eprintln|eprint|dbg)$/,
  kotlin: /^(kotlin\.io\.)?(println|print)$/,
  go: /^(fmt\.(Print|Println|Printf)|print|println)$/,
};
// Go's loggers are packages called by name: the standard library's, and the common ones.
const GO_LOGGERS = new Set(["log", "slog", "klog", "glog", "zap", "zerolog", "logrus"]);
// What writes a line in Go: a level or the standard library's `Print`, `Fatal` and `Panic`, each with its suffixes, and
// zerolog's `Msg` and `Send` that end a chain. `slog.String` and `zap.NewProduction` write nothing.
const GO_WRITE = /^((Print|Fatal|Panic|Trace|Debug|Info|Warn|Warning|Error|DPanic|Log)(f|ln|w|S|Context|Depth|Attrs)?|Msgf?|Send)$/;
// What writes through a logger: a level, or `log`, called on a receiver named for one. JUL's levels and the
// `Log`-prefixed ones of Microsoft.Extensions.Logging included.
const LOGGER = /^_*(log|logger|logging)$/i;
const LEVEL = /^(log)?(trace|debug|info|information|notice|warn|warning|error|critical|fatal|alert|emergency|exception|verbose|severe|fine|finer|finest)$|^log$/i;
const RUST_LOGGER = /^((log|tracing)::)?(trace|debug|info|warn|error|event|log)$/;

/** Text without what any `<...>` holds, nested ones included: `F<List<int>>` is `F`. */
function withoutTypeArgs(text) {
  let depth = 0;
  let kept = "";
  for (const char of text) {
    if (char === "<") depth++;
    else if (char === ">" && depth > 0) depth--;
    else if (depth === 0) kept += char;
  }
  return kept;
}

/** A call's callee as written, without blanks, type arguments, a nullable `?` or a macro's `!`. */
function calleeText(call, sets, source) {
  const args = call.children.find((child) => sets.outputArgs.has(child.type)) ?? call.children[1];
  return withoutTypeArgs(source.slice(call.start, args?.start ?? call.end).replace(/\s+/g, "")).replace(/[?!]/g, "");
}

/** Whether a piece outside the tags holds markup: not only blanks, and not a shebang line. */
function holdsMarkup(node) {
  if (node.children.length) return node.children.some(holdsMarkup);
  const text = (node.text ?? "").trim();
  return text !== "" && !text.startsWith("#!") && !text.startsWith("?>");
}

/** `print` where a call writes to the console, `log` where it writes through a logger, or null. */
function outputOf(call, lang, sets, source) {
  const callee = calleeText(call, sets, source);
  if (PRINTS[lang].test(callee)) return "print";
  if (lang === "rust") return RUST_LOGGER.test(callee) ? "log" : null;
  const parts = callee.split(/::|->|\.|\$/).filter(Boolean);
  if (lang === "go") {
    // `klog.V(2)` in `klog.V(2).Infof(...)` only picks the logger the outer call writes through.
    if (source[call.end] === ".") return null;
    // `caddy.Log().Info` and `logger.With(...).Info` write through a logger named earlier in the chain; zap's own package
    // functions, `zap.Error` among them, build fields.
    const names = parts.map((part) => part.replace(/(\[.*\])?\(.*\)$/, ""));
    const pkg = GO_LOGGERS.has(names[0]) && !(names[0] === "zap" && names.length === 2);
    return names.length > 1 && (pkg || names.slice(0, -1).some((name) => LOGGER.test(name))) && GO_WRITE.test(names.at(-1)) ? "log" : null;
  }
  return parts.length > 1 && LOGGER.test(parts.at(-2)) && LEVEL.test(parts.at(-1)) ? "log" : null;
}

// A function row reports the function's name as its site: a site is known again by its text, and a line added to the body would make an old function a new one.
// `where` carries the class beside the name, which is what tells a new `B.run` from the `A.run` under it.
export const TREE_DIMENSIONS = [
  {
    key: "caught_error_used",
    tier: "syntactic",
    claim: "exception handlers use the error they caught",
    counterClaim: null, // discarding the error is an absence, not a style anyone picked
    precision: "partial",
    applicabilityPredicate: {
      sites: "a PHP, Java, Python, C# or Kotlin file holding a catch clause that binds the error to a name (`except E as e` in Python), each such clause of a chain counted; a clause that names a type and binds no name has used what it was given and is not a site, and neither is a Java clause that binds `_` or names what it caught `ignored`, a Kotlin one naming it `_` or `ignored`, or a Python or C# one naming it `_`. A clause uses the error when its body reads the name it bound, inside a closure or an interpolated string too, `\"$e\"` in Kotlin among them, or a C# `when` filter reads it, or when its body throws: the error again, or another in its place, a bare `raise` and `throw;` included. A property, static or not, read or declared, a field, an attribute, a member after a dot or `::`, a method, a method reference's method, an annotation's argument name or its one argument, a named argument's name, a C# object initializer's member, a `case` constant or a label spelling the same name reads nothing",
      blind: "a lambda, a closure or a nested handler that binds the same name again hides the caught one, and a read of the inner name counts as a read of the error",
    },
    langs: ["php", "java", "python", "csharp", "kotlin"],
    visitor(program, add, { source } = {}) {
      const shapes = SHAPES[program.lang];
      const sets = SETS.get(program.lang);
      const unbound = UNBOUND[program.lang];
      return {
        node(node, ctx) {
          if (!sets.catch.has(node.type)) return;
          const body = node.children.findLast((child) => sets.block.has(child.type));
          if (!body) return;
          const name = caughtName(node.children.filter((child) => child !== body && !sets.comment.has(child.type)), shapes, sets);
          if (name === null || unbound?.has(name)) return;
          const filter = node.children.find((child) => sets.filter.has(child.type)) ?? null;
          const used = readsName(body, name, shapes, sets) || (filter !== null && readsName(filter, name, shapes, sets)) || firstOf(body, sets.raise) !== null;
          const held = ctx.fn && nameOf(ctx.fn);
          add({ node: site(node), conforming: used, where: held ? within(ownerOf(ctx.fn, ctx, shapes, sets, source), held) : null });
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
      sites: "a function or method outside a test file, straight in the file or in the body of a named class or module (so not one inside a function, a block, an `if` or an anonymous class), that is public by its language's rule: in Python a name with no leading underscore, in Go a capitalised name, on a capitalised receiver type where it is a method, in Rust a bare `pub`, in PHP and Kotlin no private, protected or internal modifier, in any case in PHP, in Java and C# the `public` modifier or membership of an interface. A method marked as an override is not a site, nor is a Kotlin `actual` function, which is documented on its `expect`, a Python `@overload` stub or property setter or deleter, a Rust `#[test]` function, or anything under a Rust `#[cfg(test)]`, alone or inside `all(..)`, on an item or as `#![cfg(test)]` on the file, or under `#[doc(hidden)]`. A Rust trait's methods are not counted: a required one is a signature and a provided one carries no `pub`. A constructor is not a site, a PHP `__construct` or `__destruct` among them, nor is an entry point: a static `main` in Java, a static `Main` in C#, a `main` at the top of a Kotlin or Rust file. A Go method named `Error`, `Read`, `ServeHTTP`, `String`, `Write` or `Unwrap` is not a site, nor is `Len`, `Less` or `Swap` on a type the file gives all three. It is documented by a docstring in Python, a plain string and never an f-string or bytes, in parentheses or not, and elsewhere by a doc comment in the comments and attributes that end on the line above it, a C# directive line between them passed over and so the `#if` line of a conditional that opens on the function: `/** */` in PHP, Java and Kotlin, `///` or `/** */` in C# and Rust, `#[doc = \"..\"]` in Rust, and in Go any comment but a directive, with no blank line under it",
      blind: `whether the module or the class around a function is itself public is not read, so a function in a private module, under a non-public class or left out of \`__all__\` counts as public. Rust code inside a macro call is not in the tree, so a function written there is not counted`,
    },
    langs: ["python", "php", "go", "java", "csharp", "rust", "kotlin"],
    visitor(program, add, extra = {}) {
      if (inTestFile(program, extra)) return IDLE;
      const { source = "" } = extra;
      const lang = program.lang;
      const shapes = SHAPES[lang];
      const sets = SETS.get(lang);
      const out = outside(OUTSIDE[lang], sets);
      const notOffered = NOT_OFFERED[lang] ?? [];
      const noSite = NO_SITE[lang]?.(program, sets) ?? (() => false);
      return {
        node(node, ctx) {
          out.note(node, ctx);
          if (!sets.fn.has(node.type) || !standsAlone(ctx, sets) || out.holds(node, ctx)) return;
          const named = fieldOf(node, shapes.name);
          const name = named?.text;
          if (!name) return;
          const words = headerOf(node, ctx, sets, shapes);
          const func = { name, fn: node, words, ctx, sets, inInterface: ctx.cls !== null && sets.iface.has(ctx.cls.type) };
          if (!PUBLIC[lang](func)) return;
          if (inherited(words) || notOffered.some((word) => words.has(word)) || noSite(func)) return;
          const documented = sets.docstring.size > 0 ? hasDocstring(node, sets, source) : documentedAbove(node, ctx, sets, DOC[lang], source, shapes);
          add({ node: site(named), conforming: documented, where: within(ownerOf(node, ctx, shapes, sets, source), name) });
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
        node(node, ctx) {
          if (!sets.fn.has(node.type)) return;
          const named = fieldOf(node, shapes.name);
          const name = named?.text;
          if (!name || untyped.test(name)) return;
          add({ node: site(named), conforming: fieldOf(node, shapes.returnType) !== null, where: within(ownerOf(node, ctx, shapes, sets, extra?.source), name) });
        },
      };
    },
  },
  {
    key: "endpoint_segment_case",
    tier: "syntactic",
    learnedClasses: true,
    claim: "URL path segments here are <style>",
    counterClaim: null, // the other side is another class, which the learning already picks
    precision: "partial",
    applicabilityPredicate: {
      sites:
        "a word of two or more words that spells a naming class, in a URL path a route declares as a string written whole: in Python a route decorator, `@x.get`, `post`, `put`, `patch`, `delete`, `head`, `options`, `route`, `api_route` or `websocket`, and `add_url_rule`, on a path starting with `/`, Django's `path`, by its first argument or `route=`, in a file importing django.urls, and the prefix of `APIRouter(prefix=)`, `include_router(prefix=)`, `Blueprint(url_prefix=)` and `register_blueprint(url_prefix=)` starting with `/`; in Java Spring's `@GetMapping`, `@PostMapping`, `@PutMapping`, `@PatchMapping`, `@DeleteMapping` and `@RequestMapping`, its first argument, `value=` or `path=`, an array element by element, on a method or a class, outside an interface marked `@FeignClient`, whose mappings are another service's, though a class nested in one maps its own; in C# `[Route]`, `[HttpGet]` and the other verbs, its first argument or `template:`, on a class no other class holds, since ASP.NET Core routes no nested class, and a minimal API's `MapGet`, `MapPost`, `MapPut`, `MapPatch`, `MapDelete`, `MapGroup` and `MapMethods`; in Rust actix's and rocket's `#[get]`, the other verbs and `#[route]`, and `.route`, `.nest`, `.mount`, `resource` and `scope`, on a path starting with `/`; outside a test file or a test tree. A parameter (`{id}`, `{id:int}`, `<int:pk>`, `<id>`, `[controller]`, `:id`, `*`) is the framework's syntax, a query or fragment ends the path, a URL with a scheme or a leading `//` is another site's, and what sits under `.well-known` on a class's own mapping or in a call's own arguments a standard names, so none of those is a site, while a class nested in one maps by its own; nor is a single word, `users` or `Users`, nor a Rust route in or on an item marked `#[cfg(test)]`, nor a Django `re_path` or `url`, which take a regular expression",
      blind: "a path built at run time, from an interpolated string (an f-string with a field), a concatenation, a constant or a helper call, or written with an escape, as a C# verbatim or raw string or a Rust raw string, names segments this never reads, a `.well-known` group held in a variable or chained ahead of the call does not reach the routes under it, and Starlette's `Route`, `Mount` and `WebSocketRoute` and ASP.NET's conventional `MapControllerRoute` and `MapRoute` are not read at all",
    },
    langs: ["python", "java", "csharp", "rust"],
    visitor(program, add, extra = {}) {
      if (inTestFile(program, extra) || underTestTree(dirOf(extra.rel ?? ""), familyOf(program.lang))) return IDLE;
      const shapes = SHAPES[program.lang];
      const sets = SETS.get(program.lang);
      const testItem = TEST_ITEMS[program.lang];
      const tests = outside(testItem, sets);
      const formOf = ROUTE_FORMS[program.lang];
      const source = extra.source ?? "";
      const django =
        program.lang === "python" &&
        program.children.some((node) => sets.import.has(node.type) && DJANGO_URLS.test(source.slice(node.start, node.end)));
      // What declares no route of this service's own: a class under a `.well-known` mapping or a Feign client's, a call's arguments under a `.well-known` path.
      const skipped = new Set();
      return {
        node(node, ctx) {
          tests.note(node, ctx);
          // A Feign client's annotations come in any order, so its interface is marked before any of them, its own
          // included, is read.
          const marks = (part) => part.children.some((a) => sets.route.has(a.type) && formOf(annotationName(a, sets.routeArgs), true, django)?.client);
          if (sets.cls.has(node.type) && node.children.some(marks)) skipped.add(node);
          if (!sets.route.has(node.type) || tests.holds(node, ctx)) return;
          const parent = ctx.ancestors.at(-1);
          const onDeclaration = sets.annotation.has(node.type) || sets.annotation.has(parent.type);
          const form = formOf(annotationName(node, sets.routeArgs), onDeclaration, django);
          if (!form || (form.topLevel && ctx.stack.filter((n) => sets.cls.has(n.type)).length > 1)) return;
          const holder = ctx.ancestors.at(-2);
          // A handler marked as the file's own test, beside its route rather than around it.
          if (testItem && onDeclaration) {
            const own = sets.annotation.has(node.type) ? node : parent;
            const container = own === node ? parent : holder;
            if (container && besideOwn(testItem, own, container, sets)) return;
          }
          const list = node.children.find((child) => sets.routeArgs.has(child.type));
          if (!list) return;
          const scope = !onDeclaration ? list : holder && sets.cls.has(holder.type) ? holder : null;
          // A class's mark reaches its own routes and not a nested class's, which maps by its own mapping alone.
          if (skipped.size && (skipped.has(ctx.cls) || ctx.ancestors.some((a) => skipped.has(a) && !sets.cls.has(a.type)))) return;
          for (const value of pathValues(list, form, shapes, sets)) {
            const path = wholeString(value, sets);
            if (path === null || (form.slash && !path.text.startsWith("/"))) continue;
            if (namesWellKnown(path.text) && scope) skipped.add(scope);
            // Its arguments' offset, since a chained call starts where the chain does.
            addPathSites(add, site(value), path.text, `${list.start}`, { mayBeCut: path.cut });
          }
        },
      };
    },
  },
  {
    key: "class_inherits",
    tier: "syntactic",
    learnedClasses: true,
    // The class is a name out of the repository's own source, so the sentence it fills is encoded before it is rendered.
    learnedFromSource: true,
    claim: "classes here inherit <style>",
    counterClaim: null, // the other side is another base, which the learning already picks
    precision: "partial",
    applicabilityPredicate: {
      sites: "a class declaration naming a base class, outside a test file: in Python the first base its parentheses list, keyword arguments such as `metaclass=` and spread bases aside and `object`, `Generic` and `Protocol` passed over; in PHP and Java the class `extends` names; in C# the first entry of the base list where its name does not read as an interface, `I` and a capital; in Kotlin the supertype a constructor is called on, `: Base()`, in a class, an object or a companion object declaration, an interface being named bare. The base is its last segment, past a module, a package or a namespace and without type arguments. A class naming none is not a site, and neither is an interface, a trait, an enum or a record",
      blind: "an import that renames the base is read under the name written here, and a C# base class named like an interface is taken for one and passed over",
    },
    langs: ["python", "php", "java", "csharp", "kotlin"],
    visitor(program, add, extra = {}) {
      if (inTestFile(program, extra)) return IDLE;
      const lang = program.lang;
      const shapes = SHAPES[lang];
      const sets = SETS.get(lang);
      return {
        node(node) {
          if (!sets.inherits.has(node.type)) return;
          const base = baseOf(node, lang, shapes, sets);
          if (base === null) return;
          const named = fieldOf(node, shapes.name);
          add({ node: site(named ?? node), conforming: false, where: named?.text ?? null, class: base });
        },
      };
    },
  },
  {
    key: "logger_over_print",
    tier: "syntactic",
    capability: "logging",
    claim: "output goes through a logger, not print",
    counterClaim: null, // a repository with no logger is never asked (C14), so the other side has no sites
    precision: "partial",
    applicabilityPredicate: {
      sites: "a call outside a test file that writes to the console, in Python `print`, in PHP `echo` and `print` outside a template (a file holding markup outside its tags), `var_dump`, `print_r`, `printf` or `var_export`, in Java `System.out` or `System.err` with `print`, `println` or `printf`, in C# `Console.Write` or `Console.WriteLine`, in Rust `println!`, `print!`, `eprintln!`, `eprint!` or `dbg!`, in Kotlin `println` or `print`, in Go `fmt.Print`, `fmt.Println`, `fmt.Printf`, `print` or `println`; or one that writes through a logger, a level (`debug`, `info`, `warn`, `warning`, `error`, `critical`, `fatal`, `trace`, `exception`, `verbose`, JUL's `severe` and `fine`, and each with a `Log` prefix) or `log` called on a receiver named `log`, `logger` or `logging` in any case and with leading underscores, in Rust `info!`, `warn!`, `error!`, `debug!`, `trace!` and `event!`, bare or under `log::` or `tracing::`, and in Go a level, `Print`, `Fatal` or `Panic`, with an `f`, `ln`, `w`, `Context` or `Depth` suffix, or zerolog's `Msg` or `Send`, called through the packages `log`, `slog`, `klog`, `glog`, `zap`, `zerolog` and `logrus` or a receiver named for a logger anywhere earlier in the chain (`caddy.Log().Info`, `logger.With(...).Info`), a chain counted once at its end; klog's `InfoS` and slog's `LogAttrs` included; `zap`'s own package functions build fields and write nothing. The file whose own stem is nothing but the logging vocabulary implements the routing rather than following it and is not a site",
      blind: "output behind a helper, a logger under another name, and a command-line tool that writes to stdout on purpose look the same from here",
    },
    langs: ["python", "php", "java", "csharp", "rust", "kotlin", "go"],
    visitor(program, add, extra = {}) {
      if (inTestFile(program, extra) || implementsCapability(extra.rel, "logging")) return IDLE;
      const lang = program.lang;
      const shapes = SHAPES[lang];
      const sets = SETS.get(lang);
      const source = extra.source ?? "";
      const template = program.children.some((child) => sets.template.has(child.type) && holdsMarkup(child));
      return {
        node(node, ctx) {
          const kind = sets.printStatement.has(node.type) ? (template ? null : "print") : sets.outputCall.has(node.type) ? outputOf(node, lang, sets, source) : null;
          if (kind === null) return;
          const held = ctx.fn && nameOf(ctx.fn);
          add({ node: site(node), conforming: kind === "log", where: held ? within(ownerOf(ctx.fn, ctx, shapes, sets, source), held) : null });
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
assertKeyed("NO_SITE", NO_SITE, [], asked("public_doc_comment"));
assertKeyed("UNBOUND", UNBOUND, [], asked("caught_error_used"));
assertKeyed("UNTYPED", UNTYPED, asked("declared_return_type"));
assertKeyed("ROUTE_FORMS", ROUTE_FORMS, asked("endpoint_segment_case"));
assertKeyed("TEST_ITEMS", TEST_ITEMS, [], asked("endpoint_segment_case"));
assertKeyed("PRINTS", PRINTS, asked("logger_over_print"));
