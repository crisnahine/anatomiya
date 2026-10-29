/**
 * What an area's files reach for, and what the rest of the repository reaches
 * into it for.
 *
 * Two rosters, not two claims. Nothing here is gated or compared against a
 * baseline: they answer "what would a new file in here import, and what should I
 * check for before writing another one", which is a count with a share floor
 * rather than a directive anybody has to obey.
 *
 * Over parse records the way `layout.mjs` is over layout files: a record is
 * `{ rel, ok, facets: { imports } }` and the corpus is a set of paths, so the
 * whole thing is testable from literals and cannot move between two scans of
 * the same tree. The two indexes below are memoised on those inputs, which a
 * scan builds once and never mutates.
 */

import { posix } from "node:path";

import { SOURCE_OF } from "./companions.mjs";
import { embeddedIn, language } from "./langs.mjs";
import { claim, dirOf, extOf, withoutExtension, byCode, tailsOf, TAIL_MOST } from "./paths.mjs";
import { reachedFrom } from "./refs.mjs";

/**
 * The packages a JSX area cannot be written without, so importing one says
 * nothing about this directory. A closed table for the same reason the
 * framework list is one: "this React area imports React" is a line the reader
 * already has.
 *
 * Matched on the package, so every subpath of one is runtime too: `next/link`
 * and `react-dom/client` are the framework, and a package that merely starts
 * with the same word (`next-auth`) is not.
 */
export const RUNTIME_MODULES = new Set([
  "react",
  "react-dom",
  "react/jsx-runtime",
  "vue",
  "@angular/core",
  "svelte",
  "next",
]);

const SHARE_FLOOR = 0.6;
const MIN_IMPORTING_FILES = 5;
const MIN_IMPORTERS = 3;

// Every extension a specifier may leave off, in the order a bundler tries them.
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

// The prefixes a repository points at its own root with. Stripped before the
// tail match, or `@/utils/user` looks for a directory literally called `@`.
const ALIASES = ["~/", "@/", "#/", "src/"];

// SvelteKit's alias for the `src/lib` of the importer's own project. A `svelte.config.js` that repoints it is not read.
const LIB_ALIAS = "$lib/";

/**
 * The modules most files in an area import, top three.
 *
 * The denominator is the files that import anything, not the files in the area:
 * a directory of pure data modules would otherwise drag every share down and the
 * line would report a habit weaker than the one its importing files have.
 * Relative specifiers are skipped, because a sibling import is a fact about one
 * file rather than a convention a new file should follow.
 */
export function commonImports(areaRecords) {
  const importing = areaRecords.filter((r) => r.facets?.imports?.length);
  if (importing.length < MIN_IMPORTING_FILES) return [];

  const byModule = new Map();
  for (const r of importing) {
    for (const module of new Set(r.facets.imports.filter((i) => !i.relative).map((i) => i.module))) {
      if (RUNTIME_MODULES.has(packageOf(module))) continue;
      byModule.set(module, (byModule.get(module) || 0) + 1);
    }
  }

  return [...byModule]
    .filter(([, files]) => files / importing.length >= SHARE_FLOOR)
    .sort((a, b) => b[1] - a[1] || byCode(a[0], b[0]))
    .slice(0, 3)
    .map(([module, files]) => ({ module, files, of: importing.length }));
}

// What a specifier is a subpath of. A scope is part of the name, so
// `@angular/core/testing` is `@angular/core` and `lodash/fp` is `lodash`.
const packageOf = (spec) => {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
};

/**
 * The corpus file a specifier names, or null.
 *
 * `companions.mjs` answers a narrower question textually and does not call this.
 * The reasons are stated there; a change to resolution here should be read
 * against that one.
 *
 * The same shape `pairing.mjs` learns a companion root with: a tail rather than
 * a basename, so the subtree has to match too, and an ambiguous tail resolves to
 * nothing rather than to whichever file sorted first. No `tsconfig` is read: the
 * aliases a repository points at its own root with are a short closed list, and
 * a wrong resolution here would credit one file with another's importers.
 *
 * A specifier written with an emitted extension names the TypeScript source it
 * is emitted from, which is what Node16 and NodeNext require on every relative
 * import: `../utils/format.js` is `format.ts`. Read off the same table the
 * companions use, after the file spelled exactly, so a real `format.js` beside
 * the source is still the one named.
 */
