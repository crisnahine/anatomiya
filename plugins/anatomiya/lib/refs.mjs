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
import { dirOf, withoutExtension } from "./paths.mjs";

const RUBY_ROOT = /(?:^|\/)(?:app\/[^/]+\/concerns|app\/[^/]+|lib)\/(.+)\.rb$/;

// Compared folded, so `http_client.rb` answers `HTTPClient` and `rubocop/` answers `RuboCop` without
// the inflections a repository configures and this does not read.
const fold = (segments) => segments.map((s) => s.replaceAll("_", "").toLowerCase()).join("::");

/**
 * The constant a Ruby file is loaded as, folded, by Zeitwerk's rule: its path under an autoload
 * root, each segment one constant. Every directory under `app` is a root, and so is its `concerns`;
 * a gem's root is `lib`. A file under none, a spec or a config file, is loaded by nobody's name.
 */
function rubyConstantOf(rel) {
  const under = RUBY_ROOT.exec(rel)?.[1];
  return under ? fold(under.split("/")) : null;
}

const RUBY_INDEX = new WeakMap();

function rubyIndex(corpusRels) {
  const cached = RUBY_INDEX.get(corpusRels);
  if (cached) return cached;
  const index = new Map();
  for (const rel of corpusRels) {
    const constant = rubyConstantOf(rel);
    if (constant !== null) index.set(constant, index.has(constant) ? null : rel);
  }
  RUBY_INDEX.set(corpusRels, index);
  return index;
}

/**
 * The file a written constant names, looked up as Ruby looks it up: in each module the reference
 * sits in, innermost first, then at the top. A rooted `::A` is looked up at the top alone.
 */
function rubyTarget(ref, index) {
  const rooted = ref.const.startsWith("::");
  const written = (rooted ? ref.const.slice(2) : ref.const).split("::");
  for (const scope of rooted ? [""] : [...ref.nesting, ""]) {
    const hit = index.get(fold(scope === "" ? written : [...scope.split("::"), ...written]));
    // Two files loaded as the one constant: Ruby takes one of them and nothing here says which.
    if (hit !== undefined) return hit;
  }
  return null;
}

// Which families' files a reference may reach: Kotlin and Java call each other's classes by import.
const REACHABLE = { kotlin: ["kotlin", "java"], java: ["java", "kotlin"] };

// Every tail of a path a scan keeps at most, as `siblings.mjs` keeps for its own index.
const TAIL_MOST = 32;

/** Every whole tail of a path, `a/b/c` as `a/b/c`, `b/c` and `c`, from the longest. */
function tailsOf(path) {
  const segments = path.split("/");
  const tails = [];
  for (let i = Math.max(0, segments.length - TAIL_MOST); i < segments.length; i++) tails.push(segments.slice(i).join("/"));
  return tails;
}

const under = (dir, path) => (dir === "" ? path : `${dir}/${path}`);

const register = (map, key, value) => map.set(key, map.has(key) && map.get(key) !== value ? null : value);

const TREE_INDEX = new WeakMap();

/**
 * Per family, the corpus's files by path without an extension, whole, by every tail and by their
 * own name, and its directories by every tail with the files each holds. A tail two files or two
 * directories end in names neither.
 */
function treeIndex(corpusRels) {
  const cached = TREE_INDEX.get(corpusRels);
  if (cached) return cached;
  const byFamily = new Map();
  for (const rel of corpusRels) {
    const family = familyOf(language(rel));
    let index = byFamily.get(family);
    if (!index) byFamily.set(family, (index = { whole: new Map(), tails: new Map(), dirs: new Map(), dirTails: new Map(), named: new Map() }));
    const stem = withoutExtension(rel);
    index.whole.set(stem, rel);
    // A Python absolute import starts at a top-level package: inside a package, a module is reached by the package's name too.
    const prefix = (tail) => (tail.length === stem.length ? "" : stem.slice(0, stem.length - tail.length - 1));
    const absolute = family === "python" ? (tail) => !corpusRels.has(under(prefix(tail), "__init__.py")) : () => true;
    const base = posix.basename(stem);
    if (!index.named.has(base)) index.named.set(base, []);
    index.named.get(base).push(rel);
    for (const tail of tailsOf(stem)) if (absolute(tail)) register(index.tails, tail, rel);
    const dir = dirOf(rel);
    if (!index.dirs.has(dir)) {
      index.dirs.set(dir, []);
      if (dir !== "") for (const tail of tailsOf(dir)) register(index.dirTails, tail, dir);
    }
    index.dirs.get(dir).push(rel);
  }
  TREE_INDEX.set(corpusRels, byFamily);
  return byFamily;
}

