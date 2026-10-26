/**
 * What a file of a tree-sitter language reaches for in another file, and what
 * it defines, read off the plain tree `tree-walk.mjs` copies. `refs.mjs` turns
 * each reference into the file it names.
 *
 * A reference is `{ name, stems?, exact?, dir?, lookup?, type?, member?, bare? }`:
 * `stems` are paths without an extension to try in order, matched whole where
 * `exact` and as a path's tail elsewhere; `dir` with `lookup` is a directory
 * whose file defining that name is the one meant, as a Go package or a Kotlin
 * package's function is; `type` is a C# type, found by the file that declares
 * it. `name` is what the roster prints, and `bare` replaces it where the file
 * found does not define `member`. What each language writes is in
 * `docs/research/what-an-import-names-in-each-language.md`.
 */
import { posix } from "node:path";

import { fieldOf, nameOf, walkTree } from "./tree-walk.mjs";
import { SHAPES } from "./tree-shapes.mjs";

/** Every leaf's text under a node, in source order. */
function leafTexts(node) {
  const out = [];
  const work = [node];
  while (work.length) {
    const n = work.pop();
    if (!n.children.length) out.push(n.text ?? "");
    else for (let i = n.children.length - 1; i >= 0; i--) work.push(n.children[i]);
  }
  return out;
}

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

/** A directory `ups` levels above a file's own, or null past the top. */
function above(rel, ups) {
  let dir = posix.dirname(rel);
  for (let i = 0; i < ups; i++) {
    if (dir === "." || dir === "") return null;
    dir = posix.dirname(dir);
  }
  return dir === "." ? "" : dir;
}

const under = (dir, path) => (dir === "" ? path : `${dir}/${path}`);

function python(node, refs, file, rel) {
  if (node.type === "import_from_statement") {
    const module = fieldOf(node, "module_name");
    if (module === null) return;
    let base = null;
    let path = [];
    if (module.type === "relative_import") {
      const dots = (firstOfType(module, "import_prefix")?.text ?? ".").length;
      base = above(rel, dots - 1);
      if (base === null) return;
      const rest = firstOfType(module, "dotted_name");
      path = rest ? leafTexts(rest) : [];
    } else path = leafTexts(module);
    for (const child of node.children) {
      if (child.field !== "name") continue;
      const named = child.type === "aliased_import" ? fieldOf(child, "name") : child;
      if (named === null) continue;
      const name = leafTexts(named).join(".");
      const module = path.join("/");
      const asModule = module === "" ? name : `${module}/${name}`;
      const stems = [asModule, `${asModule}/__init__`, ...(module === "" ? ["__init__"] : [module, `${module}/__init__`])];
      refs.push(base === null ? { name, stems } : { name, stems: stems.map((s) => under(base, s)), exact: true });
    }
  } else if (node.type === "import_statement") {
    for (const child of node.children) {
      if (child.field !== "name") continue;
      const named = child.type === "aliased_import" ? fieldOf(child, "name") : child;
      if (named === null) continue;
      const path = leafTexts(named);
      const module = path.join("/");
      refs.push({ name: path.at(-1), stems: [module, `${module}/__init__`] });
    }
  }
}

function java(node, refs, file) {
  if (node.type === "import_declaration") {
    const target = node.children.find((c) => c.type === "scoped_identifier" || c.type === "identifier");
    if (!target || node.children.some((c) => c.type === "asterisk")) return;
    const path = leafTexts(target);
    if (node.tokens?.includes("static")) {
      if (path.length < 2) return;
      const cls = path.at(-2);
      refs.push({ name: `${cls}.${path.at(-1)}`, stems: [path.slice(0, -1).join("/")] });
    } else {
      file.classes.set(path.at(-1), path.join("/"));
      refs.push({ name: path.at(-1), stems: [path.join("/")] });
    }
  } else if (node.type === "method_invocation") {
    const object = fieldOf(node, "object");
    const stem = object?.type === "identifier" ? file.classes.get(object.text) : undefined;
    const method = nameOf(node);
    if (stem !== undefined && method) refs.push(member(object.text, method, [stem], "."));
  }
}