export function specifierToFile(spec, importerRel, corpusRels, packages = null) {
  // A trailing slash names a directory, so only its index answers: `./base/`
  // is never `base.ts`.
  const dirOnly = spec.endsWith("/");
  if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") {
    return fileAt(posix.join(posix.dirname(importerRel), spec), dirOnly, corpusRels);
  }

  // A package this repository's own workspace declares, by the name its manifest gives it: its own
  // entry, then a `src` and the package's directory, as a source tree lays them out.
  const name = packageOf(spec);
  const declared = packages?.get(name);
  if (declared) {
    const { dir, entries } = declared;
    const rest = withoutTrailingSlashes(spec.slice(name.length + 1));
    const files = rest === ""
      ? [...entries.map((e) => fileAt(posix.join(dir, e), false, corpusRels)), fileAt(posix.join(dir, "src"), true, corpusRels), fileAt(dir, true, corpusRels)]
      : [fileAt(posix.join(dir, "src", rest), dirOnly, corpusRels), fileAt(posix.join(dir, rest), dirOnly, corpusRels)];
    return files.find((file) => file !== null) ?? null;
  }

  if (spec.startsWith(LIB_ALIAS)) {
    // Never the tail match below: two apps each hold a `src/lib/utils.ts`,
    // and a `tools/lib` is nobody's `$lib`.
    return inProject(importerRel, [posix.join("src/lib", spec.slice(LIB_ALIAS.length))], dirOnly, corpusRels);
  }

  const alias = ALIASES.find((a) => spec.startsWith(a));
  const tail = withoutTrailingSlashes(alias ? spec.slice(alias.length) : spec);
  // A single segment is a bare package name (`react`) or too short to identify
  // a file, and both are somebody else's module.
  if (!tail.includes("/")) return null;
  // A component's package keeps its components under the names another
  // package's modules have, and a component answers no bare tail: the tail
  // match below would hand its import to the one file left, in the other
  // package. A module's alias stays a tail, since a root such as `~/` for
  // `modules/` sits beside its importers and above none of them.
  if (alias && embeddedIn(language(importerRel)) !== null) {
    return inProject(importerRel, [tail, posix.join("src", tail)], dirOnly, corpusRels);
  }
  const { stems: index, spelled } = tailIndex(corpusRels);
  if (dirOnly) return index.get(`/${tail}/index`) ?? null;
  const named = spelled.get(`/${tail}`);
  if (named !== undefined) return named;
  const whole = index.get(`/${tail}`);
  if (whole !== undefined) return whole;
  // The index is keyed without extensions, so a tail that writes one is looked
  // up by its stem, and the file found counts only where it is the one the tail
  // spells or a source that emits it: `utils/parse.js` is not `parse.rb`.
  const ext = extOf(tail);
  const found = index.get(`/${withoutExtension(tail)}`) ?? null;
  return found !== null && [ext, ...(SOURCE_OF[ext] ?? [])].includes(extOf(found)) ? found : null;
}

/**
 * A path with the slashes it ends in taken off, by a walk from its end: a
 * pattern anchored there tries every start in a run of slashes elsewhere in a
 * specifier as written, and 80,000 of them held one import for 3.4 seconds.
 */
function withoutTrailingSlashes(path) {
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") end -= 1;
  return path.slice(0, end);
}

/**
 * The one file `paths` name under a directory above the importer, or null.
 *
 * Null where two directories answer with different files: the alias means one
 * root and no path says which, and the nearest is a feature's own
 * `components` as often as it is the project's.
 *
 * Asked of an index of path tails, never by building each path under each
 * directory: that cost grows with the square of the importer's depth, and one
 * component 400 directories down holds a scan for 33 seconds on 4,000 imports.
 */
