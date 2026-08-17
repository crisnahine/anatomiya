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

import { namesakeCompanions, namesakeIndex } from "./companions.mjs";
import { baseOf, dirOf, extOf, stemOf, withoutExtension } from "./paths.mjs";

// Every sort below breaks its tie on a name that gets rendered, and
// `localeCompare` orders case by whatever ICU tables the host was built with.
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The floor rises with the corpus, so a directory earns a line by holding a
 * share of the repository rather than a fixed number of files. Three is the
 * bottom: below it every directory in a small repository is a root.
 */
export const minRootFiles = (n) => Math.max(3, Math.ceil(0.01 * n));

/**
 * The one directory name that is a claim about the file rather than about where
 * a repository keeps things. Whole segments, or `src/latest` is one.
 *
 * Nothing but a test is ever put in a `__tests__`. A `spec` or `cypress` tree
 * holds the factories, fixtures, page objects and support code beside its
 * specs, and charging those to the runner is the roster's own denominator going
 * wrong: `136 test files under spec/factories` on empire-flippers/api,
 * `spec/support: 22 test files` on rubocop, 1,979 fixture modules under
 * webpack's `test/cases`.
 */
const TEST_DIRS = new Set(["__tests__"]);

// `_spec.rb` and `_test.rb` are how Ruby spells the same thing the dotted forms
// spell, and the hyphen is how Ember spells it: discourse writes 4,000 tests as
// `login-test.js` and no other signal in them says so. Only Cypress's `.cy.` is
// dotted-only, because `-cy.` is the tail of an ordinary word.
const TEST_NAME = /[.-](test|spec)\.|\.cy\.|_(spec|test)\.rb$/;

/**
 * The top-level directories a mirror is looked for under.
 *
 * Read for the mirror below and nothing else. Sitting in one of them is not
 * what makes a file a test, or every factory and page object filed beside the
 * specs is charged to the runner.
 */
const TEST_ROOTS = new Set(["test", "tests", "spec"]);

const inTestRoot = (rel) => rel.includes("/") && TEST_ROOTS.has(rel.slice(0, rel.indexOf("/")));

/**
 * The top-level directory names that make everything under them part of the
 * test tree, whether or not each file parses as a test.
 *
 * `TEST_ROOTS` plus the three a repository puts end-to-end specs in. Read for
 * the namesake clause below and nothing else: sitting in one of them is still
 * not what makes a file a test.
 */
const TEST_TREES = new Set([...TEST_ROOTS, "cypress", "e2e", "__tests__"]);

/**
 * Whether this root is, or is under, a top-level test tree.
 *
 * Its non-test files are what the tests run on, so a namesake count over them
 * is true and about nobody's question: webpack's `test` is 12,645 files of
 * which 2,607 are tests, and it read `1 of 7858 has a namesake test under test`
 * over the fixture modules the 2,607 exercise.
 *
 * Exported because `scripts/measure-layout.mjs` recounts the printed line and
 * a second copy of this rule there would measure the disagreement.
 */
export const underTestTree = (dir) => dir !== "" && TEST_TREES.has(dir.split("/")[0]);

/**
 * The files in a test tree that mirror a source file outside it.
 *
 * eslint's `tests/lib/rules/no-var.js` covers `lib/rules/no-var.js`. It carries
 * the name of the thing it tests and nothing else: no runner import, no
 * top-level `describe`, no suffix. What says it is a test is where it sits,
 * which is the source tree's own shape one directory down.
 *
 * Strip the test root and the rest has to tail-match a source path outside it,
 * the way `companions.mjs` matches a namesake, here in reverse. A single
 * segment left over is a bare basename and matches whatever happens to share
 * it, so it is refused for the reason `siblings.mjs` refuses one.
 *
 * Computed once over the whole layout corpus, because the question is about the
 * corpus and asking it per file walks it again.
 */
export function mirroredTests(files) {
  const outside = new Set();
  for (const f of files) {
    if (!f.lang || inTestRoot(f.rel)) continue;
    const segments = withoutExtension(f.rel).split("/");
    for (let i = 0; i < segments.length; i++) outside.add(segments.slice(i).join("/"));
  }

  const mirrored = new Set();
  for (const f of files) {
    if (!f.lang || !inTestRoot(f.rel)) continue;
    const under = withoutExtension(f.rel).slice(f.rel.indexOf("/") + 1);
    if (under.includes("/") && outside.has(under)) mirrored.add(f.rel);
  }
  return mirrored;
}

