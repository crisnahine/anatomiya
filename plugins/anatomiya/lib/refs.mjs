/**
 * Which file a use of a name in another file reaches, for the languages whose
 * import names no path a bundler would resolve: what `mostImported` counts
 * beside JavaScript's imports.
 *
 * Each language's facets carry what the file reaches for as it is written, and
 * each resolver here answers with the one corpus file that holds it or with
 * nothing. An answer two files could give is no answer, as an ambiguous tail is
 * none in `siblings.mjs`: a wrong one would credit one file with another's
 * readers.
 */
import { posix } from "node:path";

import { familyOf, language } from "./langs.mjs";
import { claim, dirOf, tailsOf, withoutExtension } from "./paths.mjs";

/** What a file defines, as its facets say, or an empty list for a file nobody read. */
const definesOf = (records, rel) => records.get(rel)?.facets?.defines ?? [];

/**
 * A call is named for the method it calls where the file it reaches defines that method, and for
 * the class or constant alone where it does not: `Account.find` is ActiveRecord's, and
 * `Presenter.new` builds one. A file nobody read keeps the name as written, since nothing says
 * otherwise.
 */
function calledName(ref, target) {
  if (ref.member === undefined || !target?.ok || !target.facets) return ref.name;
  return (target.facets.defines ?? []).includes(ref.member) ? ref.name : ref.bare;
}

/** What `build` makes of a scan's records or its corpus, made once per such object: both are built once and never changed. */
function memo(cache, key, build) {
  let held = cache.get(key);
  if (!held) cache.set(key, (held = build()));
  return held;
}

// --- Ruby --------------------------------------------------------------------

const RUBY_ROOT = /(?:^|\/)(?:app\/[^/]+\/concerns|app\/[^/]+|lib)\/(.+)\.rb$/;

// A Rails helper module, which a view, a controller and every other helper call with no receiver.
const RAILS_HELPER = /(?:^|\/)app\/helpers\/.+\.rb$/;

// Compared folded, so `http_client.rb` answers `HTTPClient` and `rubocop/` answers `RuboCop` without
// the inflections a repository configures and this does not read.
const fold = (segments) => segments.map((s) => s.replaceAll("_", "").toLowerCase()).join("::");

/**
 * The constant a Ruby file is loaded as, folded, by Zeitwerk's rule: its path under an autoload
 * root, each segment one constant. Every directory under `app` is a root, and so is its `concerns`;
 * a gem's root is `lib`. A file under none, a spec or a config file, is loaded by nobody's name.
 */
function rubyConstantOf(rel) {
  const inRoot = RUBY_ROOT.exec(rel)?.[1];
  return inRoot ? fold(inRoot.split("/")) : null;
}

const RUBY_INDEX = new WeakMap();

const rubyIndex = (corpusRels) =>
  memo(RUBY_INDEX, corpusRels, () => {
    const index = new Map();
    for (const rel of corpusRels) {
      const constant = rubyConstantOf(rel);
      if (constant !== null) claim(index, constant, rel);
    }
    return index;
  });

const HELPERS = new WeakMap();

/** Each method a Rails helper module defines, to the one module that does. */
const railsHelpers = (records) =>
  memo(HELPERS, records, () => {
    const index = new Map();
    for (const [rel] of records) if (RAILS_HELPER.test(rel)) for (const name of definesOf(records, rel)) claim(index, name, rel);
    return index;
  });

/**
 * The file a Ruby reference names. A constant is looked up as Ruby looks it up: in each module the
 * reference sits in, innermost first, then at the top, and a rooted `::A` at the top alone. A call
 * with no receiver reaches the one helper module that defines it.
 */
function rubyTarget(ref, corpusRels, records) {
  if (ref.call !== undefined) return railsHelpers(records).get(ref.call) ?? null;
  const index = rubyIndex(corpusRels);
  const rooted = ref.const.startsWith("::");
  const written = (rooted ? ref.const.slice(2) : ref.const).split("::");
  for (const scope of rooted ? [""] : [...ref.nesting, ""]) {
    const hit = index.get(fold(scope === "" ? written : [...scope.split("::"), ...written]));
    // Two files loaded as the one constant: Ruby takes one of them and nothing here says which.
    if (hit !== undefined) return hit;
  }
  return null;
}

/** A Ruby constant's call is named for the method where the file it reaches defines it. */
function rubyName(ref, target) {
  if (ref.call !== undefined) return ref.name;
  const constant = ref.const.replace(/^::/, "");
  const method = ref.name.slice(constant.length + 1);
  return calledName(method === "" ? ref : { ...ref, member: method, bare: constant }, target);
}