function inProject(importerRel, paths, dirOnly, corpusRels) {
  const index = projectIndex(corpusRels);
  const above = directoriesAbove(posix.dirname(importerRel), index);
  const found = new Set();
  for (const path of paths) {
    // What `posix.join` makes of the path under any directory: the steps it climbs, then the rest.
    const segments = withoutTrailingSlashes(posix.join(".", path)).split("/");
    const climbs = segments.filter((segment) => segment === "..").length;
    const rest = segments.slice(climbs).join("/");
    const named = rest === "" || rest === "." ? directoriesNamed(above, climbs, dirOnly, corpusRels) : tailsNamed(rest, above, climbs, dirOnly, index);
    for (const file of named) found.add(file);
  }
  return found.size === 1 ? [...found][0] : null;
}

/** The files `rest` names under each directory at least `climbs` steps above the importer's: the first spelling each directory holds. */
function tailsNamed(rest, above, climbs, dirOnly, index) {
  const named = [];
  const answered = new Set();
  for (const candidate of candidatesAt(rest, dirOnly)) {
    const held = index.tails.get(candidate);
    if (held === undefined) continue;
    const alone = typeof held === "string";
    // The shorter of the two is walked, so neither a deep importer nor a tail a thousand files end in sets the cost alone.
    const fewer = alone ? [held] : held.size <= above.steps.size ? held.keys() : above.steps.keys();
    for (const prefix of fewer) {
      if (!(alone || held.has(prefix)) || !(above.steps.get(prefix) >= climbs) || answered.has(prefix)) continue;
      answered.add(prefix);
      named.push(prefix === "" ? candidate : `${prefix}/${candidate}`);
    }
  }
  return named;
}

/** The files a path that is itself a directory above the importer names: `a/b` as `a/b.ts` or `a/b/index.ts`. */
function directoriesNamed(above, climbs, dirOnly, corpusRels) {
  let files = above.named.get(dirOnly);
  if (files === undefined) {
    files = above.dirs.map((dir) => (dir === "" ? null : fileAt(dir, dirOnly, corpusRels)));
    above.named.set(dirOnly, files);
  }
  const named = new Set();
  for (let step = climbs; step < files.length; step++) if (files[step] !== null) named.add(files[step]);
  return named;
}

/** Every directory above one, nearest first and the repository's top last as `""`, built once for each importer's directory. */
function directoriesAbove(dir, index) {
  const cached = index.above.get(dir);
  if (cached) return cached;

  const dirs = [];
  for (let at = dir === "." ? "" : dir; at !== ""; at = dirOf(at)) dirs.push(at);
  dirs.push("");
  const built = { dirs, steps: new Map(dirs.map((at, step) => [at, step])), named: new Map() };
  index.above.set(dir, built);
  return built;
}

/**
 * Every whole tail of every path in the corpus, extension kept, and the
 * directories each sits under. Built on the first alias `inProject` answers, so
 * a repository with none pays nothing, and memoised on the set as the tail
 * index below is.
 *
 * A tail one directory holds is kept with that directory as itself, and with a
 * set from the second: most tails are one file's, and a set for each retained
 * 195 MB on 100,000 files eight segments deep.
 */
const PROJECT_INDEX = new WeakMap();

function projectIndex(corpusRels) {
  const cached = PROJECT_INDEX.get(corpusRels);
  if (cached) return cached;

  const tails = new Map();
  for (const rel of corpusRels) {
    // The last segments at most, as `register` keeps: every tail costs the length of the path again.
    let cut = -1;
    for (let extra = rel.split("/").length - TAIL_MOST; extra > 0; extra--) cut = rel.indexOf("/", cut + 1);
    for (let last = false; !last; cut = rel.indexOf("/", cut + 1)) {
      const tail = rel.slice(cut + 1);
      const prefix = rel.slice(0, Math.max(cut, 0));
      const held = tails.get(tail);
      if (held === undefined) tails.set(tail, prefix);
      else if (typeof held === "string") tails.set(tail, new Set([held, prefix]));
      else held.add(prefix);
      last = !tail.includes("/");
    }
  }
  const built = { tails, above: new Map() };
  PROJECT_INDEX.set(corpusRels, built);
  return built;
}

/** The file a path names as written, through an extension it leaves off or emits, or as a directory's index. */
function fileAt(path, dirOnly, corpusRels) {
  return candidatesAt(withoutTrailingSlashes(path), dirOnly).find((candidate) => corpusRels.has(candidate)) ?? null;
}

