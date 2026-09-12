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

import { withoutExtension, byCode } from "./paths.mjs";

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
 */
export function specifierToFile(spec, importerRel, corpusRels) {
  if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") {
    const at = posix.join(posix.dirname(importerRel), spec);
    for (const candidate of [at, ...EXTENSIONS.map((e) => at + e), ...EXTENSIONS.map((e) => `${at}/index${e}`)]) {
      if (corpusRels.has(candidate)) return candidate;
    }
    return null;
  }

  const alias = ALIASES.find((a) => spec.startsWith(a));
  const tail = alias ? spec.slice(alias.length) : spec;
  // A single segment is a bare package name (`react`) or too short to identify
  // a file, and both are somebody else's module.
  if (!tail.includes("/")) return null;
  return tailIndex(corpusRels).get(`/${tail}`) ?? null;
}

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
  for (const rel of corpusRels) {
    const path = withoutExtension(rel);
    register(index, path, rel);
    // A directory resolves through its index file, so the directory's own tails
    // name it too.
    if (path.endsWith("/index")) register(index, path.slice(0, -"/index".length), rel);
  }
  TAIL_INDEX.set(corpusRels, index);
  return index;
}

/**
 * Null marks a tail two files answer to. An ambiguous specifier resolves to
 * nothing rather than to whichever file the corpus listed first, which would
 * credit one file with another's importers.
 */
function register(index, path, rel) {
  const segments = path.split("/");
  for (let i = 0; i < segments.length; i++) {
    const key = `/${segments.slice(i).join("/")}`;
    index.set(key, index.has(key) && index.get(key) !== rel ? null : rel);
  }
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
export function mostImported(areaRels, allRecords, corpusRels) {
  const byFile = reuseIndex(allRecords, corpusRels);

  const rows = [];
  for (const file of areaRels) {
    for (const [name, who] of byFile.get(file) ?? []) {
      let importers = 0;
      for (const rel of who) if (!areaRels.has(rel)) importers++;
      if (importers >= MIN_IMPORTERS) rows.push({ name, file, importers });
    }
  }
  return rows
    .sort((a, b) => b.importers - a.importers || byCode(a.name, b.name) || byCode(a.file, b.file))
    .slice(0, 5);
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

function reuseIndex(allRecords, corpusRels) {
  const cached = REUSE_INDEX.get(allRecords);
  if (cached && cached.corpusRels === corpusRels) return cached.byFile;

  const byFile = new Map();
  for (const [rel, r] of allRecords) {
    for (const i of r.facets?.imports ?? []) {
      const file = specifierToFile(i.module, rel, corpusRels);
      if (file === null) continue;
      let names = byFile.get(file);
      if (!names) byFile.set(file, (names = new Map()));
      for (const name of i.names) {
        let who = names.get(name);
        if (!who) names.set(name, (who = new Set()));
        who.add(rel);
      }
    }
  }
  REUSE_INDEX.set(allRecords, { corpusRels, byFile });
  return byFile;
}
