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
  FEATURE_TREES,
  PACKAGE_SHELL,
  coveredStem,
  namesATest,
  isTestTree,
  pairedWith,
} from "../plugins/anatomiya/lib/test-shape.mjs";
import { PAIRINGS } from "../plugins/anatomiya/lib/pairing.mjs";
import { stemOf } from "../plugins/anatomiya/lib/paths.mjs";

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
  // A project named in the singular, Autofac's `Autofac.Test`, is a test project as one named in the plural is.
  for (const project of ["Autofac.Test", "Autofac.Specification.Test", "NodaTime.UnitTest"]) assert.ok(isTestTree(project, "csharp"), project);
  for (const not of ["Autofac.Latest", "Autofac.Testing", "Test", "Tests", "Autofac.Test.Scenarios"]) assert.ok(!isTestTree(not, "csharp"), not);
  // composer's namespace directory is `tests/Composer/Test`, and symfony keeps a `Tests` inside each component.
  for (const tree of ["Test", "Tests"]) assert.ok(isTestTree(tree, "php"), tree);
  for (const not of ["Testing", "Testsuite", "MyTests", "tests2"]) assert.ok(!isTestTree(not, "php"), not);
  assert.ok(!isTestTree("Tests", "java"));
  assert.deepEqual(Object.keys(FAMILY_TREES).sort(), ["csharp", "java", "kotlin", "php"]);
});

test("Python files its tests by feature below the top of the tree, and no other family is held to that", () => {
  assert.deepEqual([...FEATURE_TREES], ["python"]);
});

test("Python: a tests directory is paired with the package beside it, directory for directory", () => {
  const paired = pairedWith("examples/tutorial/tests", "python");
  assert.ok(paired("examples/tutorial/flaskr"));
  assert.ok(paired("examples/tutorial/src/flaskr"));
  for (const not of ["examples/tutorial", "examples/tutorial/flaskr/api", "examples/javascript/js_example", "flaskr", "examples/tutorial/src"]) {
    assert.ok(!paired(not), not);
  }
  assert.ok(pairedWith("examples/tutorial/tests/api", "python")("examples/tutorial/flaskr/api"));
  assert.ok(pairedWith("tests", "python")("flaskr"));
  assert.equal(pairedWith("examples/tutorial/flaskr", "python"), null);
  for (const family of ["js", "ruby", "go", "rust"]) assert.equal(pairedWith("examples/tutorial/tests", family), null, family);
});

test("a test project or tree is paired with the project it is named for or sits beside", () => {
  // .NET: `Serilog.Tests` is named for `Serilog`, wherever either sits.
  const serilog = pairedWith("test/Serilog.Tests/Core", "csharp");
  assert.ok(serilog("src/Serilog/Core/Sinks"));
  assert.ok(!serilog("src/Serilog.Sinks.File"));
  assert.ok(!serilog("test/Serilog.Tests/Support"));
  assert.ok(pairedWith("tests/Jellyfin.Api.Tests/Auth", "csharp")("Jellyfin.Api/Controllers"));
  assert.equal(pairedWith("test/Serilog/Core", "csharp"), null);
  assert.ok(pairedWith("test/Autofac.Test/Core", "csharp")("src/Autofac/Core/Activators"));
  assert.ok(!pairedWith("test/Autofac.Specification.Test/Features", "csharp")("src/Autofac/Features"));

  // Maven and Gradle: `src/test` beside `src/main`, and a source set beside the others.
  for (const family of ["java", "kotlin"]) {
    const module = pairedWith("gson/src/test/java/com/google/gson/functional", family);
    assert.ok(module("gson/src/main/java/com/google/gson"), family);
    assert.ok(!module("extras/src/main/java/com/google/gson"), family);
    assert.ok(!module("gson/src/test/java/com/google/gson"), family);
    assert.ok(!module("gson"), family);
    const set = pairedWith("core/jvmTest/src/k", family);
    assert.ok(set("core/commonMain/src/k"), family);
    assert.ok(!set("core/commonTest/src/k"), family);
    assert.ok(!set("formats/commonMain/src/k"), family);
    // A `test` directory under no `src` is a flat test directory.
    assert.equal(pairedWith("ktor-utils/jvm/test/io/ktor", family), null, family);
  }

  // PHP: `tests` beside `src` or `app`.
  const laravel = pairedWith("tests/Integration/Generators", "php");
  assert.ok(laravel("src/Illuminate/Database/Console"));
  assert.ok(laravel("app/Models"));
  assert.ok(!laravel("Slim/Routing"));
  assert.ok(!laravel("types/Cache"));
  assert.ok(pairedWith("packages/mail/tests/Unit", "php")("packages/mail/src"));
  assert.ok(!pairedWith("packages/mail/tests/Unit", "php")("packages/queue/src"));
  assert.equal(pairedWith("src/Illuminate/Testing", "php"), null);
});