// --- The tree-sitter languages ------------------------------------------------

// Which families' files a reference may reach: Kotlin and Java call each other's classes by import.
const REACHABLE = { kotlin: ["kotlin", "java"], java: ["java", "kotlin"] };

const TREE_INDEX = new WeakMap();

/**
 * Per family, the corpus's files by path without an extension, whole, by every tail and by their
 * own name, and its directories by every tail with the files each holds. A tail two files or two
 * directories end in names neither.
 */
const treeIndex = (corpusRels) => memo(TREE_INDEX, corpusRels, () => familyIndexes(corpusRels));

function familyIndexes(corpusRels) {
  const byFamily = new Map();
  for (const rel of corpusRels) {
    const family = familyOf(language(rel));
    let index = byFamily.get(family);
    if (!index) byFamily.set(family, (index = { family, whole: new Map(), tails: new Map(), dirs: new Map(), dirTails: new Map(), named: new Map() }));
    const stem = withoutExtension(rel);
    claim(index.whole, stem, rel);
    for (const tail of tailsOf(stem)) claim(index.tails, tail, rel);
    const base = posix.basename(stem);
    if (!index.named.has(base)) index.named.set(base, []);
    index.named.get(base).push(rel);
    const dir = dirOf(rel);
    if (!index.dirs.has(dir)) {
      index.dirs.set(dir, []);
      if (dir !== "") for (const tail of tailsOf(dir)) claim(index.dirTails, tail, dir);
    }
    index.dirs.get(dir).push(rel);
  }
  return byFamily;
}

/**
 * Whether a Python file reached by a tail of its path is where an absolute import from `importer`
 * looks: the directory the tail starts in is the top of the tree, a `src`, or one the importer sits
 * under, and is no package itself. `import json` is never `scripts/json.py` read from `app/`, and
 * flask's own `src/flask/typing.py` is `flask.typing`, never the `typing` an importer means.
 */
function pythonRoot(file, tail, importer, corpusRels) {
  const stem = withoutExtension(file);
  const root = stem.length === tail.length ? "" : stem.slice(0, stem.length - tail.length - 1);
  if (corpusRels.has(posix.join(root, "__init__.py"))) return false;
  return root === "" || posix.basename(root) === "src" || importer.startsWith(`${root}/`);
}

/** The one file a stem names in these families, or null: a whole path where `exact`, a tail elsewhere. */
function byStem(stem, exact, indexes, importer, corpusRels) {
  const found = new Set();
  for (const index of indexes) {
    const hit = exact ? index.whole.get(stem) : index.tails.get(stem);
    if (hit === null) return null;
    if (hit === undefined) continue;
    if (!exact && index.family === "python" && !pythonRoot(hit, stem, importer, corpusRels)) continue;
    found.add(hit);
  }
  return found.size === 1 ? [...found][0] : null;
}

/**
 * The directory a package path names. With the module paths the repository's `go.mod` files declare,
 * the path resolves only under one of them, whole, so a package of another module that ends in the
 * same names is not this one; without, it is matched from its longest tail that is a directory here,
 * as a Kotlin source tree that leaves out its package's first names needs.
 */
function packageDir(path, index, modules) {
  if (modules?.size) {
    let best = null;
    for (const [module, dir] of modules) {
      if ((path === module || path.startsWith(`${module}/`)) && (best === null || module.length > best[0].length)) best = [module, dir];
    }
    if (best === null) return null;
    const dir = posix.join(best[1], path.slice(best[0].length + 1));
    return index.dirs.has(dir === "." ? "" : dir) ? (dir === "." ? "" : dir) : null;
  }
  const hit = tailsOf(path).map((tail) => index.dirTails.get(tail)).find((h) => h !== undefined);
  return hit ?? null;
}

const BY_DIR = new WeakMap();

/** The one file in the directory a package path names that defines `lookup`, or null. */
function byDir(ref, indexes, records, modules) {
  const known = memo(BY_DIR, records, () => new Map());
  const key = `${indexes.map((i) => i.family).join(",")}\0${ref.dir}\0${ref.lookup}`;
  if (known.has(key)) return known.get(key);
  const found = new Set();
  for (const index of indexes) {
    const dir = packageDir(ref.dir, index, index.family === "go" ? modules : null);
    if (dir === null) continue;
    for (const rel of index.dirs.get(dir)) if (definesOf(records, rel).includes(ref.lookup)) found.add(rel);
  }
  const file = found.size === 1 ? [...found][0] : null;
  known.set(key, file);
  return file;
}