/** Every spelling of the file a path names, in the order a bundler tries them. */
function candidatesAt(at, dirOnly) {
  const indexes = EXTENSIONS.map((e) => `${at}/index${e}`);
  return dirOnly ? indexes : [at, ...emittedFrom(at), ...EXTENSIONS.map((e) => at + e), ...indexes];
}

/** The TypeScript sources a path spelled with an emitted extension is compiled from. */
const emittedFrom = (path) => (SOURCE_OF[extOf(path)] ?? []).map((ext) => withoutExtension(path) + ext);

/**
 * Every path tail in the corpus, and the one file it names.
 *
 * Memoised on the set itself because the answer is a function of it and every
 * area asks the same corpus a few thousand times: walking it per specifier ran
 * a 5,000-file repository past ten minutes. A set nobody mutates is the only
 * one this is correct for, which is what the scan builds.
 */
const TAIL_INDEX = new WeakMap();

function tailIndex(corpusRels) {
  const cached = TAIL_INDEX.get(corpusRels);
  if (cached) return cached;

  const index = new Map();
  // A component answers only a tail that spells its extension, as a bundler
  // resolves it; answering by its stem makes the module of its name beside it ambiguous.
  const spelled = new Map();
  for (const rel of corpusRels) {
    if (embeddedIn(language(rel)) !== null) {
      register(spelled, rel, rel);
      continue;
    }
    const path = withoutExtension(rel);
    register(index, path, rel);
    // A directory resolves through its index file, so the directory's own tails
    // name it too.
    if (path.endsWith("/index")) register(index, path.slice(0, -"/index".length), rel);
  }
  const built = { stems: index, spelled };
  TAIL_INDEX.set(corpusRels, built);
  return built;
}

/**
 * Null marks a tail two files answer to. An ambiguous specifier resolves to
 * nothing rather than to whichever file the corpus listed first, which would
 * credit one file with another's importers.
 */
function register(index, path, rel) {
  for (const tail of tailsOf(path)) claim(index, `/${tail}`, rel);
}

/** The file a module specifier in `file` names, asked once per file and specifier. */
function nextOf(ctx, file, module) {
  const key = `${file}\0${module}`;
  if (!ctx.next.has(key)) ctx.next.set(key, specifierToFile(module, file, ctx.corpusRels, ctx.packages));
  return ctx.next.get(key);
}

/** A file's own exports as a set, made once per file. */
function ownExports(ctx, file) {
  let exported = ctx.exports.get(file);
  if (!exported) ctx.exports.set(file, (exported = new Set(ctx.records.get(file)?.facets?.exports ?? [])));
  return exported;
}

/** The files a file's `export *` lines name, in the order it lists them, read once per file. */
function starsOf(ctx, file) {
  let stars = ctx.stars.get(file);
  if (!stars) {
    stars = (ctx.records.get(file)?.facets?.reexports ?? []).flatMap((r) => {
      const next = r.names === "*" ? nextOf(ctx, file, r.module) : null;
      return next === null ? [] : [next];
    });
    ctx.stars.set(file, stars);
  }
  return stars;
}

/**
 * Every name a file hands an importer, its own and those its barrels pass on. Barrels that hand one
 * another on in a cycle hand on the same names, so each such group is read whole (Tarjan's walk),
 * and what one file holds never depends on which file of it was asked first.
 */
function namesOf(ctx, start) {
  const held = ctx.names.get(start);
  if (held) return held;
  // The walk's order and low links stay on `ctx`: a file it finished is in `ctx.names` and never walked again.
  const { order, low, stack } = ctx;
  const visit = (file) => {
    order.set(file, order.size);
    low.set(file, order.get(file));
    stack.push(file);
    for (const to of starsOf(ctx, file)) {
      if (ctx.names.has(to)) continue;
      if (!order.has(to)) visit(to);
      if (stack.includes(to)) low.set(file, Math.min(low.get(file), low.get(to)));
    }
    if (low.get(file) !== order.get(file)) return;
    const group = new Set(stack.splice(stack.indexOf(file)));
    const handsOn = (member) => starsOf(ctx, member).length > 0 || (ctx.records.get(member)?.facets?.reexports ?? []).length > 0;
    // A file that hands nothing on hands on its own exports, and that set serves.
    if (group.size === 1 && !handsOn(file)) {
      ctx.names.set(file, ownExports(ctx, file));
      return;
    }
    const names = new Set();
    for (const member of group) {
      for (const name of ownExports(ctx, member)) names.add(name);
      for (const r of ctx.records.get(member)?.facets?.reexports ?? []) if (r.names !== "*") for (const [, as] of r.names) names.add(as);
      for (const to of starsOf(ctx, member)) if (!group.has(to)) for (const name of ctx.names.get(to)) names.add(name);
    }
    for (const member of group) ctx.names.set(member, names);
  };
  visit(start);
  return ctx.names.get(start);
}