/** The one file a stem names in these families, or null: a whole path where `exact`, a tail elsewhere. */
function byStem(stem, exact, indexes) {
  const found = new Set();
  for (const index of indexes) {
    const hit = exact ? index.whole.get(stem) : index.tails.get(stem);
    if (hit === null) return null;
    if (hit !== undefined) found.add(hit);
  }
  return found.size === 1 ? [...found][0] : null;
}

/**
 * The one file in the directory a package path names that defines `lookup`, or null. The path is
 * matched from its longest tail that is a directory here: a Go import path starts with the module's
 * own path, which is no directory, and a Kotlin source tree may leave out its package's first names.
 */
function byDir(path, lookup, indexes, records) {
  const found = new Set();
  for (const index of indexes) {
    const dir = tailsOf(path).map((tail) => index.dirTails.get(tail)).find((hit) => hit !== undefined);
    if (dir === null || dir === undefined) continue;
    for (const rel of index.dirs.get(dir)) if (records.get(rel)?.facets?.defines?.includes(lookup)) found.add(rel);
  }
  return found.size === 1 ? [...found][0] : null;
}

/**
 * The file declaring a C# type, by the convention that names a file after the type it declares: of
 * those, the one in a namespace the reference can see, or the one there is where none says.
 */
function byType(ref, from, indexes, records) {
  const declaring = indexes.flatMap((index) => index.named.get(ref.type) ?? []).filter((rel) => records.get(rel)?.facets?.defines?.includes(ref.type));
  if (declaring.length <= 1) return declaring[0] ?? null;
  const own = from.facets?.namespace ?? "";
  const visible = new Set([...(ref.in ? [ref.in] : []), ...(from.facets?.usings ?? [])]);
  for (let ns = own; ns !== ""; ns = ns.includes(".") ? ns.slice(0, ns.lastIndexOf(".")) : "") visible.add(ns);
  const seen = declaring.filter((rel) => visible.has(records.get(rel)?.facets?.namespace ?? ""));
  return seen.length === 1 ? seen[0] : null;
}

/** The file a tree-sitter reference names, or null. */
function treeTarget(ref, from, rel, corpusRels, records) {
  const byFamily = treeIndex(corpusRels);
  const lang = language(rel);
  const indexes = (REACHABLE[lang] ?? [familyOf(lang)]).map((family) => byFamily.get(family)).filter(Boolean);
  if (ref.type !== undefined) return byType(ref, from, indexes, records);
  for (const stem of ref.stems ?? []) {
    const file = byStem(stem, ref.exact === true, indexes);
    if (file !== null) return file;
  }
  return ref.dir !== undefined ? byDir(ref.dir, ref.lookup, indexes, records) : null;
}

/**
 * What a reference is called in the roster: the method it calls where the file it reaches defines
 * that method, and the constant alone where it does not, since `Account.find` is ActiveRecord's and
 * `Presenter.new` builds one. A file nobody read keeps the name as written: nothing says otherwise.
 */
function rubyName(ref, target) {
  const constant = ref.const.replace(/^::/, "");
  const method = ref.name.slice(constant.length + 1);
  if (method === "" || !target?.ok || !target.facets) return ref.name;
  return (target.facets.defines ?? []).includes(method) ? ref.name : constant;
}

/**
 * What one record reaches for outside JavaScript's imports, as `{ file, names }`, its own file left
 * out. `records` holds every file's record by path, which says what the file reached defines.
 */
export function reachedFrom(rel, record, corpusRels, records) {
  const refs = record.facets?.refs;
  if (!refs?.length) return [];
  const ruby = familyOf(language(rel)) === "ruby";
  const reached = [];
  for (const ref of refs) {
    const file = ruby ? rubyTarget(ref, rubyIndex(corpusRels)) : treeTarget(ref, record, rel, corpusRels, records);
    if (file === null || file === rel) continue;
    reached.push({ file, names: [ruby ? rubyName(ref, records.get(file)) : treeName(ref, records.get(file))] });
  }
  return reached;
}

/** A call on a class is named `Class.method` where the class's file defines the method, and `Class` where it does not. */
function treeName(ref, target) {
  if (ref.member === undefined || !target?.ok || !target.facets) return ref.name;
  return (target.facets.defines ?? []).includes(ref.member) ? ref.name : ref.bare;
}
