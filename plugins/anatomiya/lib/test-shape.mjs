/**
 * Every spelling of "how a test file is named", in one place.
 *
 * Four modules each carried their own: the roster's basename regexes, the
 * namesake suffix list, minitest's path rule, and the runner labels. All of
 * them are suffix-shaped, so a fifth spelling meant four edits with nothing
 * failing at three, and a prefix convention was not expressible anywhere. The
 * spellings deliberately differ per question, is-test against namesake against
 * mirror-tree, and sitting side by side is what makes each difference a stated
 * fact rather than a scattered surprise; `test/test-shape.test.mjs` pins them.
 *
 * A leaf, because `facets.mjs` reads it and the parser child reads the facets.
 */

// `_spec.rb` and `_test.rb` are how Ruby spells the same thing the dotted forms
// spell, and the hyphen is how Ember spells it: discourse writes 4,000 tests as
// `login-test.js` and no other signal in them says so. Only Cypress's `.cy.` is
// dotted-only, because `-cy.` is the tail of an ordinary word.
// Two expressions rather than one alternation, because only the Ruby form is
// anchored and a `$` that binds one branch of three reads as if it bound all.
export const TEST_NAME = /[.-](?:test|spec)\.|\.cy\./;
export const RUBY_TEST_NAME = /_(?:spec|test)\.rb$/;

// The `_test` half of the Ruby form alone, over the whole path: minitest's own
// convention, read where a base class has not already answered the question.
export const MINITEST_NAME = /(^|\/)[^/]*_test\.rb$/;

// The five ways a test file spells the name of the file it covers. No hyphen
// form, deliberately: `login-test.js` is a test by the regex above, and whether
// it should also answer `login.js` as a namesake is a corpus question.
export const NAMESAKE_SUFFIXES = ["_spec", "_test", ".test", ".spec", ".cy"];

/**
 * How much of a directory has to agree before a second spelling for the name a
 * test covers is one, and the floor below which no share is evidence.
 *
 * Two readings ask it, the roster's namesake count and the file-to-file
 * obligation, and they must not drift: one is what an area's `kinds` line
 * prints and the other is the claim under it, about the same files. Each takes
 * the share over the population it has, the obligation over the producers under
 * one companion root and the roster over the test files in one directory, so
 * the bar is one number and not one denominator.
 *
 * Measured over the 35-repository corpus, per companion root. Five spellings
 * clear the floor of three: openfoodnetwork's `_rake_spec` at 5 of 15 and
 * empire-flippers/api's `_model_spec` at 52 of 166, both real, and three
 * readings of openproject's `_integration_spec`, the largest 28 of 479. A fifth
 * admits the two and the nearest thing it refuses sits under a sixteenth, and
 * that one is a different file's spec caught by its own name, `user.rb` beside
 * `user_membership_spec.rb`.
 */
export const LEARNED_SUFFIX_SHARE = 0.2;
export const LEARNED_SUFFIX_FLOOR = 3;

/**
 * Where a learned spelling may begin: at a separator, never inside a name.
 *
 * `m0.rb` beside `m0book_spec.rb` is not `m0`'s spec written with a `book_spec`
 * spelling, it is `m0book`'s. Every second spelling the corpus actually holds
 * starts at one of these, `_model_spec`, `.unittest`, `-test`, and on a small
 * root the floor and the share coincide, so the noise gate alone cannot tell
 * the two apart.
 */
export const startsAtSeparator = (extra) => /^[._-]/.test(extra);

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
export const TEST_DIRS = new Set(["__tests__"]);

/**
 * The top-level directories a mirror is looked for under.
 *
 * Read for the mirror and nothing else. Sitting in one of them is not what
 * makes a file a test, or every factory and page object filed beside the specs
 * is charged to the runner.
 */
export const TEST_ROOTS = new Set(["test", "tests", "spec"]);

/**
 * The top-level directory names that make everything under them part of the
 * test tree, whether or not each file parses as a test.
 *
 * `TEST_ROOTS` plus the three a repository puts end-to-end specs in. Sitting in
 * one of them is still not what makes a file a test.
 */
export const TEST_TREES = new Set([...TEST_ROOTS, "cypress", "e2e", "__tests__"]);

/**
 * The seven directory names that say which half of a split a path is on rather
 * than what sits in it. Dropping them leaves the shape the two halves share:
 * `budgets/app/models` and `modules/budgets/spec/models` both come down to
 * `budgets/models`.
 *
 * A closed list of tree words, not a rule about test directories: `support` is
 * left in place, so `spec/support/user.rb` still answers no `app/models/user.rb`.
 */
