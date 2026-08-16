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

/**
 * The one directory name that is a claim about the file rather than about
 * where a repository keeps things. Whole segments, or `src/latest` is one.
 *
 * `test`, `tests`, `spec`, `cypress` and `e2e` were here and are not any more.
 * A repository keeps its factories, fixtures, page objects and support code in
 * the same tree as its specs, and counting all of it made the roster's own
 * denominator wrong: `136 test files under spec/factories` on
 * empire-flippers/api, `spec/support: 22 test files` on rubocop, 1,979 fixture
 * modules charged as tests under webpack's `test/cases`. `__tests__` stays
 * because nothing but a test is ever put in one.
 */
const TEST_DIRS = new Set(["__tests__"]);

// `_spec.rb` and `_test.rb` are how Ruby spells the same thing the dotted
// forms spell, and neither language's file says it in the other's shape.
const TEST_NAME = /\.(test|spec|cy)\.|_(spec|test)\.rb$/;

const baseOf = (rel) => rel.slice(rel.lastIndexOf("/") + 1);
const dirOf = (rel) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");

/**
 * A test file is one the parse saw import a runner or call `describe`, one
 * whose own name says so, or one sitting in a `__tests__` directory. Three
 * claims about the file; where a repository files it is not one of them.
 *
 * The name and the directory carry the repositories whose runner this tool has
 * never heard of, so the roster prints `test files` rather than counting a spec
 * as source. They are the fallback, and both were too wide: a `spec/` tree
 * holds the factories and the support code beside the specs, and charging those
 * to the runner is the roster's own denominator going wrong.
 *
 * A file in no language this tool parses is never one of them. Twenty
 * screenshots under `cypress/` are not twenty specs, and counting them made the
 * tests line the roster exists to be a denominator read 24 over 4.
 */
export function isTestFile({ rel, lang, facets }) {
  if (!lang) return false;
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
    // Nothing under it to descend into, so it is a root under its own name: the
    // label below separates a directory's own files from its children's lines
    // and there are no children here. The repository root is a root in this one
    // case and no other, which is a repository that is one flat directory.
    if (kids.length === 0) {
      if (n.direct.length >= minFiles) out.push({ path: isRoot ? "." : dir, dir, files: n.direct });
      return;
    }
    // webpack's `lib/*.js` is 117 files in none of `lib/`'s children, so the
    // files a shell holds itself are their own candidate.
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
  out.sort((a, b) => source.get(b) - source.get(a) || b.files.length - a.files.length || a.path.localeCompare(b.path));
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
const majorityDir = (dirs) => {
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
export function testsLine(files) {
  const dirs = new Map();
  for (const f of files) {
    if (!isTestFile(f)) continue;
    const runner = runnerOf(f.rel, f.facets);
    if (!dirs.has(runner)) dirs.set(runner, []);
    dirs.get(runner).push(dirOf(f.rel));
  }
  return [...dirs]
    .map(([runner, group]) => ({ runner, root: majorityDir(group), files: group.length }))
    .sort(
      (a, b) =>
        b.files - a.files || (a.root ?? "").localeCompare(b.root ?? "") || a.runner.localeCompare(b.runner)
    );
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
const helperFacet = (own, jsxFiles) => {
  if (jsxFiles.length === 0) return null;
  const modules = own.filter(
    (f) => MODULE_EXTS.has(extOf(f.rel)) && !f.facets?.jsx && !isTestFile(f));
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
export function rootFacts(root, allFiles, testFiles = allFiles.filter((f) => isTestFile(f))) {
  const dir = root.dir ?? (root.path === "." ? "" : root.path);
  const own = root.files;
  const tests = own.filter((f) => isTestFile(f));
  const jsxFiles = own.filter((f) => f.facets?.jsx);
  const exts = tally(own.map((f) => extOf(f.rel))).slice(0, 2);
  // The denominator has to be the number the line already printed, or `0 of
  // 620` stands beside `504 .tsx` and counts something the reader cannot see.
  const producers = own.filter(
    (f) => f.lang && extOf(f.rel) === exts[0]?.[0] && !isTestFile(f));

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
  const testFiles = files.filter((f) => isTestFile(f));
  return {
    size: files.length,
    minFiles,
    roots: roots.map((root) => rootFacts(root, files, testFiles)),
    more,
    tests: testsLine(files),
  };
}
