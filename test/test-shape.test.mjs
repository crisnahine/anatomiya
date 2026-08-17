import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TEST_DIRS,
  TEST_NAME,
  RUBY_TEST_NAME,
  MINITEST_NAME,
  TEST_ROOTS,
  TEST_TREES,
  NAMESAKE_SUFFIXES,
  TREE,
  RUNNER_LABELS,
  UNNAMED_RUNNER,
} from "../lib/test-shape.mjs";
import { PAIRINGS } from "../lib/pairing.mjs";

test("the dotted namesake suffixes are the ones the name regexes count", () => {
  for (const stem of ["a.test", "a.spec", "a.cy"]) {
    assert.ok(TEST_NAME.test(`${stem}.js`), stem);
    assert.ok(
      NAMESAKE_SUFFIXES.some((s) => stem.endsWith(s)),
      stem
    );
  }
  for (const stem of ["a_spec", "a_test"]) {
    assert.ok(RUBY_TEST_NAME.test(`${stem}.rb`), stem);
    assert.ok(
      NAMESAKE_SUFFIXES.some((s) => stem.endsWith(s)),
      stem
    );
  }
});

test("the hyphen forms are is-test only: a hyphen-named test answers no namesake", () => {
  // discourse writes 4,000 tests as `login-test.js`, so the tests line counts
  // them; the namesake question deliberately does not strip the hyphen, and
  // whether it should is a corpus question rather than a constant to flip.
  assert.ok(TEST_NAME.test("login-test.js"));
  assert.ok(!NAMESAKE_SUFFIXES.some((s) => "login-test".endsWith(s)));
});

test("only the Ruby form is anchored, binding its own expression", () => {
  assert.ok(RUBY_TEST_NAME.test("a_spec.rb"));
  assert.ok(!RUBY_TEST_NAME.test("a_spec.rb.bak"));
  // The dotted form is a fragment by design: what a caller does about a longer
  // basename is that caller's discipline, not this expression's.
  assert.ok(TEST_NAME.test("a.test.js.snap"));
});

test("minitest's basename rule is the _test half of the Ruby form", () => {
  assert.ok(MINITEST_NAME.test("app/a_test.rb"));
  assert.ok(MINITEST_NAME.test("a_test.rb"));
  assert.ok(!MINITEST_NAME.test("app/a_spec.rb"));
});

test("the tree vocabularies overlap exactly where their questions overlap", () => {
  for (const root of TEST_ROOTS) assert.ok(TEST_TREES.has(root), root);
  const both = [...TREE].filter((w) => TEST_TREES.has(w)).sort();
  assert.deepEqual(both, ["__tests__", "spec", "test", "tests"]);
  assert.ok(TEST_DIRS.has("__tests__"));
});

test("every pairing suffix starts with a namesake suffix, so the two cannot drift", () => {
  for (const row of PAIRINGS) {
    assert.ok(
      NAMESAKE_SUFFIXES.some((s) => row.companionSuffix.startsWith(s)),
      `${row.key}: ${row.companionSuffix}`
    );
  }
});

test("the runner labels stay the two a reader spells differently", () => {
  assert.deepEqual(Object.keys(RUNNER_LABELS).sort(), ["cypress", "rspec"]);
  assert.equal(UNNAMED_RUNNER, "test files");
});