/**
 * A test file is one the parse saw import a runner or call `describe`, one
 * whose own name says so, one sitting in a `__tests__` directory, or one
 * mirroring a source file from inside a test tree. Four claims about the file;
 * where a repository files it is not one of them.
 *
 * The last three carry the repositories whose runner this tool has never heard
 * of, so the roster prints `test files` rather than counting a spec as source.
 * They are the fallback, and a plain `under a spec directory` was too wide: a
 * `spec/` tree holds the factories and the support code beside the specs, and
 * charging those to the runner is the roster's own denominator going wrong.
 *
 * `mirrored` is the set `mirroredTests` built over the whole corpus, absent
 * where the caller has no corpus to build it from.
 *
 * A file in no language this tool parses is never one of them. Twenty
 * screenshots under `cypress/` are not twenty specs, and counting them made the
 * tests line the roster exists to be a denominator read 24 over 4.
 */
export function isTestFile({ rel, lang, facets }, mirrored = null) {
  if (!lang) return false;
  if (facets?.testRunner || facets?.testCalls) return true;
  if (TEST_NAME.test(baseOf(rel))) return true;
  if (mirrored?.has(rel)) return true;
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
    // Nothing under it to descend into, so it is a root under its own name: the
    // label below separates a directory's own files from its children's lines
    // and there are no children here. The repository root is a root in this one
    // case and no other, which is a repository that is one flat directory.
    if (kids.length === 0) {
      if (n.direct.length >= minFiles) out.push({ path: isRoot ? "." : dir, dir, files: n.direct });
      return;
    }
    // rubocop prints `lib/rubocop (files at this level): 45 .rb` beside
    // `lib/rubocop/cop`, so the files a shell holds itself are their own
    // candidate.
    const before = out.length;
    if (!isRoot && n.direct.length >= minFiles) {
      out.push({ path: `${dir} (files at this level)`, dir, files: n.direct });
    }
    for (const k of kids) visit(k, false);
    // Descending named nothing, so the directory is what the reader gets.
    // Measured on webpack: `lib` is 652 files with 117 of them at this level
    // and no child clearing the floor, and the map named `test` and `examples`
    // and never mentioned webpack's source at all. Same on supabase's
    // `packages`, 880 files across small packages.
    if (!isRoot && out.length === before) {
      out.push({ path: dir, dir, files: files.filter((f) => f.rel.startsWith(`${dir}/`)) });
    }
  };
  visit("", true);

  const covered = new Set(out.flatMap((r) => r.files.map((f) => f.rel)));
  const leftover = files.filter((f) => !covered.has(f.rel)).length;
  const source = new Map(out.map((r) => [r, r.files.filter((f) => f.lang).length]));
  out.sort((a, b) => source.get(b) - source.get(a) || b.files.length - a.files.length || byCode(a.path, b.path));
  const folded = out.slice(budget);
  return {
    roots: out.slice(0, budget),
    more: { roots: folded.length, files: folded.reduce((n, r) => n + r.files.length, 0) + leftover },
  };
}

/**
 * The deepest directory that holds nearly all of these files, or null.
 *
 * Not the prefix every one of them shares. Measured across the corpus, 28 of 35
 * repositories keep one file of a runner outside the tree the rest sit in, and
 * a strict prefix collapses on that one file: the line read "1448 test files
 * under ." on angular and "106 Cypress specs under ." on the client, where the
 * whole job of the clause is to say where they are.
 *
 * The bar is the wrapper share, because it is the same question the roots ask:
 * a child holding four fifths of a directory stands in for it. Null rather than
 * "." where no directory clears it, since the repository root is not a place and
 * a clause naming it says nothing.
 */
export const majorityDir = (dirs) => {
  const bar = WRAPPER_SHARE * dirs.length;
  const prefix = [];
  for (;;) {
    const under = dirs.filter((d) => d.startsWith(prefix.length ? `${prefix.join("/")}/` : ""));
    const next = tally(under.map((d) => d.split("/")[prefix.length]).filter(Boolean));
    if (next.length === 0 || next[0][1] < bar) break;
    prefix.push(next[0][0]);
  }
  return prefix.length === 0 ? null : prefix.join("/");
};

/**
 * One group per runner, with the directory prefix its files share, biggest
 * first. This is the denominator the roster exists for: four vitest files
 * beside 102 Cypress specs read as the exception they are.
 */
export function testsLine(files, mirrored = null) {
  const dirs = new Map();
  for (const f of files) {
    if (!isTestFile(f, mirrored)) continue;
    const runner = runnerOf(f.rel, f.facets);
    if (!dirs.has(runner)) dirs.set(runner, []);
    dirs.get(runner).push(dirOf(f.rel));
  }
  return [...dirs]
    .map(([runner, group]) => ({ runner, root: majorityDir(group), files: group.length }))
    .sort((a, b) => b.files - a.files || byCode(a.root ?? "", b.root ?? "") || byCode(a.runner, b.runner));
}

// The modules a JSX file could have inlined instead. JSX extensions are absent
// on purpose: a component beside a component is not the question.
export const MODULE_EXTS = new Set([".ts", ".js", ".mjs", ".cjs", ".mts", ".cts"]);

