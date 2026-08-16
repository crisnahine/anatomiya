/**
 * Where the tracked files live, counted directory by directory.
 *
 * Pure: it is handed a list of layout files and answers with counts. Nothing
 * here reads the filesystem or git, so the whole roster is testable from a
 * literal array and cannot move between two scans of the same tree.
 *
 * A layout file is `{ rel, lang, facets }`: the path, the language the corpus
 * gave it (null for anything this tool does not parse), and the facets the
 * parse worker read (null when the file was not parsed at all).
 */

import { namesakeCompanions, stemOf } from "./companions.mjs";

/**
 * The floor rises with the corpus, so a directory earns a line by holding a
 * share of the repository rather than a fixed number of files. Three is the
 * bottom: below it every directory in a small repository is a root.
 */
export const minRootFiles = (n) => Math.max(3, Math.ceil(0.01 * n));

// Directory names that make a file a test wherever the runner table came up
// empty. Whole segments, or `src/latest` is a test directory.
const TEST_DIRS = new Set(["test", "tests", "spec", "__tests__", "cypress", "e2e"]);
const TEST_NAME = /\.(test|spec|cy)\./;

const baseOf = (rel) => rel.slice(rel.lastIndexOf("/") + 1);
const dirOf = (rel) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");

/**
 * A test file is one the parse saw import a runner or call `describe`, or one
 * whose name or directory says so. The fallback carries the repositories whose
 * runner this tool has never heard of: the roster would rather print `test
 * files` than count a spec directory as source.
 */
export function isTestFile(rel, facets) {
  if (facets?.testRunner || facets?.testCalls) return true;
  if (TEST_NAME.test(baseOf(rel))) return true;
  const dir = dirOf(rel);
  return dir !== "" && dir.split("/").some((seg) => TEST_DIRS.has(seg));
}

/**
 * What to call the runner on the line. A Cypress spec imports nothing in most
 * repositories, so the directory answers where the parse could not; anything
 * else unnamed prints as `test files` rather than a guess.
 */
export function runnerOf(rel, facets) {
  if (facets?.testRunner) return facets.testRunner;
  return dirOf(rel).split("/").includes("cypress") ? "cypress" : "test files";
}

/**
 * Directory names that say nothing about what is inside them, so the roster
 * descends past them to the name a reader can use. Five words, not a taxonomy:
 * anything else is a name worth printing.
 */
export const SHELL_NAMES = new Set(["src", "lib", "app", "packages", "source"]);

// At most seven lines, so the section can never crowd out the area listing.
export const ROOT_BUDGET = 7;

// A directory one child almost fills is that child under another name.
const WRAPPER_SHARE = 0.8;

/**
 * The directories that get a line, and what folded away.
 *
 * There is no table of known roots. The tree is walked from the repository
 * root, which is never a root itself except in a repository that is one flat
 * directory; a directory is descended into when its name is a shell or when one
 * child holds almost all of it, and is otherwise a root. Anything below the
 * floor folds into the nearest root above it, or into the `more` count.
 *
 * Sorted by source files first, so an asset or documentation directory prints
 * after the code and never displaces it, and by path last, so two runs over one
 * tree order the lines the same way.
 */
export function layoutRoots(files, { minFiles, budget = ROOT_BUDGET }) {
  const tree = new Map();
  const node = (d) => tree.get(d) ?? tree.set(d, { direct: [], total: 0, children: new Set() }).get(d);
  for (const f of files) {
    const dir = dirOf(f.rel);
    node(dir).direct.push(f);
    for (let cur = dir; ; cur = dirOf(cur)) {
      node(cur).total++;
      if (cur === "") break;
      node(dirOf(cur)).children.add(cur);
    }
  }

  const out = [];
  const visit = (dir, isRoot) => {
    const n = node(dir);
    if (!isRoot && n.total < minFiles) return;
    const kids = [...n.children];
    const biggest = kids.reduce((b, k) => (node(k).total > (b === null ? 0 : node(b).total) ? k : b), null);
    const wrapper = biggest !== null && node(biggest).total >= WRAPPER_SHARE * n.total;
    if (!isRoot && !SHELL_NAMES.has(baseOf(dir)) && !wrapper) {
      out.push({ path: dir, dir, files: files.filter((f) => f.rel.startsWith(`${dir}/`)) });
      return;
    }
    // webpack's `lib/*.js` is 300 files in none of `lib/`'s children, so the
    // files a shell holds itself are their own candidate.
    if (!isRoot && n.direct.length >= minFiles) {
      out.push({ path: `${dir} (files at this level)`, dir, files: n.direct });
    }
    for (const k of kids) visit(k, false);
    // The repository root earns a line only when there is nothing else to
    // descend into, which is the one flat directory case.
    if (isRoot && kids.length === 0 && n.direct.length >= minFiles) out.push({ path: ".", dir: "", files: n.direct });
  };
  visit("", true);

  const covered = new Set(out.flatMap((r) => r.files.map((f) => f.rel)));
  const leftover = files.filter((f) => !covered.has(f.rel)).length;
  const source = new Map(out.map((r) => [r, r.files.filter((f) => f.lang).length]));
  out.sort((a, b) => source.get(b) - source.get(a) || b.files.length - a.files.length || a.path.localeCompare(b.path));
  const folded = out.slice(budget);
  return {
    roots: out.slice(0, budget),
    more: { roots: folded.length, files: folded.reduce((n, r) => n + r.files.length, 0) + leftover },
  };
}

// The shortest directory prefix every one of these directories starts with,
// by segment: `src/a` and `src/ab` share `src`, not `src/a`.
const commonDir = (dirs) => {
  let shared = null;
  for (const dir of dirs) {
    const segs = dir === "" ? [] : dir.split("/");
    if (shared === null) {
      shared = segs;
      continue;
    }
    let i = 0;
    while (i < shared.length && i < segs.length && shared[i] === segs[i]) i++;
    shared = shared.slice(0, i);
  }
  return shared === null || shared.length === 0 ? "." : shared.join("/");
};