/** A call on an imported class: named `Class.method` where the class's file defines the method, and `Class` where it does not. */
const member = (cls, method, stems, joiner, extra = {}) => ({ name: `${cls}${joiner}${method}`, bare: cls, member: method, stems, ...extra });

function kotlin(node, refs, file) {
  if (node.type === "import") {
    if (node.tokens?.some((t) => t === "*" || t === ".*")) return;
    const path = node.children.find((c) => c.type === "qualified_identifier");
    if (!path) return;
    const segments = leafTexts(path);
    const alias = node.children.find((c) => c !== path && c.type === "identifier")?.text ?? segments.at(-1);
    const ref = { name: segments.at(-1), stems: [segments.join("/")], dir: segments.slice(0, -1).join("/"), lookup: segments.at(-1) };
    file.classes.set(alias, ref);
    refs.push(ref);
  } else if (node.type === "navigation_expression") {
    const [object, field] = node.children;
    const ref = object?.type === "identifier" ? file.classes.get(object.text) : undefined;
    if (ref !== undefined && field?.type === "identifier") refs.push(member(ref.name, field.text, ref.stems, ".", { dir: ref.dir, lookup: ref.lookup }));
  }
}

function go(node, refs, file) {
  if (node.type === "import_spec") {
    const path = leafTexts(fieldOf(node, "path") ?? node).join("");
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

/** Every leaf path a Rust use tree holds, as its segments: `a::{b, c::d}` is `a::b` and `a::c::d`. */
function useLeaves(node, prefix, out) {
  if (node.type === "scoped_use_list") {
    const path = fieldOf(node, "path");
    const list = fieldOf(node, "list");
    const at = path ? [...prefix, ...leafTexts(path)] : prefix;
    for (const child of list?.children ?? []) useLeaves(child, at, out);
  } else if (node.type === "use_list") {
    for (const child of node.children) useLeaves(child, prefix, out);
  } else if (node.type === "use_as_clause") {
    const path = fieldOf(node, "path");
    if (path) out.push([...prefix, ...leafTexts(path)]);
  } else if (node.type !== "use_wildcard" && node.type !== "line_comment" && node.type !== "block_comment") {
    out.push([...prefix, ...leafTexts(node)]);
  }
}

/** The directory a Rust module's own children live in: `a/b.rs` holds `a/b/`, and `mod.rs`, `lib.rs` or `main.rs` hold their own directory. */
function rustModuleDir(rel) {
  const dir = posix.dirname(rel) === "." ? "" : posix.dirname(rel);
  const stem = posix.basename(rel, ".rs");
  return ["mod", "lib", "main"].includes(stem) ? dir : under(dir, stem);
}

/** The `src` directory of the crate a file is in: the nearest one above it. */
function crateSrc(rel) {
  const segments = rel.split("/");
  const at = segments.lastIndexOf("src", segments.length - 2);
  return at === -1 ? null : segments.slice(0, at + 1).join("/");
}

function rust(node, refs, file, rel) {
  if (node.type !== "use_declaration") return;
  const argument = fieldOf(node, "argument");
  if (!argument) return;
  const leaves = [];
  useLeaves(argument, [], leaves);
  for (const segments of leaves) {
    const anchored = segments[0] === "crate" || segments[0] === "self" || segments[0] === "super";
    let base = null;
    let rest = segments;
    if (segments[0] === "crate") [base, rest] = [crateSrc(rel), segments.slice(1)];
    else if (segments[0] === "self") [base, rest] = [rustModuleDir(rel), segments.slice(1)];
    else if (segments[0] === "super") {
      let dir = rustModuleDir(rel);
      for (rest = segments; rest[0] === "super" && dir !== null; rest = rest.slice(1)) dir = dir === "" ? null : posix.dirname(dir) === "." ? "" : posix.dirname(dir);
      base = dir;
    }
    // Anchored where no directory answers, a crate's root above the top or no `src` to start from, it names nothing.
    if (rest.length === 0 || (anchored && base === null)) continue;
    const name = rest.at(-1);
    const module = rest.join("/");
    const parent = rest.slice(0, -1).join("/");
    if (base !== null) {
      // An item of the module `base` is itself: `a.rs` beside `a/`, its `mod.rs`, or the crate's root file.
      const holder = parent === "" ? [base, `${base}/mod`, `${base}/lib`, `${base}/main`].filter((s) => !s.startsWith("/")) : [under(base, parent), under(base, `${parent}/mod`)];
      refs.push({ name, stems: [under(base, module), under(base, `${module}/mod`), ...holder], exact: true });
    }
    // Another crate of this workspace, named in Rust with `_` where its manifest may say `-`.
    else if (segments.length > 1) {
      const crates = [segments[0], segments[0].replaceAll("_", "-")];
      const inner = segments.slice(1);
      const at = inner.join("/");
      const parentAt = inner.slice(0, -1).join("/");
      refs.push({ name, stems: [...new Set(crates)].flatMap((c) => [`${c}/src/${at}`, `${c}/src/${at}/mod`, parentAt === "" ? `${c}/src/lib` : `${c}/src/${parentAt}`]) });
    }
  }
}

function php(node, refs, file) {
  if (node.type === "namespace_use_declaration") {
    // `use function` and `use const` name what no autoloader maps to a file: a group says so once, a clause for itself.
    const unmapped = (n) => n.tokens?.some((t) => t === "function" || t === "const") === true;
    if (unmapped(node)) return;
    const prefix = node.children.find((c) => c.type === "namespace_name");
    const group = fieldOf(node, "body");
    const clauses = group ? group.children.filter((c) => c.type === "namespace_use_clause") : node.children.filter((c) => c.type === "namespace_use_clause");
    for (const clause of clauses) {
      if (unmapped(clause)) continue;
      const written = clause.children.find((c) => c.field !== "alias" && (c.type === "qualified_name" || c.type === "name"));
      if (!written) continue;
      const segments = [...(prefix ? leafTexts(prefix) : []), ...leafTexts(written)];
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
  }
}

function csharp(node, refs, file) {
  if (node.type === "using_directive") {
    const path = node.children.find((c) => c.type === "qualified_name" || c.type === "identifier");
    // An alias names one type or namespace under another name, which nothing below reads.
    if (!path || node.children.some((c) => c.field === "name")) return;
    const segments = leafTexts(path);
    if (node.tokens?.includes("static")) refs.push({ name: segments.at(-1), type: segments.at(-1), in: segments.slice(0, -1).join(".") });
    else file.usings.push(segments.join("."));
  } else if (node.type === "namespace_declaration" || node.type === "file_scoped_namespace_declaration") {
    const name = fieldOf(node, "name");
    if (name) file.namespace = leafTexts(name).join(".");
  } else if (node.type === "member_access_expression") {
    const object = fieldOf(node, "expression");
    const name = fieldOf(node, "name");
    if (object?.type === "identifier" && /^[A-Z]/.test(object.text) && name?.type === "identifier") {
      refs.push({ name: `${object.text}.${name.text}`, bare: object.text, member: name.text, type: object.text });
    }
  } else if (node.type === "object_creation_expression") {
    const type = fieldOf(node, "type");
    if (type?.type === "identifier") refs.push({ name: type.text, type: type.text });
  } else if (node.type === "base_list") {
    for (const base of node.children) if (base.type === "identifier") refs.push({ name: base.text, type: base.text });
  }
}

const READERS = { python, java, kotlin, go, rust, php, csharp };

/**
 * `{ refs, defines }` for one plain tree, and for C# the namespace the file is in and the ones it
 * opens with `using`, which decide which declaring file a type it names is.
 */
export function treeRefs(program, lang, rel) {
  const read = READERS[lang];
  const shapes = SHAPES[lang];
  const declares = new Set([...shapes.fn, ...shapes.cls, ...DEFINES_TOO[lang]]);
  const refs = [];
  const defines = new Set();
  const file = { classes: new Map(), packages: new Map(), usings: [], namespace: null };
  walkTree(program, (node) => {
    if (declares.has(node.type)) {
      const name = nameOf(node);
      if (name) defines.add(name);
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
    defines: [...defines].sort(),
    ...(file.usings.length ? { usings: file.usings } : {}),
    ...(file.namespace !== null ? { namespace: file.namespace } : {}),
  };
}