export const TREE = new Set(["app", "lib", "src", "spec", "test", "tests", "__tests__"]);

// The two runners a reader spells differently from the module a spec imports.
// Everything else prints as the closed table in `facets.mjs` named it.
export const RUNNER_LABELS = { cypress: "Cypress", rspec: "RSpec" };

// The runner nothing named. "4 test files specs" is not a phrase, so this one
// carries its own noun and never the word specs.
export const UNNAMED_RUNNER = "test files";

// Maven's failsafe suffix is capitals alone, so the word before it has to end
// in lower case for it to be a suffix at all: `FooIT`, never `EXIT`.
const JVM_NAMES = { camel: ["Tests", "Test", "IT"] };

/**
 * How each language tree-sitter reads names a test file, and what the name
 * says it covers. One entry per family and read inside it only: a Go test is
 * no test of a Python file that shares its stem.
 *
 * Measured over three repositories per language. `alone` is a name the
 * language's own tool collects by. Go builds a `_test.go` file under `go test`
 * and nowhere else: 578 files, 567 holding a case and the other 11 helpers no
 * build ships. pytest collects `test_*.py`: 1,180 files, 1,168 holding a case.
 * `_test.py` is the other half of pytest's default and no measured repository
 * writes one, so it is here on pytest's word.
 *
 * A CamelCase suffix is a word a source file wears in earnest, junit's own
 * `RepeatedTest.java` and Laravel's `UnitTest.php` among them, so it names a
 * test only under a test tree, the way `_spec.rb` does: of 3,691 files so
 * named, 17 sit outside every test tree and 9 of those are no test. `Spec` is
 * absent: two files in the 21 repositories end in it and neither is a test.
 * `TestCase` is what a base class is called, 69 files and 24 with no case.
 *
 * Rust has no name. cargo collects by place by default, a file directly in a
 * crate's `tests`, and a file's own unit tests sit inside it.
 */
export const FAMILY_TEST_NAMES = {
  python: { prefixes: ["test_"], suffixes: ["_test"], alone: true },
  php: { camel: ["Test"] },
  go: { suffixes: ["_test"], alone: true },
  java: JVM_NAMES,
  csharp: { camel: ["Tests", "Test"] },
  rust: {},
  kotlin: JVM_NAMES,
};

// A suffix holding a lower-case letter starts a word with its own capital.
const endsAWord = (before, suffix) => before !== "" && (/\p{Ll}/u.test(suffix) || /[\p{Ll}\d]$/u.test(before));

/**
 * The stem a test file's name says it covers, or null where the name is not a
 * test's in this family: `FooTest` covers `Foo` in Java and nothing in Python.
 */
export function coveredStem(stem, family) {
  const names = FAMILY_TEST_NAMES[family];
  if (!names) return null;
  for (const prefix of names.prefixes ?? []) {
    if (stem.length > prefix.length && stem.startsWith(prefix)) return stem.slice(prefix.length);
  }
  for (const suffix of names.suffixes ?? []) {
    if (stem.length > suffix.length && stem.endsWith(suffix)) return stem.slice(0, -suffix.length);
  }
  for (const suffix of names.camel ?? []) {
    if (stem.endsWith(suffix) && endsAWord(stem.slice(0, -suffix.length), suffix)) return stem.slice(0, -suffix.length);
  }
  return null;
}

// A Gradle source set, `commonTest` beside `commonMain`, and the directory Maven and Gradle root a package at.
const JVM_TREES = { test: /^[a-z][A-Za-z]*Test$/, source: /^[a-z][A-Za-z]*Main$/, packagesUnder: new Set(["java", "kotlin"]) };

/**
 * What a family calls the two halves of its own split, beside the names every
 * family shares. `test` marks the test half and `source` the other; a whole
 * segment either matches drops out of a mirror, and a suffix is cut off it.
 * `packagesUnder` names the directory a package path starts below: what
 * follows `src/main/java` is the same on both halves and in every module, so
 * a mirror compares that and nothing above it.
 *
 * Measured. okhttp and kotlinx.serialization keep 500 files under a
 * `<set>Test` directory, 402 of them holding cases. All 22 .NET test projects in three repositories are named for
 * the project they cover with a dotted word ending in `Tests`, `Serilog.Tests`
 * beside `Serilog`. composer files its tests under the `Test` namespace its
 * classes declare, `tests/Composer/Test/Util` for `src/Composer/Util`.
 */
export const FAMILY_TREES = {
  java: JVM_TREES,
  kotlin: JVM_TREES,
  csharp: { test: /\.[A-Za-z]*Tests$/ },
  php: { test: /^Test$/ },
};