/** Each name a file's `export *` lines hand on, to the first of the files they name that hands it. */
function suppliersOf(ctx, file) {
  let suppliers = ctx.suppliers.get(file);
  if (suppliers) return suppliers;
  suppliers = new Map();
  for (const next of starsOf(ctx, file)) for (const name of namesOf(ctx, next)) if (!suppliers.has(name)) suppliers.set(name, next);
  ctx.suppliers.set(file, suppliers);
  return suppliers;
}

/**
 * The file that defines a name an importer takes from `file`, followed through the barrels that hand
 * it on: `export * from` and `export { a as b } from`. Null where no file down the chain is seen
 * defining it, and where the chain runs back on itself; the importer's own file then keeps it.
 */
function definedIn(ctx, file, name, seen) {
  const key = `${file}\0${name}`;
  const facets = ctx.records.get(file)?.facets;
  if (!facets || seen.has(key)) return null;
  seen.add(key);
  const renamed = (facets.reexports ?? []).flatMap((r) => (r.names === "*" ? [] : r.names.filter(([, as]) => as === name).map(([from]) => [r.module, from])));
  if (renamed.length === 0 && ownExports(ctx, file).has(name)) return { file, name };
  if (renamed.length > 0) {
    const [module, from] = renamed[0];
    const next = nextOf(ctx, file, module);
    return next === null ? null : definedIn(ctx, next, from, seen);
  }
  const next = suppliersOf(ctx, file).get(name);
  return next === undefined ? null : definedIn(ctx, next, name, seen);
}

