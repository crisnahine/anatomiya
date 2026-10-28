/**
 * What a file of a tree-sitter language reaches for in another file, and what
 * it defines, read off the plain tree `tree-walk.mjs` copies. `refs.mjs` turns
 * each reference into the file it names.
 *
 * A reference is `{ name, stems?, exact?, dir?, lookup?, type?, in?, global?, extension?, member?, bare? }`:
 * `stems` are paths without an extension to try in order, matched whole where
 * `exact` and as a path's tail elsewhere; `dir` with `lookup` is a directory
 * whose file defining that name is the one meant, as a Go package or a Kotlin
 * package's function is; `type` is a C# type, found by the file that declares
 * it, `in` the namespace a `using static` names it in; `global` is a PHP
 * function, which PHP loads for every file, and `extension` a C# extension
 * method, which a call on any value of its type reaches. `name` is what the
 * roster prints, and `bare` replaces it where the file found does not define
 * `member`. What each language writes is in
 * `docs/research/what-an-import-names-in-each-language.md`.
 */
import { posix } from "node:path";

import { assertKeyed, hostedBy } from "./langs.mjs";
import { dirOf } from "./paths.mjs";
import { commentAbove, docLine, lineStarts, paramsText, symbol } from "./symbols.mjs";
import { SHAPES } from "./tree-shapes.mjs";
import { fieldOf, lastLeaf, leaves, nameOf, walkTree } from "./tree-walk.mjs";

const firstOfType = (node, type) => node.children.find((c) => c.type === type) ?? null;

// The declarations past `fn` and `cls` that name something another file may use.
const DEFINES_TOO = {
  python: [],
  php: [],
  go: ["type_spec", "const_spec", "var_spec"],
  java: [],
  csharp: ["enum_declaration"],
  rust: ["struct_item", "enum_item", "type_item", "const_item", "static_item"],
  kotlin: [],
};

assertKeyed("DEFINES_TOO", DEFINES_TOO, hostedBy("tree-sitter"));

// What the code index lists beside the functions and classes the rows read, by the kind it lists each as. Kept
// apart from `SHAPES` because a row's own count passes over a constructor on purpose.
const INDEXED_TOO = {
  python: { assignment: "fn" },
  php: {},
  go: {},
  java: { constructor_declaration: "method" },
  csharp: { constructor_declaration: "method", delegate_declaration: "type" },
  rust: { macro_definition: "fn" },
  kotlin: { secondary_constructor: "method", type_alias: "type" },
};

assertKeyed("INDEXED_TOO", INDEXED_TOO, hostedBy("tree-sitter"));

/** The name an `INDEXED_TOO` node is listed by, or null where it is not one: Python lists an assignment only of a lambda. */
function indexedName(node) {
  if (node.type === "assignment") {
    const left = fieldOf(node, "left");
    return left?.type === "identifier" && fieldOf(node, "right")?.type === "lambda" ? left.text : null;
  }
  if (node.type === "secondary_constructor") return "constructor";
  if (node.type === "type_alias") return fieldOf(node, "type")?.text ?? null;
  return nameOf(node);
}

/** A directory `ups` levels above a file's own, or null past the top. */
function above(rel, ups) {
  let dir = dirOf(rel);
  for (let i = 0; i < ups; i++) {
    if (dir === "") return null;
    dir = dirOf(dir);
  }
  return dir;
}

/** A call on an imported class: named `Class.method` where the class's file defines the method, and `Class` where it does not. */
const member = (cls, method, stems, joiner, extra = {}) => ({ name: `${cls}${joiner}${method}`, bare: cls, member: method, stems, ...extra });

// A Python module is a file, or a package's `__init__`.
const moduleStems = (module) => [module, `${module}/__init__`];

