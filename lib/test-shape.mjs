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