/** The parts of a qualified name an import or a call writes: `Role.find`, `Admin::Role`, `Role#find`. */
const partsOf = (name) => name.split(/::|[.#]/);

/**
 * Which files other than its own import or call each of a file's `symbols`, off
 * the names `reuseIndex` resolved to it, and which symbols each name credits. A
 * call written `Class.method` credits the method of that class and the class;
 * one qualified by a module or a package, `db.GetEngine`, the file's own
 * function of that name, or the one an inline module of that name holds,
 * `util::parse`; a bare name every symbol of that name. The one rule the code
 * index and the area's reuse line both count by.
 */
export function creditOf(symbols, byName, rel) {
  const files = symbols.map(() => new Set());
  const names = new Map();
  // Looked up by name: tried against every symbol, a file of thousands of definitions
  // read each name it is reached by thousands of times.
  const named = new Map();
  const classes = new Map();
  for (const [i, [name, kind]] of symbols.entries()) {
    if (!named.has(name)) named.set(name, []);
    named.get(name).push(i);
    if (kind === "class" || kind === "module" || kind === "type") {
      if (!classes.has(name)) classes.set(name, []);
      classes.get(name).push(i);
    }
  }
  const credit = (i, who) => {
    for (const file of who) if (file !== rel) files[i].add(file);
  };
  for (const [name, who] of byName ?? []) {
    const parts = partsOf(name);
    const owner = parts.length > 1 ? parts.at(-2) : null;
    const meant = [];
    for (const i of named.get(parts.at(-1)) ?? []) {
      const container = symbols[i][3];
      if (owner === null || (classes.has(owner) ? owner === container : container === null || container === owner)) meant.push(i);
    }
    for (const i of meant) credit(i, who);
    for (const part of new Set(parts)) for (const i of classes.get(part) ?? []) credit(i, who);
    if (meant.length) names.set(name, meant);
  }
  return { files, names };
}

/**
 * The names the rest of the repository imports out of an area, top five.
 *
 * Only importers outside the area: a directory importing its own files is how
 * it is written, not who depends on it, and counting siblings made this
 * repository's own `lib` line report twelve readers of a name eleven of its own
 * files pull in. Counted in importing files rather than import statements, so
 * one module that pulls a name twice is one reader of it. This is the counted
 * form of "check before you create": five names with numbers beats a list of
 * every export the directory has.
 */
export function mostImported(areaRels, allRecords, corpusRels, own = null) {
  const byFile = reuseIndex(allRecords, corpusRels, own);

  const rows = [];
  for (const file of areaRels) {
    const byName = byFile.get(file);
    if (!byName) continue;
    // A name the code index credits to a definition counts every file that definition is credited
    // with, so the line and `find` agree about one helper; a name no definition answers counts its own.
    const { files: credited, names } = creditOf(allRecords.get(file)?.facets?.symbols ?? [], byName, file);
    for (const [name, who] of byName) {
      // A namespace import names no export, so it is no name to look for: it
      // printed as an empty entry, "most imported from here:  (5 files)".
      if (name === "*") continue;
      const reaching = new Set(who);
      for (const i of names.get(name) ?? []) for (const rel of credited[i]) reaching.add(rel);
      let importers = 0;
      for (const rel of reaching) if (!areaRels.has(rel)) importers++;
      if (importers >= MIN_IMPORTERS) rows.push({ name: rowName(name, file), file, importers });
    }
  }
  return rows
    .sort((a, b) => b.importers - a.importers || byCode(a.name, b.name) || byCode(a.file, b.file))
    .slice(0, 5);
}

/**
 * What a row is called. A default import, and a `require` bound whole, is
 * `default` on every module, so five areas each read "default (5)" and none of
 * them said which file it was: the module's own name is what an importer
 * writes, and an index file is imported by its directory's.
 */
function rowName(name, file) {
  if (name !== "default") return name;
  const path = withoutExtension(file);
  const segments = path.split("/");
  const stem = segments.length > 1 && segments.at(-1) === "index" ? segments.at(-2) : segments.at(-1);
  return `${stem} (default)`;
}

/**
 * Who imports which name out of which file, over the whole repository.
 *
 * Memoised for the reason `roster` hands out a closure rather than a second
 * entry point: the question is asked once per area and the answer is over the
 * corpus, so building it per area is the shape of this that does not scale.
 * Both inputs are keys, because the same records read against another corpus
 * resolve somewhere else.
 */
const REUSE_INDEX = new WeakMap();

/** Each file's names as `Map(name, Set(importing file))`, by the file that defines them. */
export function reuseIndex(allRecords, corpusRels, own) {
  const cached = REUSE_INDEX.get(allRecords);
  if (cached && cached.corpusRels === corpusRels && cached.own === own) return cached.byFile;
  const packages = own?.packages ?? null;

  const byFile = new Map();
  const add = (file, names, rel) => {
    let held = byFile.get(file);
    if (!held) byFile.set(file, (held = new Map()));
    for (const name of names) {
      let who = held.get(name);
      if (!who) held.set(name, (who = new Set()));
      who.add(rel);
    }
  };
  const owners = new Map();
  const ctx = { records: allRecords, corpusRels, packages, next: new Map(), exports: new Map(), stars: new Map(), names: new Map(), suppliers: new Map(), order: new Map(), low: new Map(), stack: [] };
  for (const [rel, r] of allRecords) {
    for (const i of r.facets?.imports ?? []) {
      const file = specifierToFile(i.module, rel, corpusRels, packages);
      if (file === null) continue;
      for (const name of i.names) {
        const key = `${file}\0${name}`;
        if (!owners.has(key)) owners.set(key, (name === "*" ? null : definedIn(ctx, file, name, new Set())) ?? { file, name });
        const owner = owners.get(key);
        add(owner.file, [owner.name], rel);
      }
    }
    for (const { file, names } of reachedFrom(rel, r, corpusRels, allRecords, own?.modules ?? null)) add(file, names, rel);
  }
  REUSE_INDEX.set(allRecords, { corpusRels, own, byFile });
  return byFile;
}