function python(node, refs, file, rel) {
  if (node.type === "import_from_statement") {
    const from = fieldOf(node, "module_name");
    if (from === null) return;
    let base = null;
    let path = [];
    if (from.type === "relative_import") {
      const dots = (firstOfType(from, "import_prefix")?.text ?? ".").length;
      base = above(rel, dots - 1);
      if (base === null) return;
      const rest = firstOfType(from, "dotted_name");
      path = rest ? leaves(rest) : [];
    } else path = leaves(from);
    const placed = (stems) => (base === null ? { stems } : { stems: stems.map((s) => posix.join(base, s)), exact: true });
    for (const child of node.children) {
      if (child.field !== "name") continue;
      const named = child.type === "aliased_import" ? fieldOf(child, "name") : child;
      if (named === null) continue;
      const name = leaves(named).join(".");
      const parent = path.join("/");
      const asModule = parent === "" ? name : `${parent}/${name}`;
      refs.push({ name, ...placed([...moduleStems(asModule), ...(parent === "" ? ["__init__"] : moduleStems(parent))]) });
      // The name may be a module, whose attributes a call then reaches.
      const alias = child.type === "aliased_import" ? (fieldOf(child, "alias")?.text ?? name) : name;
      file.modules.set(alias, placed(moduleStems(asModule)));
    }
  } else if (node.type === "import_statement") {
    for (const child of node.children) {
      if (child.field !== "name") continue;
      const named = child.type === "aliased_import" ? fieldOf(child, "name") : child;
      if (named === null) continue;
      const path = leaves(named);
      const module = path.join("/");
      refs.push({ name: path.at(-1), stems: moduleStems(module) });
      const alias = child.type === "aliased_import" ? fieldOf(child, "alias")?.text : null;
      file.modules.set(alias ?? path.join("."), { stems: moduleStems(module) });
    }
  } else if (node.type === "attribute") {
    // `shop.money.format_price` after `import shop.money`, or `t.slug` after `import shop.text as t`.
    const object = fieldOf(node, "object");
    const attribute = fieldOf(node, "attribute");
    const module = object && attribute?.type === "identifier" ? file.modules.get(leaves(object).join(".")) : undefined;
    if (module !== undefined) refs.push({ name: attribute.text, ...module });
  }
}

function java(node, refs, file) {
  if (node.type === "package_declaration") {
    const path = node.children.find((c) => c.type === "scoped_identifier" || c.type === "identifier");
    if (path) file.namespace = leaves(path).join(".");
  } else if (node.type === "import_declaration") {
    const target = node.children.find((c) => c.type === "scoped_identifier" || c.type === "identifier");
    if (!target) return;
    const path = leaves(target);
    const isStatic = node.tokens?.includes("static") === true;
    if (node.children.some((c) => c.type === "asterisk")) {
      // A package's classes, which the file then names bare.
      if (!isStatic) file.wildcards.push(path.join("/"));
    } else if (isStatic) {
      if (path.length >= 2) refs.push({ name: `${path.at(-2)}.${path.at(-1)}`, stems: [path.slice(0, -1).join("/")] });
    } else {
      file.classes.set(path.at(-1), path.join("/"));
      refs.push({ name: path.at(-1), stems: [path.join("/")] });
    }
  } else if (node.type === "method_invocation") {
    const object = fieldOf(node, "object");
    const method = nameOf(node);
    if (object?.type !== "identifier" || !method) return;
    const stem = file.classes.get(object.text);
    // A class named bare is the file's own package's before it is any wildcard's, as Java looks it up.
    const packages = file.wildcards.length ? [...(file.namespace ? [file.namespace.replaceAll(".", "/")] : []), ...file.wildcards] : [];
    const stems = stem !== undefined ? [stem] : /^[A-Z]/.test(object.text) ? packages.map((p) => `${p}/${object.text}`) : [];
    if (stems.length) refs.push(member(object.text, method, stems, "."));
  }
}