const CSHARP = new WeakMap();

/** The repository's C# facts every lookup shares: its global usings, and each extension method to the files declaring it. */
const csharpFacts = (records) =>
  memo(CSHARP, records, () => {
    const globalUsings = new Set();
    const extensions = new Map();
    for (const [rel, r] of records) {
      for (const ns of r.facets?.globalUsings ?? []) globalUsings.add(ns);
      for (const name of r.facets?.extensions ?? []) {
        if (!extensions.has(name)) extensions.set(name, []);
        extensions.get(name).push(rel);
      }
    }
    return { globalUsings, extensions };
  });

/** The namespaces a C# file can name a type of with no qualifier: its own and those above it, the ones it opens, and the project's global ones. */
function visibleFrom(from, records, also = []) {
  const visible = new Set([...also, ...(from.facets?.usings ?? []), ...csharpFacts(records).globalUsings]);
  for (let ns = from.facets?.namespace ?? ""; ns !== ""; ns = ns.includes(".") ? ns.slice(0, ns.lastIndexOf(".")) : "") visible.add(ns);
  return visible;
}

/** Of the files declaring a name, the one in a namespace the caller can see; a file in no namespace is seen by all. */
function seenFrom(declaring, from, records, also) {
  const visible = visibleFrom(from, records, also);
  const seen = declaring.filter((rel) => {
    const ns = records.get(rel)?.facets?.namespace;
    return ns === undefined || visible.has(ns);
  });
  return seen.length === 1 ? seen[0] : null;
}

/** The file declaring a C# type, by the convention that names a file after the type it declares. */
function byType(ref, from, indexes, records) {
  const declaring = indexes.flatMap((index) => index.named.get(ref.type) ?? []).filter((rel) => definesOf(records, rel).includes(ref.type));
  return seenFrom(declaring, from, records, ref.in ? [ref.in] : []);
}

const PHP = new WeakMap();

/** Each PHP function the repository declares, to the one file that does. */
const phpGlobals = (records) =>
  memo(PHP, records, () => {
    const index = new Map();
    for (const [rel, r] of records) for (const name of r.facets?.globals ?? []) claim(index, name, rel);
    return index;
  });

/** The module path each `go.mod` declares, to the directory it sits in: `{ rel, text }` per file in. */
export function goModules(manifests) {
  const modules = new Map();
  for (const { rel, text } of manifests) {
    const path = /^\s*module\s+"?([^\s"]+)"?/m.exec(text)?.[1];
    if (path) claim(modules, path, dirOf(rel));
  }
  return modules;
}

/** The file a tree-sitter reference names, or null. */
function treeTarget(ref, from, rel, corpusRels, records, modules) {
  if (ref.global !== undefined) return phpGlobals(records).get(ref.global) ?? null;
  if (ref.extension !== undefined) {
    const declaring = csharpFacts(records).extensions.get(ref.extension);
    return declaring ? seenFrom(declaring, from, records, []) : null;
  }
  const byFamily = treeIndex(corpusRels);
  const lang = language(rel);
  const indexes = (REACHABLE[lang] ?? [familyOf(lang)]).map((family) => byFamily.get(family)).filter(Boolean);
  if (ref.type !== undefined) return byType(ref, from, indexes, records);
  for (const stem of ref.stems ?? []) {
    const file = byStem(stem, ref.exact === true, indexes, rel, corpusRels);
    if (file !== null) return file;
  }
  return ref.dir !== undefined ? byDir(ref, indexes, records, modules) : null;
}

/**
 * What one record reaches for outside JavaScript's imports, as `{ file, names }`, its own file left
 * out. `records` holds every file's record by path, which says what each file defines, and `modules`
 * the module path each `go.mod` declares, to its directory.
 */
export function reachedFrom(rel, record, corpusRels, records, modules = null) {
  const refs = record.facets?.refs;
  if (!refs?.length) return [];
  const ruby = familyOf(language(rel)) === "ruby";
  const reached = [];
  for (const ref of refs) {
    const file = ruby ? rubyTarget(ref, corpusRels, records) : treeTarget(ref, record, rel, corpusRels, records, modules);
    if (file === null || file === rel) continue;
    const target = records.get(file);
    reached.push({ file, names: [ruby ? rubyName(ref, target) : calledName(ref, target)] });
  }
  return reached;
}