test("PHP: a test named for its directory is paired with that directory's sources and no other", () => {
  const illuminate = ["Session/Middleware", "Cache", "Database/Connectors", "Queue/Connectors", "Cookie", "Support/Facades", "Auth", "Foundation"].map((d) => `src/Illuminate/${d}`);
  // Laravel: `tests/Session/SessionStoreTest.php` tests `Illuminate\\Session\\Store`, not `Cache/SessionStore.php`.
  const session = pairedWith("tests/Session", "php", "SessionStore", illuminate);
  assert.ok(session("src/Illuminate/Session"));
  assert.ok(session("src/Illuminate/Session/Middleware"));
  assert.ok(!session("src/Illuminate/Cache"));
  const database = pairedWith("tests/Integration/Database", "php", "DatabaseConnector", illuminate);
  assert.ok(database("src/Illuminate/Database/Connectors"));
  assert.ok(!database("src/Illuminate/Queue/Connectors"));
  // The directory's name and no more: `tests/Cookie/CookieTest.php` tests `CookieJar`, not the `Cookie` facade.
  const cookie = pairedWith("tests/Cookie", "php", "Cookie", illuminate);
  assert.ok(cookie("src/Illuminate/Cookie"));
  assert.ok(!cookie("src/Illuminate/Support/Facades"));
  // Any other name keeps the whole tree: one that does not begin with the directory's, and one that only shares its letters.
  assert.ok(pairedWith("tests/Integration/Generators", "php", "SeederMakeCommand", illuminate)("src/Illuminate/Database/Console/Seeds"));
  assert.ok(pairedWith("tests/Auth", "php", "Authorize", illuminate)("src/Illuminate/Foundation"));
});

test("PHP: a test directory no source directory is named for holds a test to nothing", () => {
  const app = ["app/Models", "app/Services", "app/Http/Controllers"];
  // `tests/Unit` and `tests/Feature` mirror no directory of a standard application.
  assert.ok(pairedWith("tests/Unit", "php", "UnitConverter", app)("app/Services"));
  assert.ok(pairedWith("tests/Feature", "php", "FeatureFlag", app)("app/Models"));
  assert.ok(pairedWith("tests/Integration", "php", "IntegrationManager", ["src/Acme"])("src/Acme"));
  // A directory of that name outside the paired tree is no mirror.
  assert.ok(pairedWith("tests/Unit", "php", "UnitConverter", [...app, "lib/Unit", "packages/x/src/Unit"])("app/Services"));
  // One inside it is, at any depth.
  assert.ok(!pairedWith("tests/Unit", "php", "UnitConverter", [...app, "app/Domain/Unit/Rules"])("app/Services"));
  assert.ok(pairedWith("tests/Unit", "php", "UnitConverter", [...app, "app/Domain/Unit/Rules"])("app/Domain/Unit"));
});

test("the hold on a test named for its directory is PHP's alone", () => {
  // PHP only. Held the same way serilog and gson lose none of 28 and 37 credits, and okhttp one of 69, a right one.
  assert.ok(pairedWith("test/Serilog.Tests/Core", "csharp", "CoreSink")("src/Serilog/Events"));
  assert.ok(pairedWith("gson/src/test/java/functional", "java", "functionalJson")("gson/src/main/java/internal"));
});

test("Java and Kotlin: a Main source set and the package root are the words a mirror reads out of a path", () => {
  for (const family of ["java", "kotlin"]) {
    const trees = FAMILY_TREES[family];
    for (const set of ["commonMain", "jvmMain", "androidMain"]) assert.ok(trees.source.test(set), `${family} ${set}`);
    for (const not of ["main", "Main", "commonTest", "domain", "commonJvmAndroid"]) assert.ok(!trees.source.test(not), `${family} ${not}`);
    assert.deepEqual([...trees.packagesUnder].sort(), ["java", "kotlin"], family);
  }
  for (const family of ["csharp", "php"]) {
    assert.equal(FAMILY_TREES[family].source, undefined, family);
    assert.equal(FAMILY_TREES[family].packagesUnder, undefined, family);
  }
});

test("Python's packaging shell is src, and no other family has one", () => {
  assert.deepEqual(PACKAGE_SHELL, { python: "src" });
});

test("a path names a test by its family's rule: the name alone where the tool reads nothing else, and under a test tree where source wears the word", () => {
  for (const [rel, family, said] of [
    ["shop/test_cart.py", "python", true],
    ["shop/cart_test.py", "python", true],
    ["shop/cart.py", "python", false],
    ["shop/cart_test.go", "go", true],
    ["tests/CartTest.php", "php", true],
    ["src/CartTest.php", "php", false],
    ["src/test/java/shop/CartIT.java", "java", true],
    ["src/main/java/shop/RepeatedTest.java", "java", false],
    ["shop/commonTest/kotlin/CartTest.kt", "kotlin", true],
    ["test/Shop.Tests/CartTests.cs", "csharp", true],
    ["src/Shop/CartTests.cs", "csharp", false],
    // A directory named for a test is not one: only a whole segment is a tree.
    ["latest/CartTest.php", "php", false],
    ["tests/cart.rs", "rust", false],
    ["shop/cart.test.js", "js", false],
    ["spec/cart_spec.rb", "ruby", false],
  ]) {
    assert.equal(namesATest(rel, family), said, rel);
  }
});

test("a name that is all extension has itself for a stem, and names no test", () => {
  // The one kind of path a last-dot cut and `stemOf` read differently among these languages: "" against ".py".
  for (const [rel, family] of [["tests/.py", "python"], ["pkg/.go", "go"], ["tests/.php", "php"], ["src/test/java/.java", "java"]]) {
    assert.equal(namesATest(rel, family), false, rel);
  }
  assert.equal(coveredStem(stemOf("tests/.py"), "python"), null);
  assert.equal(stemOf("tests/.py"), ".py");
});