function kotlin(node, refs, file) {
  if (node.type === "package_header") {
    const path = node.children.find((c) => c.type === "qualified_identifier" || c.type === "identifier");
    if (path) file.namespace = leaves(path).join(".");
  } else if (node.type === "import") {
    const path = firstOfType(node, "qualified_identifier");
    if (!path) return;
    const segments = leaves(path);
    if (node.tokens?.some((t) => t === "*" || t === ".*")) {
      file.wildcards.push(segments.join("/"));
      return;
    }
    const alias = node.children.find((c) => c !== path && c.type === "identifier")?.text ?? segments.at(-1);
    const ref = { name: segments.at(-1), stems: [segments.join("/")], dir: segments.slice(0, -1).join("/"), lookup: segments.at(-1) };
    file.classes.set(alias, ref);
    refs.push(ref);
  } else if (node.type === "navigation_expression") {
    const [object, field] = node.children;
    if (object?.type !== "identifier" || field?.type !== "identifier") return;
    const ref = file.classes.get(object.text);
    if (ref !== undefined) refs.push(member(ref.name, field.text, ref.stems, ".", { dir: ref.dir, lookup: ref.lookup }));
    else if (/^[A-Z]/.test(object.text)) {
      for (const w of file.wildcards) refs.push(member(object.text, field.text, [`${w}/${object.text}`], ".", { dir: w, lookup: object.text }));
    }
  }
}

function go(node, refs, file) {
  if (node.type === "import_spec") {
    const path = leaves(fieldOf(node, "path") ?? node).join("");
    const local = fieldOf(node, "name")?.text ?? path.slice(path.lastIndexOf("/") + 1);
    // A blank import runs the package and names nothing, and a dot import names every member bare.
    if (local !== "_" && local !== "." && path.includes("/")) file.packages.set(local, path);
  } else if (node.type === "selector_expression") {
    const operand = fieldOf(node, "operand");
    const path = operand?.type === "identifier" ? file.packages.get(operand.text) : undefined;
    const field = fieldOf(node, "field")?.text;
    if (path !== undefined && field) refs.push({ name: `${path.slice(path.lastIndexOf("/") + 1)}.${field}`, dir: path, lookup: field });
  }
}

/**
 * Every leaf path a Rust use tree holds, as its segments: `a::{b, c::d}` is `a::b` and `a::c::d`,
 * and `a::{self}` is `a` itself.
 */
function useLeaves(node, prefix, out) {
  if (node.type === "scoped_use_list") {
    const path = fieldOf(node, "path");
    const list = fieldOf(node, "list");
    const at = path ? [...prefix, ...leaves(path)] : prefix;
    for (const child of list?.children ?? []) useLeaves(child, at, out);
  } else if (node.type === "use_list") {
    for (const child of node.children) useLeaves(child, prefix, out);
  } else if (node.type === "use_as_clause") {
    const path = fieldOf(node, "path");
    if (path) out.push([...prefix, ...leaves(path)]);
  } else if (node.type === "self" && prefix.length > 0) {
    out.push(prefix);
  } else if (node.type !== "use_wildcard" && node.type !== "line_comment" && node.type !== "block_comment") {
    out.push([...prefix, ...leaves(node)]);
  }
}

/** The directory a Rust module's own children live in: `a/b.rs` holds `a/b/`, and `mod.rs`, `lib.rs` or `main.rs` hold their own directory. */
function rustModuleDir(rel) {
  const stem = posix.basename(rel, ".rs");
  return ["mod", "lib", "main"].includes(stem) ? dirOf(rel) : posix.join(dirOf(rel), stem);
}

/** The `src` directory of the crate a file is in: the nearest one above it. */
function crateSrc(rel) {
  const segments = rel.split("/");
  const at = segments.lastIndexOf("src", segments.length - 2);
  return at === -1 ? null : segments.slice(0, at + 1).join("/");
}

const ANCHORS = new Set(["crate", "self", "super"]);

/**
 * The reference a Rust path names, anchored at the crate's `src` or the module's own directory and
 * matched whole, or a workspace crate's `src` matched as a tail; null where it names no directory
 * here. `external` lets a path that starts with another crate's name through.
 */
