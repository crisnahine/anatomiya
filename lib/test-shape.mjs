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