/**
 * One group per runner, with the directory prefix its files share, biggest
 * first. This is the denominator the roster exists for: four vitest files
 * beside 102 Cypress specs read as the exception they are.
 */
export function testsLine(files) {
  const dirs = new Map();
  for (const f of files) {
    if (!isTestFile(f.rel, f.facets)) continue;
    const runner = runnerOf(f.rel, f.facets);
    if (!dirs.has(runner)) dirs.set(runner, []);
    dirs.get(runner).push(dirOf(f.rel));
  }
  return [...dirs]
    .map(([runner, group]) => ({ runner, root: commonDir(group), files: group.length }))
    .sort((a, b) => b.files - a.files || a.root.localeCompare(b.root));
}

// The extension is everything from the last dot of the name. A file with none,
// which on Ruby is a Rakefile, still gets counted under a name of its own.
const extOf = (rel) => {
  const base = baseOf(rel);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "(none)";
};

// The modules a JSX file could have inlined instead. JSX extensions are absent
// on purpose: a component beside a component is not the question.
const MODULE_EXTS = new Set([".ts", ".js", ".mjs", ".cjs", ".mts", ".cts"]);

const tally = (values) => {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

// The directory name most of the root's tests sit in, which is the difference
// between a `__tests__` directory and a spec beside the file it covers. Null
// unless it is where most of them are, or the name would speak for a minority.
const sharedSub = (group, dir) => {
  const ranked = tally(group.map((f) => dirOf(f.rel)).filter((d) => d !== dir).map(baseOf));
  return ranked.length > 0 && ranked[0][1] * 2 > group.length ? ranked[0][0] : null;
};

const testGroups = (tests, dir) => {
  const groups = new Map();
  for (const f of tests) {
    const runner = runnerOf(f.rel, f.facets);
    if (!groups.has(runner)) groups.set(runner, []);
    groups.get(runner).push(f);
  }
  return [...groups]
    .map(([runner, group]) => ({ runner, files: group.length, sub: sharedSub(group, dir) }))
    .sort((a, b) => b.files - a.files || a.runner.localeCompare(b.runner));
};

// Which extension the renderer marks `(JSX)`: the one holding the most JSX
// files, and only when at least half of that extension's files here hold it.
const jsxExtension = (jsxFiles, extCount) => {
  const ranked = tally(jsxFiles.map((f) => extOf(f.rel)));
  if (ranked.length === 0) return null;
  const [ext, n] = ranked[0];
  return n * 2 >= extCount.get(ext) ? ext : null;
};

/**
 * The counted ground for the granularity sentence: how many sibling modules the
 * root holds beside its components, what they are named, and how many of the
 * components define a function they keep to themselves. Both numbers print and
 * no side is chosen.
 */
const helperFacet = (own, jsxFiles) => {
  if (jsxFiles.length === 0) return null;
  const modules = own.filter(
    (f) => MODULE_EXTS.has(extOf(f.rel)) && !f.facets?.jsx && !isTestFile(f.rel, f.facets));
  if (modules.length === 0) return null;
  return {
    siblingModules: modules.length,
    stems: tally(modules.map((f) => stemOf(f.rel))).slice(0, 3).map(([stem]) => stem),
    inlineFiles: jsxFiles.filter((f) => f.facets?.inlineHelpers > 0).length,
  };
};

/**
 * One root's record. `allFiles` is the whole layout corpus because a namesake
 * test lives wherever the repository keeps its tests, which is rarely inside
 * the root it answers.
 *
 * Clauses that count nothing are absent rather than zero: a root with no
 * source file is not asked whether its files have tests.
 */
export function rootFacts(root, allFiles, testFiles = allFiles.filter((f) => isTestFile(f.rel, f.facets))) {
  const dir = root.dir ?? (root.path === "." ? "" : root.path);
  const own = root.files;
  const tests = own.filter((f) => isTestFile(f.rel, f.facets));
  const producers = own.filter((f) => f.lang && !isTestFile(f.rel, f.facets));
  const jsxFiles = own.filter((f) => f.facets?.jsx);
  const extCount = new Map(tally(own.map((f) => extOf(f.rel))));
  const exts = [...extCount].slice(0, 2);

  const record = {
    path: root.path,
    files: own.length,
    source: own.filter((f) => f.lang).length,
    exts,
    other: own.length - exts.reduce((n, [, count]) => n + count, 0),
    jsx: jsxFiles.length,
    jsxExt: jsxExtension(jsxFiles, extCount),
    tests: testGroups(tests, dir),
    // A root more than half of which is tests is a test directory, and the
    // renderer prints it as one and nothing else.
    testRoot: tests.length * 2 > own.length,
  };
  if (producers.length > 0 && testFiles.length > 0) {
    record.companions = namesakeCompanions(producers, testFiles, dir);
  }
  const helpers = helperFacet(own, jsxFiles);
  if (helpers !== null) record.helpers = helpers;
  return record;
}

/**
 * The whole `layout` record, minus the two fields the scan owns: whether the
 * corpus was truncated, and which principles the roster grounds.
 */
export function layoutFacts(files, { minFiles = minRootFiles(files.length), budget = ROOT_BUDGET } = {}) {
  const { roots, more } = layoutRoots(files, { minFiles, budget });
  const testFiles = files.filter((f) => isTestFile(f.rel, f.facets));
  return {
    size: files.length,
    minFiles,
    roots: roots.map((root) => rootFacts(root, files, testFiles)),
    more,
    tests: testsLine(files),
  };
}