function rustRef(segments, rel, external) {
  let base = null;
  let rest = segments;
  if (segments[0] === "crate") [base, rest] = [crateSrc(rel), segments.slice(1)];
  else if (segments[0] === "self") [base, rest] = [rustModuleDir(rel), segments.slice(1)];
  else if (segments[0] === "super") {
    let dir = rustModuleDir(rel);
    for (rest = segments; rest[0] === "super" && dir !== null; rest = rest.slice(1)) dir = dir === "" ? null : dirOf(dir);
    base = dir;
  }
  // Anchored where no directory answers, a crate's root above the top or no `src` to start from, it names nothing.
  if (rest.length === 0 || (ANCHORS.has(segments[0]) && base === null)) return null;
  const name = rest.at(-1);
  const module = rest.join("/");
  const parent = rest.slice(0, -1).join("/");
  if (base !== null) {
    // An item of the module `base` is itself: `a.rs` beside `a/`, its `mod.rs`, or the crate's root file.
    const holder = parent === "" ? [base, `${base}/mod`, `${base}/lib`, `${base}/main`].filter((s) => !s.startsWith("/")) : [posix.join(base, parent), posix.join(base, parent, "mod")];
    return { name, stems: [posix.join(base, module), posix.join(base, module, "mod"), ...holder], exact: true };
  }
  if (!external || segments.length < 2) return null;
  // Another crate of this workspace, named in Rust with `_` where its manifest may say `-`.
  const crates = [...new Set([segments[0], segments[0].replaceAll("_", "-")])];
  const inner = segments.slice(1);
  const at = inner.join("/");
  const parentAt = inner.slice(0, -1).join("/");
  return { name, stems: crates.flatMap((c) => [`${c}/src/${at}`, `${c}/src/${at}/mod`, parentAt === "" ? `${c}/src/lib` : `${c}/src/${parentAt}`]) };
}

function rust(node, refs, file, rel) {
  if (node.type === "use_declaration") {
    const argument = fieldOf(node, "argument");
    if (!argument) return;
    const paths = [];
    useLeaves(argument, [], paths);
    for (const segments of paths) {
      const ref = rustRef(segments, rel, true);
      if (ref !== null) refs.push(ref);
    }
  } else if (node.type === "call_expression") {
    // `crate::text::escape(x)` names its module with no `use`; a path into another crate is that crate's.
    const callee = fieldOf(node, "function");
    const segments = callee?.type === "scoped_identifier" ? leaves(callee) : null;
    const ref = segments !== null && ANCHORS.has(segments[0]) ? rustRef(segments, rel, false) : null;
    if (ref !== null) refs.push(ref);
  }
}

function php(node, refs, file) {
  if (node.type === "namespace_definition") {
    // The first a file declares: a file holding two is a bundle, which no autoloader reads by its path.
    const name = fieldOf(node, "name");
    if (name && file.namespace === null) file.namespace = leaves(name).join(".");
  } else if (node.type === "namespace_use_declaration") {
    // `use function` and `use const` name what no autoloader maps to a file: a group says so once, a clause for itself.
    const unmapped = (n) => n.tokens?.some((t) => t === "function" || t === "const") === true;
    if (unmapped(node)) return;
    const prefix = firstOfType(node, "namespace_name");
    const group = fieldOf(node, "body");
    const clauses = (group ?? node).children.filter((c) => c.type === "namespace_use_clause");
    for (const clause of clauses) {
      if (unmapped(clause)) continue;
      const written = clause.children.find((c) => c.field !== "alias" && (c.type === "qualified_name" || c.type === "name"));
      if (!written) continue;
      const segments = [...(prefix ? leaves(prefix) : []), ...leaves(written)];
      const alias = fieldOf(clause, "alias")?.text ?? segments.at(-1);
      // A PSR-4 prefix maps a namespace onto a directory spelled otherwise, `App\` onto `app/`: the tail past it is what a path holds.
      const stems = segments.length > 2 ? [segments.join("/"), segments.slice(1).join("/")] : [segments.join("/")];
      file.classes.set(alias, { name: segments.at(-1), stems });
      refs.push({ name: segments.at(-1), stems });
    }
  } else if (node.type === "scoped_call_expression") {
    const scope = fieldOf(node, "scope");
    const ref = scope?.type === "name" ? file.classes.get(scope.text) : undefined;
    const method = nameOf(node);
    if (ref !== undefined && method) refs.push(member(ref.name, method, ref.stems, "::"));
  } else if (node.type === "function_definition") {
    // A function is PHP's to load for every file, however deep the block it is declared in.
    const name = nameOf(node);
    if (name) file.globals.add(name);
  } else if (node.type === "function_call_expression") {
    // `money(2)`, or `\App\Support\money(2)`, whose namespace PHP looks the function up in first.
    const callee = fieldOf(node, "function");
    const name = callee?.type === "name" ? callee.text : callee?.type === "qualified_name" ? callee.children.at(-1)?.text : null;
    if (name) refs.push({ name, global: name });
  }
}

