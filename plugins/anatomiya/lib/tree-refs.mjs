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

/** Whether a node is one of `types`, a list `SHAPES` holds or does not. */
const is = (node, types) => node != null && types !== undefined && types.includes(node.type);
const firstOf = (node, types) => node.children.find((c) => is(c, types)) ?? null;

// What the code index lists beside the functions and classes the rows read, by the kind it lists each as. Held
// apart from `fn` and `cls` because a row's own count passes over a constructor on purpose.
const indexedKind = (node, s) =>
  is(node, s.indexedFn) ? "fn" : is(node, s.indexedMethod) ? "method" : is(node, s.indexedType) ? "type" : null;

/** The name an indexed node is listed by, or null where it is not one: Python lists an assignment only of a lambda. */
function indexedName(node, s) {
  if (is(node, s.indexedFn) && s.lambda) {
    const left = fieldOf(node, s.lambdaTarget);
    return is(left, s.lambdaName) && is(fieldOf(node, s.lambdaValue), s.lambda) ? left.text : null;
  }
  if (is(node, s.ctorToo)) return "constructor";
  if (is(node, s.aliasToo)) return fieldOf(node, s.aliasName)?.text ?? null;
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

function python(node, refs, file, rel, s) {
  if (is(node, s.refFrom)) {
    const from = fieldOf(node, s.refModule);
    if (from === null) return;
    let base = null;
    let path = [];
    if (is(from, s.refRelative)) {
      const dots = (firstOf(from, s.refDots)?.text ?? ".").length;
      base = above(rel, dots - 1);
      if (base === null) return;
      const rest = firstOf(from, s.refDotted);
      path = rest ? leaves(rest) : [];
    } else path = leaves(from);
    const placed = (stems) => (base === null ? { stems } : { stems: stems.map((stem) => posix.join(base, stem)), exact: true });
    for (const child of node.children) {
      if (child.field !== s.refName) continue;
      const named = is(child, s.refAliased) ? fieldOf(child, s.refName) : child;
      if (named === null) continue;
      const name = leaves(named).join(".");
      const parent = path.join("/");
      const asModule = parent === "" ? name : `${parent}/${name}`;
      refs.push({ name, ...placed([...moduleStems(asModule), ...(parent === "" ? ["__init__"] : moduleStems(parent))]) });
      // The name may be a module, whose attributes a call then reaches.
      const alias = is(child, s.refAliased) ? (fieldOf(child, s.refAlias)?.text ?? name) : name;
      file.modules.set(alias, placed(moduleStems(asModule)));
    }
  } else if (is(node, s.refImport)) {
    for (const child of node.children) {
      if (child.field !== s.refName) continue;
      const named = is(child, s.refAliased) ? fieldOf(child, s.refName) : child;
      if (named === null) continue;
      const path = leaves(named);
      const module = path.join("/");
      refs.push({ name: path.at(-1), stems: moduleStems(module) });
      const alias = is(child, s.refAliased) ? fieldOf(child, s.refAlias)?.text : null;
      file.modules.set(alias ?? path.join("."), { stems: moduleStems(module) });
    }
  } else if (is(node, s.refAttribute)) {
    // `shop.money.format_price` after `import shop.money`, or `t.slug` after `import shop.text as t`.
    const object = fieldOf(node, s.refObject);
    const attribute = fieldOf(node, s.refMember);
    const module = object && is(attribute, s.refIdent) ? file.modules.get(leaves(object).join(".")) : undefined;
    if (module !== undefined) refs.push({ name: attribute.text, ...module });
  }
}

function java(node, refs, file, rel, s) {
  if (is(node, s.refPackage)) {
    const path = firstOf(node, s.refPathNodes);
    if (path) file.namespace = leaves(path).join(".");
  } else if (is(node, s.refImport)) {
    const target = firstOf(node, s.refPathNodes);
    if (!target) return;
    const path = leaves(target);
    const isStatic = node.tokens?.includes(s.refStatic.token) === true;
    if (node.children.some((c) => is(c, s.refWildcard))) {
      // A package's classes, which the file then names bare.
      if (!isStatic) file.wildcards.push(path.join("/"));
    } else if (isStatic) {
      if (path.length >= 2) refs.push({ name: `${path.at(-2)}.${path.at(-1)}`, stems: [path.slice(0, -1).join("/")] });
    } else {
      file.classes.set(path.at(-1), path.join("/"));
      refs.push({ name: path.at(-1), stems: [path.join("/")] });
    }
  } else if (is(node, s.refCall)) {
    const object = fieldOf(node, s.refObject);
    const method = nameOf(node);
    if (!is(object, s.refIdent) || !method) return;
    const stem = file.classes.get(object.text);
    // A class named bare is the file's own package's before it is any wildcard's, as Java looks it up.
    const packages = file.wildcards.length ? [...(file.namespace ? [file.namespace.replaceAll(".", "/")] : []), ...file.wildcards] : [];
    const stems = stem !== undefined ? [stem] : /^[A-Z]/.test(object.text) ? packages.map((p) => `${p}/${object.text}`) : [];
    if (stems.length) refs.push(member(object.text, method, stems, "."));
  }
}

function kotlin(node, refs, file, rel, s) {
  if (is(node, s.refPackage)) {
    const path = firstOf(node, s.refPathNodes);
    if (path) file.namespace = leaves(path).join(".");
  } else if (is(node, s.refImport)) {
    const path = firstOf(node, s.refQualified);
    if (!path) return;
    const segments = leaves(path);
    if (node.tokens?.includes(s.refStar.token)) {
      file.wildcards.push(segments.join("/"));
      return;
    }
    const alias = node.children.find((c) => c !== path && is(c, s.refIdent))?.text ?? segments.at(-1);
    const ref = { name: segments.at(-1), stems: [segments.join("/")], dir: segments.slice(0, -1).join("/"), lookup: segments.at(-1) };
    file.classes.set(alias, ref);
    refs.push(ref);
  } else if (is(node, s.refNavigation)) {
    const [object, field] = node.children;
    if (!is(object, s.refIdent) || !is(field, s.refIdent)) return;
    const ref = file.classes.get(object.text);
    if (ref !== undefined) refs.push(member(ref.name, field.text, ref.stems, ".", { dir: ref.dir, lookup: ref.lookup }));
    else if (/^[A-Z]/.test(object.text)) {
      for (const w of file.wildcards) refs.push(member(object.text, field.text, [`${w}/${object.text}`], ".", { dir: w, lookup: object.text }));
    }
  }
}

function go(node, refs, file, rel, s) {
  if (is(node, s.refImport)) {
    const path = leaves(fieldOf(node, s.refPath) ?? node).join("");
    const local = fieldOf(node, s.refLocal)?.text ?? path.slice(path.lastIndexOf("/") + 1);
    // A blank import runs the package and names nothing, and a dot import names every member bare.
    if (local !== "_" && local !== "." && path.includes("/")) file.packages.set(local, path);
  } else if (is(node, s.refSelector)) {
    const operand = fieldOf(node, s.refOperand);
    const path = is(operand, s.refIdent) ? file.packages.get(operand.text) : undefined;
    const field = fieldOf(node, s.refField)?.text;
    if (path !== undefined && field) refs.push({ name: `${path.slice(path.lastIndexOf("/") + 1)}.${field}`, dir: path, lookup: field });
  }
}

/**
 * Every leaf path a Rust use tree holds, as its segments: `a::{b, c::d}` is `a::b` and `a::c::d`,
 * and `a::{self}` is `a` itself.
 */
function useLeaves(node, prefix, out, s) {
  if (is(node, s.refUseList)) {
    const path = fieldOf(node, s.refPath);
    const list = fieldOf(node, s.refList);
    const at = path ? [...prefix, ...leaves(path)] : prefix;
    for (const child of list?.children ?? []) useLeaves(child, at, out, s);
  } else if (is(node, s.refUses)) {
    for (const child of node.children) useLeaves(child, prefix, out, s);
  } else if (is(node, s.refAs)) {
    const path = fieldOf(node, s.refPath);
    if (path) out.push([...prefix, ...leaves(path)]);
  } else if (is(node, s.refSelf) && prefix.length > 0) {
    out.push(prefix);
  } else if (!is(node, s.refWildcard) && !is(node, s.comment)) {
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

function rust(node, refs, file, rel, s) {
  if (is(node, s.refUse)) {
    const argument = fieldOf(node, s.refArgument);
    if (!argument) return;
    const paths = [];
    useLeaves(argument, [], paths, s);
    for (const segments of paths) {
      const ref = rustRef(segments, rel, true);
      if (ref !== null) refs.push(ref);
    }
  } else if (is(node, s.refCall)) {
    // `crate::text::escape(x)` names its module with no `use`; a path into another crate is that crate's.
    const callee = fieldOf(node, s.refCallee);
    const segments = is(callee, s.refScoped) ? leaves(callee) : null;
    const ref = segments !== null && ANCHORS.has(segments[0]) ? rustRef(segments, rel, false) : null;
    if (ref !== null) refs.push(ref);
  }
}

function php(node, refs, file, rel, s) {
  if (is(node, s.refNamespace)) {
    // The first a file declares: a file holding two is a bundle, which no autoloader reads by its path.
    const name = fieldOf(node, s.refName);
    if (name && file.namespace === null) file.namespace = leaves(name).join(".");
  } else if (is(node, s.refUse)) {
    // `use function` and `use const` name what no autoloader maps to a file: a group says so once, a clause for itself.
    const unmapped = (n) => n.tokens?.some((t) => t === s.refUnmapped.token || t === s.refUnmappedConst.token) === true;
    if (unmapped(node)) return;
    const prefix = firstOf(node, s.refPrefix);
    const group = fieldOf(node, s.refGroup);
    const clauses = (group ?? node).children.filter((c) => is(c, s.refClause));
    for (const clause of clauses) {
      if (unmapped(clause)) continue;
      const written = clause.children.find((c) => c.field !== s.refAlias && is(c, s.refWritten));
      if (!written) continue;
      const segments = [...(prefix ? leaves(prefix) : []), ...leaves(written)];
      const alias = fieldOf(clause, s.refAlias)?.text ?? segments.at(-1);
      // A PSR-4 prefix maps a namespace onto a directory spelled otherwise, `App\` onto `app/`: the tail past it is what a path holds.
      const stems = segments.length > 2 ? [segments.join("/"), segments.slice(1).join("/")] : [segments.join("/")];
      file.classes.set(alias, { name: segments.at(-1), stems });
      refs.push({ name: segments.at(-1), stems });
    }
  } else if (is(node, s.refScoped)) {
    const scope = fieldOf(node, s.refScope);
    const ref = is(scope, s.refBare) ? file.classes.get(scope.text) : undefined;
    const method = nameOf(node);
    if (ref !== undefined && method) refs.push(member(ref.name, method, ref.stems, "::"));
  } else if (is(node, s.refFunction)) {
    // A function is PHP's to load for every file, however deep the block it is declared in.
    const name = nameOf(node);
    if (name) file.globals.add(name);
  } else if (is(node, s.refCall)) {
    // `money(2)`, or `\App\Support\money(2)`, whose namespace PHP looks the function up in first.
    const callee = fieldOf(node, s.refCallee);
    const name = is(callee, s.refBare) ? callee.text : is(callee, s.refQualified) ? callee.children.at(-1)?.text : null;
    if (name) refs.push({ name, global: name });
  }
}

function csharp(node, refs, file, rel, s) {
  if (is(node, s.refUsing)) {
    const path = firstOf(node, s.refPathNodes);
    // An alias names one type or namespace under another name, which nothing below reads.
    if (!path || node.children.some((c) => c.field === s.refAliasField)) return;
    const segments = leaves(path);
    if (node.tokens?.includes(s.refStatic.token)) refs.push({ name: segments.at(-1), type: segments.at(-1), in: segments.slice(0, -1).join(".") });
    // A global using opens its namespace for every file of the project.
    else if (node.tokens?.includes(s.refGlobal.token)) file.globalUsings.push(segments.join("."));
    else file.usings.push(segments.join("."));
  } else if (is(node, s.refNamespace)) {
    const name = fieldOf(node, s.refName);
    if (name) file.namespace = leaves(name).join(".");
  } else if (is(node, s.refAccess)) {
    const object = fieldOf(node, s.refExpression);
    const name = fieldOf(node, s.refName);
    if (!is(name, s.refIdent)) return;
    if (is(object, s.refIdent) && /^[A-Z]/.test(object.text)) {
      refs.push({ name: `${object.text}.${name.text}`, bare: object.text, member: name.text, type: object.text });
    } else if (object !== null && node.field === s.refCallee) {
      // A call on a value: an extension method of that name, where the repository declares one. A call on
      // `this` or `base`, which the tree writes with no node of its own, is the class's own method.
      refs.push({ name: name.text, extension: name.text });
    }
  } else if (is(node, s.refNew)) {
    const type = fieldOf(node, s.refType);
    if (is(type, s.refIdent)) refs.push({ name: type.text, type: type.text });
  } else if (is(node, s.refBases)) {
    for (const base of node.children) if (is(base, s.refIdent)) refs.push({ name: base.text, type: base.text });
  } else if (is(node, s.refMethod)) {
    // `this` on the first parameter makes the method callable on any value of that parameter's type.
    const first = firstOf(fieldOf(node, s.params) ?? node, s.refParam);
    const name = nameOf(node);
    if (name && first?.children.some((c) => is(c, s.refModifier) && c.text === "this")) file.extensions.add(name);
  }
}

const READERS = { python, java, kotlin, go, rust, php, csharp };

assertKeyed("READERS", READERS, hostedBy("tree-sitter"));

const HASH_COMMENTS = new Set(["python", "php"]);

/** The name a method's container is known by: its class's, an `impl`'s type's past its path and type arguments, or a Go receiver's type's. */
function containerOf(node, ctx, shapes) {
  const typeArgs = new Set(shapes.typeArgs ?? []);
  const receiver = shapes.receiver === undefined ? null : fieldOf(node, shapes.receiver);
  // `(l *List[T])` names the list, past its type parameters.
  if (receiver) return lastLeaf(receiver, typeArgs);
  for (let i = ctx.stack.length - 1; i >= 0; i--) {
    const held = ctx.stack[i];
    const typed = shapes.implType === undefined ? null : fieldOf(held, shapes.implType);
    const implemented = typed && !is(typed, shapes.implUnnamed) ? typed : null;
    const name = nameOf(held) ?? (implemented && lastLeaf(implemented, typeArgs)) ?? null;
    if (name) return name;
  }
  return null;
}

/** A function's parameter list: its grammar's field for one, or the first of its parameter lists that is not a Go receiver. */
const paramsOf = (node, s) =>
  (s.params === undefined ? null : fieldOf(node, s.params)) ??
  node.children.find((child) => is(child, s.paramList) && (s.receiver === undefined || child.field !== s.receiver)) ??
  null;

/** A docstring's text: the first statement of the body, where it is a string. */
function docstringOf(node, s) {
  const first = fieldOf(node, s.docHolder)?.children[0];
  const string = is(first, s.docFirst) ? first.children[0] : null;
  return is(string, s.docText) ? leaves(string).join("") : null;
}

/** Each definition no function holds, as `symbols.mjs` spells one; `listed` is its indexed kind where it has one. */
function symbolOf(node, ctx, lang, shapes, source, starts, listed = null) {
  if (ctx.fn !== null) return null;
  const name = listed ? indexedName(node, shapes) : nameOf(node);
  if (!name) return null;
  const fn = listed ? listed !== "type" : shapes.fn.includes(node.type);
  let kind = "type";
  if (fn && listed !== "type") kind = ctx.cls !== null || (shapes.receiver !== undefined && fieldOf(node, shapes.receiver)) ? "method" : "fn";
  else if (!listed && shapes.cls.includes(node.type)) kind = "class";
  else if (!listed && is(node, shapes.indexedConst)) kind = "const";
  const lambda = is(node, shapes.indexedFn) && shapes.lambda ? fieldOf(fieldOf(node, shapes.lambdaValue), shapes.lambdaParams) : null;
  const params = fn || listed ? (lambda ?? paramsOf(node, shapes)) : null;
  const written = params && source.slice(params.start, params.end);
  // A Java or C# declaration starts at its first annotation: its doc sits above that, and a reader is sent to its name.
  const line = fieldOf(node, shapes.name)?.line ?? node.line;
  const raw = (shapes.docHolder === undefined ? null : docstringOf(node, shapes)) ?? commentAbove(source, starts, node.line, HASH_COMMENTS.has(lang));
  const container = kind === "method" || ctx.stack.length ? containerOf(node, ctx, shapes) : null;
  return symbol(name, kind, line, container, written && paramsText(lambda ? `(${written})` : written), docLine(raw));
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
  const declares = new Set([...shapes.fn, ...shapes.cls, ...(shapes.definesToo ?? [])]);
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
    } else if (starts && indexedKind(node, shapes)) {
      const defined = symbolOf(node, ctx, lang, shapes, source, starts, indexedKind(node, shapes));
      if (defined) symbols.push(defined);
    }
    read(node, refs, file, rel, shapes);
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