/** Whether a directory name puts what is under it in a test tree, for a file of this family. */
export const isTestTree = (segment, family = null) =>
  TEST_TREES.has(segment) || FAMILY_TREES[family]?.test.test(segment) === true;

/**
 * The directory a family's packaging puts its top-level package under, which
 * no import spells: `src/flask/cli.py` is `flask.cli`. Read where a flat test
 * directory answers a package at the top of the tree, and nowhere else.
 *
 * Python only, on one repository of the three measured: flask keeps its
 * package there and read 0 of 24 with 9 of its files answered by name.
 */
export const PACKAGE_SHELL = { python: "src" };

/**
 * The families whose test tree files a test by feature below its top level, so
 * a test there answers a package at the top of the tree only from the tree's
 * own top level, or from the path that mirrors the source's.
 *
 * Python only. fastapi keeps `tests/test_telemetry/test_exceptions.py`, a test
 * of OpenTelemetry spans, and at any depth it answered `fastapi/exceptions.py`:
 * 3 of the 6 files credited under `fastapi` were credited to another feature.
 */
export const FEATURE_TREES = new Set(["python"]);

const below = (dir, above) => {
  const segments = dir === "" ? [] : dir.split("/");
  return above.every((segment, i) => segments[i] === segment) ? segments.slice(above.length) : null;
};

/**
 * Per family, the source directories a test directory is paired with by the
 * family's own project layout, as a predicate over a source directory, or null
 * where the test directory is in no pairing.
 *
 * Python: a `tests` directory beside a package mirrors that package, so
 * `tutorial/tests/api` is paired with `tutorial/flaskr/api` and with
 * `tutorial/src/flaskr/api`. flask's `examples` read 0 of 12 with three such
 * pairs in it.
 *
 * The other four pair a whole project, at any depth: a .NET test project with
 * the project its name carries, `Serilog.Tests` with `Serilog`; a Maven or
 * Gradle `src/test`, or a `<set>Test` source set, with what sits beside it;
 * a PHP `tests` with the `src` or `app` beside it. A `test` directory under no
 * `src` is ktor's flat `<module>/test` and pairs with nothing.
 *
 * A PHP test whose name is its directory's, alone or with a class after it,
 * is held to sources under a directory of that name: Laravel's
 * `tests/Session/SessionStoreTest.php` tests `Session\Store`, not
 * `Cache/SessionStore.php`. Of the 61 Laravel credits that cross a component
 * 10 are so named, 7 of them wrong. Only where a source directory of the
 * paired tree carries the name: `tests/Unit` mirrors none.
 */
const jvmPairing = (segments) => {
  const at = segments.findIndex((segment, i) => JVM_TREES.test.test(segment) || (segment === "test" && segments[i - 1] === "src"));
  if (at === -1) return null;
  return (dir) => {
    const own = below(dir, segments.slice(0, at));
    return own !== null && own.length > 0 && !isTestTree(own[0], "java");
  };
};

const PAIRINGS = {
  csharp: (segments) => {
    const project = segments.find((segment) => FAMILY_TREES.csharp.test.test(segment));
    if (project === undefined) return null;
    const covered = project.replace(FAMILY_TREES.csharp.test, "");
    return (dir) => dir.split("/").includes(covered);
  },
  java: jvmPairing,
  kotlin: jvmPairing,
  php: (segments, covered, sourceDirs) => {
    const at = segments.indexOf("tests");
    if (at === -1) return null;
    const inTree = (dir, under = null) => {
      const source = below(dir, segments.slice(0, at));
      return source !== null && (source[0] === "src" || source[0] === "app") && (under === null || source.includes(under));
    };
    const own = segments.at(-1);
    const named = covered.startsWith(own) && /^(?:\p{Lu}|$)/u.test(covered.slice(own.length));
    const held = named && sourceDirs.some((dir) => inTree(dir, own)) ? own : null;
    return (dir) => inTree(dir, held);
  },
  python: (segments) => {
    const at = segments.findIndex((segment) => TEST_ROOTS.has(segment));
    if (at === -1) return null;
    const rest = segments.slice(at + 1).join("/");
    return (dir) => {
      const own = below(dir, segments.slice(0, at));
      if (own === null) return false;
      const packaged = own[0] === PACKAGE_SHELL.python ? own.slice(1) : own;
      return packaged.length > 0 && packaged.slice(1).join("/") === rest;
    };
  },
};

/** `covered` is the stem the test's name says it covers and `sourceDirs` the family's source directories, which only PHP's pairing reads. */
export const pairedWith = (testDir, family, covered = "", sourceDirs = []) =>
  PAIRINGS[family]?.(testDir.split("/"), covered, sourceDirs) ?? null;