function csharp(node, refs, file) {
  if (node.type === "using_directive") {
    const path = node.children.find((c) => c.type === "qualified_name" || c.type === "identifier");
    // An alias names one type or namespace under another name, which nothing below reads.
    if (!path || node.children.some((c) => c.field === "name")) return;
    const segments = leaves(path);
    if (node.tokens?.includes("static")) refs.push({ name: segments.at(-1), type: segments.at(-1), in: segments.slice(0, -1).join(".") });
    // A global using opens its namespace for every file of the project.
    else if (node.tokens?.includes("global")) file.globalUsings.push(segments.join("."));
    else file.usings.push(segments.join("."));
  } else if (node.type === "namespace_declaration" || node.type === "file_scoped_namespace_declaration") {
    const name = fieldOf(node, "name");
    if (name) file.namespace = leaves(name).join(".");
  } else if (node.type === "member_access_expression") {
    const object = fieldOf(node, "expression");
    const name = fieldOf(node, "name");
    if (name?.type !== "identifier") return;
    if (object?.type === "identifier" && /^[A-Z]/.test(object.text)) {
      refs.push({ name: `${object.text}.${name.text}`, bare: object.text, member: name.text, type: object.text });
    } else if (object !== null && node.field === "function") {
      // A call on a value: an extension method of that name, where the repository declares one. A call on
      // `this` or `base`, which the tree writes with no node of its own, is the class's own method.
      refs.push({ name: name.text, extension: name.text });
    }
  } else if (node.type === "object_creation_expression") {
    const type = fieldOf(node, "type");
    if (type?.type === "identifier") refs.push({ name: type.text, type: type.text });
  } else if (node.type === "base_list") {
    for (const base of node.children) if (base.type === "identifier") refs.push({ name: base.text, type: base.text });
  } else if (node.type === "method_declaration") {
    // `this` on the first parameter makes the method callable on any value of that parameter's type.
    const first = firstOfType(fieldOf(node, "parameters") ?? node, "parameter");
    const name = nameOf(node);
    if (name && first?.children.some((c) => c.type === "modifier" && c.text === "this")) file.extensions.add(name);
  }
}

const READERS = { python, java, kotlin, go, rust, php, csharp };

assertKeyed("READERS", READERS, hostedBy("tree-sitter"));

// The declarations past `fn` and `cls` the index lists as values; the rest it lists as types.
const CONSTANTS = new Set(["const_spec", "var_spec", "const_item", "static_item"]);
const HASH_COMMENTS = new Set(["python", "php"]);
const UNNAMED_TYPES = new Set(["tuple_type", "array_type"]);

/** The name a method's container is known by: its class's, an `impl`'s type's past its path and type arguments, or a Go receiver's type's. */
function containerOf(node, ctx, shapes) {
  const typeArgs = new Set(shapes.typeArgs ?? []);
  const receiver = fieldOf(node, "receiver");
  // `(l *List[T])` names the list, past its type parameters.
  if (receiver) return lastLeaf(receiver, typeArgs);
  for (let i = ctx.stack.length - 1; i >= 0; i--) {
    const held = ctx.stack[i];
    const typed = fieldOf(held, "type");
    // A trait implemented for a tuple or an array names no type a method belongs to.
    const implemented = typed && !UNNAMED_TYPES.has(typed.type) ? typed : null;
    const name = nameOf(held) ?? (implemented && lastLeaf(implemented, typeArgs)) ?? null;
    if (name) return name;
  }
  return null;
}