export const tally = (values) => {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || byCode(a[0], b[0]));
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
    .sort((a, b) => b.files - a.files || byCode(a.runner, b.runner));
};

// Which extension the renderer marks `(JSX)`: the first one the line prints
// whose files are at least half JSX. An extension outside the printed two is
// not on the line, so a mark on it would have nothing to attach to.
const jsxExtension = (jsxFiles, exts) => {
  const jsxByExt = new Map(tally(jsxFiles.map((f) => extOf(f.rel))));
  for (const [ext, count] of exts) {
    if ((jsxByExt.get(ext) ?? 0) * 2 >= count) return ext;
  }
  return null;
};

/**
 * The counted ground for the granularity sentence: how many sibling modules the
 * root holds beside its components, what they are named, and how many of the
 * components define a function they keep to themselves. Both numbers print and
 * no side is chosen.
 */
const helperFacet = (own, jsxFiles, mirrored) => {
  if (jsxFiles.length === 0) return null;
  // A file the parse never reached has no JSX facet to be false, and reading its
  // absence as "not a component" charged the sentence with unread files.
  const modules = own.filter(
    (f) => f.facets && MODULE_EXTS.has(extOf(f.rel)) && !f.facets.jsx && !isTestFile(f, mirrored));
  if (modules.length === 0) return null;
  return {
    siblingModules: modules.length,
    stems: tally(modules.map((f) => stemOf(f.rel))).slice(0, 3).map(([stem]) => stem),
    inlineFiles: jsxFiles.filter((f) => f.facets?.inlineHelpers > 0).length,
  };
};

/**
 * The three indexes a root's record is counted against, walked once over the
 * whole corpus.
 *
 * One object rather than three arguments, because they are one answer: the
 * mirror decides which files are tests, the test files are what a namesake is
 * looked for among, and the stem map is that list keyed. A root holding two of
 * the three built from different populations counts one root against another
 * repository.
 */
export function layoutIndexes(files, mirrored = mirroredTests(files)) {
  const testFiles = files.filter((f) => isTestFile(f, mirrored));
  return { testFiles, mirrored, byStem: namesakeIndex(testFiles) };
}

/**
 * One root's record, counted against the whole corpus's indexes: a namesake
 * test lives wherever the repository keeps its tests, which is rarely inside
 * the root it answers.
 *
 * Clauses that count nothing are absent rather than zero: a root with no
 * source file is not asked whether its files have tests, and neither is one
 * inside a test tree, whose non-test files are what the tests run on.
 */
export function rootFacts(root, { testFiles, mirrored, byStem }) {
  const dir = root.dir ?? (root.path === "." ? "" : root.path);
  const own = root.files;
  const tests = own.filter((f) => isTestFile(f, mirrored));
  const jsxFiles = own.filter((f) => f.facets?.jsx);
  const exts = tally(own.map((f) => extOf(f.rel))).slice(0, 2);
  // The denominator has to be the number the line already printed, or `0 of
  // 620` stands beside `504 .tsx` and counts something the reader cannot see.
  const producers = own.filter(
    (f) => f.lang && extOf(f.rel) === exts[0]?.[0] && !isTestFile(f, mirrored));

  const record = {
    path: root.path,
    files: own.length,
    source: own.filter((f) => f.lang).length,
    exts,
    other: own.length - exts.reduce((n, [, count]) => n + count, 0),
    jsx: jsxFiles.length,
    jsxExt: jsxExtension(jsxFiles, exts),
    tests: testGroups(tests, dir),
    // A root more than half of which is tests is a test directory, and the
    // renderer prints it as one and nothing else.
    testRoot: tests.length * 2 > own.length,
  };
  if (producers.length > 0 && testFiles.length > 0 && !underTestTree(dir)) {
    record.companions = namesakeCompanions(producers, testFiles, dir, byStem);
  }
  const helpers = helperFacet(own, jsxFiles, mirrored);
  if (helpers !== null) record.helpers = helpers;
  return record;
}

/**
 * The whole `layout` record, minus the two fields the scan owns: whether the
 * corpus was truncated, and which principles the roster grounds.
 *
 * `indexes` is taken rather than built where the caller has one: a scan needs
 * the same three for the area kinds, and the two of them walking the corpus
 * apart is one walk too many for an answer that cannot differ.
 */
export function layoutFacts(
  files,
  { minFiles = minRootFiles(files.length), budget = ROOT_BUDGET, indexes = layoutIndexes(files) } = {}
) {
  const { roots, more } = layoutRoots(files, { minFiles, budget });
  return {
    size: files.length,
    minFiles,
    roots: roots.map((root) => rootFacts(root, indexes)),
    more,
    tests: testsLine(files, indexes.mirrored),
  };
}
