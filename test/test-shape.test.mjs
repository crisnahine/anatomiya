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
  FAMILY_TEST_NAMES,
  FAMILY_TREES,
  coveredStem,
  isTestTree,
} from "../plugins/anatomiya/lib/test-shape.mjs";
import { PAIRINGS } from "../plugins/anatomiya/lib/pairing.mjs";

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

test("the seven tree-sitter families each name their tests, and no other family does", () => {
  assert.deepEqual(Object.keys(FAMILY_TEST_NAMES), ["python", "php", "go", "java", "csharp", "rust", "kotlin"]);
  for (const family of ["js", "ruby", "vue", "svelte"]) assert.equal(coveredStem("a_test", family), null, family);
});

test("Go: a _test file is a test by its name alone and covers the file beside it", () => {
  assert.equal(FAMILY_TEST_NAMES.go.alone, true);
  assert.equal(coveredStem("auth_test", "go"), "auth");
  assert.equal(coveredStem("auth", "go"), null);
  assert.equal(coveredStem("_test", "go"), null);
  // The prefix is Python's and reads as nothing here.
  assert.equal(coveredStem("test_auth", "go"), null);
});

test("Python: test_ in front or _test behind is a test by its name alone", () => {
  assert.equal(FAMILY_TEST_NAMES.python.alone, true);
  assert.equal(coveredStem("test_auth", "python"), "auth");
  assert.equal(coveredStem("auth_test", "python"), "auth");
  assert.equal(coveredStem("auth", "python"), null);
  assert.equal(coveredStem("testing", "python"), null);
  assert.equal(coveredStem("test_", "python"), null);
  assert.equal(coveredStem("AuthTest", "python"), null);
});

test("PHP: a Test suffix is a test name that a test tree has to corroborate", () => {
  assert.notEqual(FAMILY_TEST_NAMES.php.alone, true);
  assert.equal(coveredStem("AppTest", "php"), "App");
  assert.equal(coveredStem("App", "php"), null);
  assert.equal(coveredStem("Contest", "php"), null);
  assert.equal(coveredStem("AppTests", "php"), null);
  assert.equal(coveredStem("AppTestCase", "php"), null);
});

test("Java and Kotlin: Test, Tests and IT are test names that a test tree has to corroborate", () => {
  for (const family of ["java", "kotlin"]) {
    assert.notEqual(FAMILY_TEST_NAMES[family].alone, true, family);
    assert.equal(coveredStem("FooTest", family), "Foo", family);
    assert.equal(coveredStem("FooTests", family), "Foo", family);
    assert.equal(coveredStem("FooIT", family), "Foo", family);
    assert.equal(coveredStem("URLTest", family), "URL", family);
    for (const not of ["Foo", "Contest", "Audit", "EXIT", "Test", "Tests", "IT", "FooTestCase", "TestFoo"]) {
      assert.equal(coveredStem(not, family), null, `${family} ${not}`);
    }
  }
});

test("Spec is not a test suffix in any family: two files in 21 repositories wear it and neither is a test", () => {
  for (const family of Object.keys(FAMILY_TEST_NAMES)) {
    assert.equal(coveredStem("FooSpec", family), null, family);
    assert.equal(coveredStem("SpecHelper", family), null, family);
  }
});

test("C#: Tests and Test are test names that a test tree has to corroborate", () => {
  assert.notEqual(FAMILY_TEST_NAMES.csharp.alone, true);
  assert.equal(coveredStem("LoggerTests", "csharp"), "Logger");
  assert.equal(coveredStem("LoggerTest", "csharp"), "Logger");
  assert.equal(coveredStem("Logger", "csharp"), null);
  assert.equal(coveredStem("LoggerIT", "csharp"), null);
  assert.equal(coveredStem("Contest", "csharp"), null);
});

test("Rust has no test name: cargo collects by directory", () => {
  assert.notEqual(FAMILY_TEST_NAMES.rust.alone, true);
  for (const stem of ["test_de", "de_test", "DeTest", "tests"]) assert.equal(coveredStem(stem, "rust"), null, stem);
});

test("a test tree has the names every family shares, and the ones its own family adds", () => {
  for (const family of [null, "js", "python", "kotlin", "csharp"]) assert.ok(isTestTree("tests", family), String(family));
  // A Gradle source set, and a .NET test project named for the project it covers.
  for (const set of ["commonTest", "jvmTest", "androidTest", "integrationTest"]) {
    assert.ok(isTestTree(set, "kotlin"), set);
    assert.ok(isTestTree(set, "java"), set);
    assert.ok(!isTestTree(set, "python"), set);
    assert.ok(!isTestTree(set, null), set);
  }
  for (const not of ["main", "commonMain", "Contest", "latest", "Test"]) assert.ok(!isTestTree(not, "kotlin"), not);
  for (const project of ["Serilog.Tests", "Newtonsoft.Json.Tests", "Serilog.PerformanceTests"]) {
    assert.ok(isTestTree(project, "csharp"), project);
    assert.ok(!isTestTree(project, "java"), project);
  }
  assert.ok(!isTestTree("Serilog", "csharp"));
  assert.ok(!isTestTree("Serilog.Testing", "csharp"));
  assert.ok(isTestTree("Test", "php"));
  assert.ok(!isTestTree("Test", "csharp"));
  assert.deepEqual(Object.keys(FAMILY_TREES).sort(), ["csharp", "java", "kotlin", "php"]);
});