/** A function's parameter list: the `parameters` field, or the first parameter list that is not a Go receiver. */
const paramsOf = (node) =>
  fieldOf(node, "parameters") ?? node.children.find((child) => /param/.test(child.type) && child.field !== "receiver") ?? null;

/** A Python docstring's text: the first statement of the body, where it is a string. */
function docstringOf(node) {
  const first = fieldOf(node, "body")?.children[0];
  const string = first?.type === "expression_statement" ? first.children[0] : null;
  return string?.type === "string" ? leaves(string).join("") : null;
}

/** Each definition no function holds, as `symbols.mjs` spells one; `listed` is its `INDEXED_TOO` kind where it has one. */
function symbolOf(node, ctx, lang, shapes, source, starts, listed = null) {
  if (ctx.fn !== null) return null;
  const name = listed ? indexedName(node) : nameOf(node);
  if (!name) return null;
  const fn = listed ? listed !== "type" : shapes.fn.includes(node.type);
  const kind = listed === "type" ? "type" : fn ? (ctx.cls !== null || fieldOf(node, "receiver") ? "method" : "fn") : shapes.cls.includes(node.type) ? "class" : CONSTANTS.has(node.type) ? "const" : "type";
  const lambda = node.type === "assignment" ? fieldOf(fieldOf(node, "right"), "parameters") : null;
  const params = fn || listed ? (lambda ?? paramsOf(node)) : null;
  const raw = (lang === "python" ? docstringOf(node) : null) ?? commentAbove(source, starts, node.line, HASH_COMMENTS.has(lang));
  return symbol(name, kind, node.line, kind === "method" || ctx.stack.length ? containerOf(node, ctx, shapes) : null, params && paramsText(lambda ? `(${source.slice(params.start, params.end)})` : source.slice(params.start, params.end)), docLine(raw));
}

const sorted = (set) => [...set].sort();

/**
 * `{ refs, defines }` for one plain tree, its `symbols` where `source` is the text the tree was read off, and where the language has them the facts that decide
 * which file a reference reaches: the namespace or package the file declares, for C# the ones it
 * opens with `using` or `global using` and the extension methods it declares, and for PHP the
 * functions it declares.
 */
export function treeRefs(program, lang, rel, source = null) {
  const read = READERS[lang];
  const shapes = SHAPES[lang];
  const declares = new Set([...shapes.fn, ...shapes.cls, ...DEFINES_TOO[lang]]);
  const refs = [];
  const defines = new Set();
  const symbols = [];
  const starts = source === null ? null : lineStarts(source);
  const file = {
    classes: new Map(),
    packages: new Map(),
    modules: new Map(),
    wildcards: [],
    usings: [],
    globalUsings: [],
    namespace: null,
    globals: new Set(),
    extensions: new Set(),
  };
  walkTree(program, (node, ctx) => {
    if (declares.has(node.type)) {
      const name = nameOf(node);
      if (name) defines.add(name);
      const defined = starts && symbolOf(node, ctx, lang, shapes, source, starts);
      if (defined) symbols.push(defined);
    } else if (starts && INDEXED_TOO[lang][node.type]) {
      const defined = symbolOf(node, ctx, lang, shapes, source, starts, INDEXED_TOO[lang][node.type]);
      if (defined) symbols.push(defined);
    }
    read(node, refs, file, rel);
  });
  const seen = new Set();
  const unique = refs.filter((ref) => {
    const key = JSON.stringify(ref);
    return !seen.has(key) && seen.add(key);
  });
  return {
    refs: unique,
    defines: sorted(defines),
    ...(symbols.length ? { symbols } : {}),
    ...(file.usings.length ? { usings: file.usings } : {}),
    ...(file.globalUsings.length ? { globalUsings: file.globalUsings } : {}),
    ...(file.namespace !== null ? { namespace: file.namespace } : {}),
    ...(file.globals.size ? { globals: sorted(file.globals) } : {}),
    ...(file.extensions.size ? { extensions: sorted(file.extensions) } : {}),
  };
}
