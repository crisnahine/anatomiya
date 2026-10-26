import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTreeFile } from "../plugins/anatomiya/lib/tree-sitter-file.mjs";
import { treeFacets } from "../plugins/anatomiya/lib/tree-facets.mjs";
import * as SAMPLES from "./tree-samples.mjs";

const EXT = { python: "py", php: "php", go: "go", java: "java", csharp: "cs", rust: "rs", kotlin: "kt" };

/** The facets of one source, read off the tree the engine hands over. */
async function allFacetsOf(lang, source, rel = `src/a.${EXT[lang]}`) {
  const r = await parseTreeFile(source, rel, lang, { withProgram: true });
  assert.equal(r.ok, true, `${lang} sample did not parse: ${r.error}`);
  // The engine hands over what this reads off the same tree.
  assert.deepEqual(r.facets, treeFacets(r.program, lang, rel));
  return r.facets;
}

// What a file reaches for in others, which the tests of what kind of file it is leave aside.
const REACH = new Set(["refs", "defines", "usings", "globalUsings", "namespace", "globals", "extensions"]);

/** The facets that say what kind of file this is. */
async function facetsOf(lang, source, rel) {
  return Object.fromEntries(Object.entries(await allFacetsOf(lang, source, rel)).filter(([key]) => !REACH.has(key)));
}

for (const lang of Object.keys(EXT)) {
  test(`${lang}: an ordinary source file names no runner and declares no case`, async () => {
    const { testRunner, testCalls } = await facetsOf(lang, SAMPLES[lang]);
    assert.deepEqual({ testRunner, testCalls }, { testRunner: null, testCalls: false });
  });
}

// What each language writes to reach another file, and what the roster would call it.
const REACHES = {
  python: [
    "pkg/svc/a.py",
    "import a.b.c\nimport x as z\nfrom a.b import c, d as e\nfrom . import f\nfrom ..g.h import i\n\n\ndef run():\n    return 1\n",
    [
      { name: "c", stems: ["a/b/c", "a/b/c/__init__"] },
      { name: "x", stems: ["x", "x/__init__"] },
      { name: "c", stems: ["a/b/c", "a/b/c/__init__", "a/b", "a/b/__init__"] },
      { name: "d", stems: ["a/b/d", "a/b/d/__init__", "a/b", "a/b/__init__"] },
      { name: "f", stems: ["pkg/svc/f", "pkg/svc/f/__init__", "pkg/svc/__init__"], exact: true },
      { name: "i", stems: ["pkg/g/h/i", "pkg/g/h/i/__init__", "pkg/g/h", "pkg/g/h/__init__"], exact: true },
    ],
    ["run"],
  ],
  java: [
    "src/main/java/p/q/X.java",
    "package p.q;\nimport a.b.C;\nimport static a.b.D.m;\nimport a.b.*;\nclass X { void f() { C.go(); m(); } }\n",
    [
      { name: "C", stems: ["a/b/C"] },
      { name: "D.m", stems: ["a/b/D"] },
      { name: "C.go", bare: "C", member: "go", stems: ["a/b/C"] },
    ],
    ["X", "f"],
  ],
  kotlin: [
    "src/main/kotlin/p/q/X.kt",
    "package p.q\nimport a.b.C\nimport a.b.foo as bar\nimport a.b.*\nfun f() { C.go(); bar() }\n",
    [
      { name: "C", stems: ["a/b/C"], dir: "a/b", lookup: "C" },
      { name: "foo", stems: ["a/b/foo"], dir: "a/b", lookup: "foo" },
      { name: "C.go", bare: "C", member: "go", stems: ["a/b/C"], dir: "a/b", lookup: "C" },
    ],
    ["f"],
  ],
  go: [
    "cmd/a.go",
    'package main\nimport (\n  "fmt"\n  "example.com/m/internal/bytesconv"\n  bc "example.com/m/pkg/x"\n  _ "example.com/m/pkg/side"\n)\nfunc F() { fmt.Println(bytesconv.StringToBytes("a")); bc.Y() }\n',
    [
      { name: "bytesconv.StringToBytes", dir: "example.com/m/internal/bytesconv", lookup: "StringToBytes" },
      { name: "x.Y", dir: "example.com/m/pkg/x", lookup: "Y" },
    ],
    ["F"],
  ],
  rust: [
    "crates/core/src/a/x.rs",
    "use crate::a::b::{c, d::e};\nuse super::f;\nuse self::g as h;\nuse other_crate::k;\nuse std::*;\nfn x() { c(); e(); }\n",
    [
      { name: "c", stems: ["crates/core/src/a/b/c", "crates/core/src/a/b/c/mod", "crates/core/src/a/b", "crates/core/src/a/b/mod"], exact: true },
      { name: "e", stems: ["crates/core/src/a/b/d/e", "crates/core/src/a/b/d/e/mod", "crates/core/src/a/b/d", "crates/core/src/a/b/d/mod"], exact: true },
      { name: "f", stems: ["crates/core/src/a/f", "crates/core/src/a/f/mod", "crates/core/src/a", "crates/core/src/a/mod", "crates/core/src/a/lib", "crates/core/src/a/main"], exact: true },
      { name: "g", stems: ["crates/core/src/a/x/g", "crates/core/src/a/x/g/mod", "crates/core/src/a/x", "crates/core/src/a/x/mod", "crates/core/src/a/x/lib", "crates/core/src/a/x/main"], exact: true },
      { name: "k", stems: ["other_crate/src/k", "other_crate/src/k/mod", "other_crate/src/lib", "other-crate/src/k", "other-crate/src/k/mod", "other-crate/src/lib"] },
    ],
    ["x"],
  ],
  php: [
    "app/Http/X.php",
    "<?php\nnamespace App\\Http;\nuse App\\Models\\User;\nuse App\\Support\\{Str, Arr as A};\nuse function App\\helpers\\foo;\nclass X { function f() { User::find(1); Str::limit(\"a\"); new User(); } }\n",
    [
      { name: "User", stems: ["App/Models/User", "Models/User"] },
      { name: "Str", stems: ["App/Support/Str", "Support/Str"] },
      { name: "Arr", stems: ["App/Support/Arr", "Support/Arr"] },
      { name: "User::find", bare: "User", member: "find", stems: ["App/Models/User", "Models/User"] },
      { name: "Str::limit", bare: "Str", member: "limit", stems: ["App/Support/Str", "Support/Str"] },
    ],
    ["X", "f"],
  ],
  csharp: [
    "src/N/X.cs",
    "using A.B;\nusing static A.C.Util;\nusing Alias = A.D;\nnamespace N.M;\nclass X : Base { void F() { StringUtils.Truncate(s); s.Trim(); var y = new Foo(); } }\n",
    [
      { name: "Util", type: "Util", in: "A.C" },
      { name: "Base", type: "Base" },
      { name: "StringUtils.Truncate", bare: "StringUtils", member: "Truncate", type: "StringUtils" },
      // A call on a value reaches a repository's extension method of that name, if it declares one.
      { name: "Trim", extension: "Trim" },
      { name: "Foo", type: "Foo" },
    ],
    ["F", "X"],
  ],
};

for (const [lang, [rel, source, refs, defines]] of Object.entries(REACHES)) {
  test(`${lang}: a file names what it reaches for in other files, and what it defines`, async () => {
    const facets = await allFacetsOf(lang, source, rel);
    assert.deepEqual(facets.refs, refs);
    assert.deepEqual(facets.defines, defines);
  });
}

test("csharp: a file says which namespace it is in and which it opens", async () => {
  const facets = await allFacetsOf("csharp", REACHES.csharp[1], REACHES.csharp[0]);
  assert.deepEqual([facets.usings, facets.namespace], [["A.B"], "N.M"]);
});

const RUNNERS = [
  ["pytest", "python", "import pytest\n\n\ndef test_total():\n    assert 1 == 1\n"],
  ["unittest", "python", "import unittest\n\n\nclass TotalTest(unittest.TestCase):\n    def test_total(self):\n        self.assertEqual(1, 1)\n"],
  ["go test", "go", 'package billing\n\nimport (\n\t"fmt"\n\t"testing"\n)\n\nfunc TestTotal(t *testing.T) {\n\tfmt.Println(1)\n}\n'],
  ["junit", "java", "package a;\n\nimport org.junit.jupiter.api.Test;\n\nclass TotalTest {\n    @Test\n    void total() {}\n}\n"],
  ["testng", "java", "package a;\n\nimport org.testng.annotations.Test;\n\npublic class TotalTest {\n    @Test(groups = \"fast\")\n    public void total() {}\n}\n"],
  ["xunit", "csharp", "using Xunit;\n\npublic class TotalTests\n{\n    [Fact]\n    public void Total() {}\n}\n"],
  ["nunit", "csharp", "using NUnit.Framework;\n\npublic class TotalTests\n{\n    [Test]\n    public void Total() {}\n}\n"],
  ["mstest", "csharp", "public class TotalTests\n{\n    [Microsoft.VisualStudio.TestTools.UnitTesting.TestMethod]\n    public void Total() {}\n}\n"],
  ["cargo test", "rust", "use billing::total;\n\n#[test]\nfn adds() {\n    assert_eq!(total(), 1);\n}\n"],
  ["phpunit", "php", "<?php\n\nuse PHPUnit\\Framework\\TestCase;\n\nclass TotalTest extends TestCase\n{\n    public function testTotal(): void\n    {\n    }\n}\n"],
  ["pest", "php", "<?php\n\nit('adds', function () {\n    expect(1)->toBe(1);\n});\n"],
  ["kotlin.test", "kotlin", "package a\n\nimport kotlin.test.Test\n\nclass TotalTest {\n    @Test\n    fun total() {\n    }\n}\n"],
];

// Where the language's own tool collects by the path, the path is part of the file being a test.
const COLLECTED_AT = { "go test": "billing/total_test.go", "cargo test": "tests/total.rs", pest: "tests/Feature/TotalTest.php" };

for (const [label, lang, source] of RUNNERS) {
  test(`a test file names its runner: ${label}`, async () => {
    assert.deepEqual(await facetsOf(lang, source, COLLECTED_AT[label]), { testRunner: label, testCalls: true });
  });
}

test("a runner's import with no case in the file is not a test", async () => {
  // A module of fixtures and a benchmark helper both import the runner and declare nothing it collects.
  const quiet = { testRunner: null, testCalls: false };
  assert.deepEqual(await facetsOf("python", "import pytest\n\n\n@pytest.fixture\ndef order():\n    return 1\n"), quiet);
  assert.deepEqual(await facetsOf("go", 'package a\n\nimport "testing"\n\nfunc helper(t *testing.T) {}\n'), quiet);
  assert.deepEqual(await facetsOf("php", "<?php\n\nuse PHPUnit\\Framework\\TestCase;\n\nabstract class Base extends TestCase\n{\n}\n"), quiet);
  assert.deepEqual(await facetsOf("java", "package a;\n\nimport org.junit.rules.TemporaryFolder;\n\nclass Rules {\n    void make() {}\n}\n"), quiet);
});

test("a function named like a case is not one where nothing imports its runner", async () => {
  const quiet = { testRunner: null, testCalls: false };
  assert.deepEqual(await facetsOf("python", "def test_connection(host):\n    return host\n"), quiet);
  assert.deepEqual(await facetsOf("go", "package a\n\nfunc TestConnection() bool {\n\treturn true\n}\n"), quiet);
  assert.deepEqual(await facetsOf("php", "<?php\n\nclass Probe\n{\n    public function testConnection(): bool\n    {\n        return true;\n    }\n}\n"), quiet);
});

test("unittest's mock alone does not make a file a unittest file", async () => {
  const source = "import pytest\nfrom unittest import mock\n\n\ndef test_total():\n    assert mock\n";
  assert.equal((await facetsOf("python", source)).testRunner, "pytest");
  const mocked = "from unittest.mock import patch\n\n\ndef test_total():\n    assert patch\n";
  assert.deepEqual(await facetsOf("python", mocked), { testRunner: null, testCalls: false });
});

test("a runner is read off each imported name, wherever it sits in a list of them", async () => {
  const unit = { testRunner: "unittest", testCalls: true };
  const body = "\n\n\nclass TotalTest(TestCase):\n    def test_total(self):\n        self.assertEqual(1, 1)\n";
  assert.deepEqual(await facetsOf("python", `from unittest import mock, TestCase${body}`), unit);
  assert.deepEqual(await facetsOf("python", `from unittest import TestCase, mock${body}`), unit);
  assert.deepEqual(await facetsOf("python", `from unittest import (\n    mock as m,\n    TestCase,\n)${body}`), unit);
  assert.deepEqual(await facetsOf("python", `import os, unittest.mock, unittest\nTestCase = unittest.TestCase${body}`), unit);
  // Two names out of the mock module are still only the mock module.
  assert.deepEqual(await facetsOf("python", "from unittest.mock import patch, Mock\n\n\ndef test_total():\n    assert patch\n"), { testRunner: null, testCalls: false });
  assert.deepEqual(await facetsOf("python", "from pytest import fixture, mark\n\n\ndef test_total():\n    assert mark\n"), { testRunner: "pytest", testCalls: true });

  const php = (use) => `<?php\n\n${use}\n\nclass TotalTest extends TestCase\n{\n    public function testTotal(): void\n    {\n    }\n}\n`;
  const phpunit = { testRunner: "phpunit", testCalls: true };
  assert.deepEqual(await facetsOf("php", php("use App\\Money, PHPUnit\\Framework\\TestCase;")), phpunit);
  assert.deepEqual(await facetsOf("php", php("use PHPUnit\\Framework\\{Attributes\\Test, TestCase};")), phpunit);
  // A project namespace that only ends in the runner's name is not the runner.
  const helped = php("use App\\{PHPUnit\\Helper, Money};").replace("extends TestCase", "extends Money");
  assert.deepEqual(await facetsOf("php", helped), { testRunner: null, testCalls: false });
});

test("an annotated case whose runner nothing here imports is still a case", async () => {
  const java = "package a;\n\nimport spock.lang.Specification;\n\nclass TotalTest {\n    @Test\n    void total() {}\n}\n";
  assert.deepEqual(await facetsOf("java", java), { testRunner: null, testCalls: true });
});

test("the runner is the one the case annotation was imported from", async () => {
  const junit = "package a\n\nimport kotlin.test.assertEquals\nimport org.junit.Test\n\nclass TotalTest {\n    @Test\n    fun total() {\n        assertEquals(1, 1)\n    }\n}\n";
  assert.equal((await facetsOf("kotlin", junit)).testRunner, "junit");
  const wildcard = "package a;\n\nimport static org.junit.Assert.*;\nimport org.testng.annotations.Test;\n\nclass TotalTest {\n    @Test\n    void total() {}\n}\n";
  assert.equal((await facetsOf("java", wildcard)).testRunner, "testng");
});

test("an annotation is read by its last name, and its arguments are not its name", async () => {
  const qualified = "class TotalTest {\n    @org.junit.Test(timeout = 1)\n    public void total() {}\n}\n";
  assert.deepEqual(await facetsOf("java", qualified), { testRunner: null, testCalls: true });
  const rust = "#[tokio::test]\nasync fn adds() {}\n";
  assert.deepEqual(await facetsOf("rust", rust, "tests/adds.rs"), { testRunner: "cargo test", testCalls: true });
  // `test` is the argument here, and `cfg` is the attribute.
  const gated = "#[cfg(test)]\nfn only_in_tests() {}\n";
  assert.deepEqual(await facetsOf("rust", gated), { testRunner: null, testCalls: false });
});

test("a decorator's arguments are not its name, so a parametrized pytest case is a case whatever they spell", async () => {
  const parametrized = 'import pytest\n\n\n@pytest.mark.parametrize("fixture", [1])\ndef test_a(fixture):\n    assert fixture\n';
  assert.deepEqual(await facetsOf("python", parametrized), { testRunner: "pytest", testCalls: true });
  const skipped = "import pytest\n\n\n@pytest.mark.skipif(not fixture, reason=\"\")\ndef test_a():\n    assert True\n";
  assert.deepEqual(await facetsOf("python", skipped), { testRunner: "pytest", testCalls: true });
});

test("a Rust source file holding its own unit tests in a module is still a source file", async () => {
  const source = "pub fn total() -> i64 {\n    1\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn adds() {\n        assert_eq!(total(), 1);\n    }\n}\n";
  assert.deepEqual(await facetsOf("rust", source), { testRunner: null, testCalls: false, inlineTests: true });
  // serde and ripgrep write the case at the top of a source file, gated the same way.
  const flat = "pub fn total() -> i64 {\n    1\n}\n\n#[cfg(test)]\n#[test]\nfn adds() {\n    assert_eq!(total(), 1);\n}\n";
  assert.deepEqual(await facetsOf("rust", flat), { testRunner: null, testCalls: false, inlineTests: true });
  assert.equal("inlineTests" in (await facetsOf("rust", SAMPLES.rust)), false);
});

test("cargo collects a Rust file under tests, wherever in it the cases sit", async () => {
  const nested = "mod codec {\n    #[test]\n    fn frames() {}\n}\n";
  const cargo = { testRunner: "cargo test", testCalls: true };
  assert.deepEqual(await facetsOf("rust", nested, "tokio-util/tests/codecs.rs"), cargo);
  // tokio splits a module's unit tests into a `tests.rs` beside it.
  assert.deepEqual(await facetsOf("rust", "#[test]\nfn opens() {}\n", "tokio/src/fs/file/tests.rs"), cargo);
  // A helper under tests declares no case and is no test.
  assert.deepEqual(await facetsOf("rust", "pub fn setup() {}\n", "tests/util.rs"), { testRunner: null, testCalls: false });
});

test("a Pest case is a call at file level, and the same word inside a function is not", async () => {
  const inside = "<?php\n\nfunction run()\n{\n    test('x', 1);\n}\n";
  assert.deepEqual(await facetsOf("php", inside), { testRunner: null, testCalls: false });
  const grouped = "<?php\n\ndescribe('totals', function () {\n    test('adds', function () {\n    });\n});\n";
  assert.deepEqual(await facetsOf("php", grouped, "tests/Unit/Totals.php"), { testRunner: "pest", testCalls: true });
  const flat = "<?php\n\ntest('adds', function () {\n});\n";
  assert.deepEqual(await facetsOf("php", flat, "tests/Unit/Totals.php"), { testRunner: "pest", testCalls: true });
  // A script that calls its own `test()` outside any test tree declares no case.
  assert.deepEqual(await facetsOf("php", flat, "scripts/probe.php"), { testRunner: null, testCalls: false });
});

const EMPTY = {
  python: ["", "# nothing here yet\n"],
  php: ["<p>hello</p>\n", "<?php\n// nothing here yet\n", "<?php ?>\n<p>hello</p>\n"],
  go: ["// Package billing adds up orders.\npackage billing\n"],
  java: ["/** Billing. */\npackage com.example.billing;\n"],
  csharp: ["// nothing here yet\n"],
  rust: ["// nothing here yet\n", "/* nor here */\n"],
  kotlin: ["// nothing here yet\npackage com.example.billing\n"],
};

for (const [lang, sources] of Object.entries(EMPTY)) {
  test(`${lang}: a file holding no statement and no declaration is empty`, async () => {
    for (const source of sources) {
      assert.deepEqual(await facetsOf(lang, source), { testRunner: null, testCalls: false, empty: true }, JSON.stringify(source));
    }
    assert.equal("empty" in (await facetsOf(lang, SAMPLES[lang])), false);
  });
}

test("a file of imports alone is not empty", async () => {
  assert.equal("empty" in (await facetsOf("python", "from .orders import *\n")), false);
  assert.equal("empty" in (await facetsOf("csharp", "global using Xunit;\n")), false);
});

test("a PHP template with one echo in it holds a statement", async () => {
  assert.deepEqual(await facetsOf("php", "<p><?php echo $x ?></p>\n"), { testRunner: null, testCalls: false });
});

const QUIET = { testRunner: null, testCalls: false };

test("a Python runner is the module an import names, not a name that appears in one", async () => {
  const body = "\n\n\ndef test_total():\n    assert 1\n";
  for (const line of [
    "from app import unittest, x",
    "from .unittest import x",
    "from . import pytest",
    "from app.mocks import pytest",
    "import app.pytest",
    "import os as pytest",
    "from djangox.test import TestCase",
    "from app.django.test import TestCase",
  ]) {
    assert.deepEqual(await facetsOf("python", line + body), QUIET, line);
  }
  assert.equal((await facetsOf("python", `import pytest as pt${body}`)).testRunner, "pytest");
  assert.equal((await facetsOf("python", `import unittest as ut${body}`)).testRunner, "unittest");
  // The new name is no part of the path: read as `unittest.mock`, this import would name nothing.
  assert.equal((await facetsOf("python", `import unittest as mock${body}`)).testRunner, "unittest");
});

test("Django's test module is unittest by another import", async () => {
  const unit = { testRunner: "unittest", testCalls: true };
  const body = "\n\n\nclass PollTests(TestCase):\n    def test_total(self):\n        self.assertEqual(1, 1)\n";
  assert.deepEqual(await facetsOf("python", `from django.test import TestCase${body}`, "polls/tests.py"), unit);
  assert.deepEqual(await facetsOf("python", `from django.test import SimpleTestCase as TestCase${body}`, "polls/tests.py"), unit);
  assert.deepEqual(await facetsOf("python", `from django.test.testcases import TransactionTestCase as TestCase${body}`, "polls/tests.py"), unit);
  // The import with no case under it is a settings helper, not a test.
  assert.deepEqual(await facetsOf("python", "from django.test import override_settings\n\n\ndef quiet():\n    return override_settings()\n", "polls/tests.py"), QUIET);
});

test("a pytest file imports nothing from pytest, and its path is what says so", async () => {
  const plain = "from app import total\n\n\ndef test_total():\n    assert total() == 1\n";
  const pytest = { testRunner: "pytest", testCalls: true };
  assert.deepEqual(await facetsOf("python", plain, "tests/test_total.py"), pytest);
  assert.deepEqual(await facetsOf("python", plain, "docs_src/app/test_main.py"), pytest);
  assert.deepEqual(await facetsOf("python", plain, "app/total_test.py"), pytest);
  assert.deepEqual(await facetsOf("python", plain, "tests/regress/tests.py"), pytest);
  assert.deepEqual(await facetsOf("python", plain, "app/total.py"), QUIET);
  assert.deepEqual(await facetsOf("python", plain, "app/testing.py"), QUIET);
  const grouped = "class TestTotals:\n    def test_total(self):\n        assert 1\n";
  assert.deepEqual(await facetsOf("python", grouped, "tests/test_total.py"), pytest);
  // A class with a base is a case class the base made, which is unittest's shape.
  const based = "from .base import AdminTestCase\n\n\nclass ChangeListTests(AdminTestCase):\n    def test_total(self):\n        self.assertEqual(1, 1)\n";
  assert.deepEqual(await facetsOf("python", based, "tests/admin_changelist/tests.py"), { testRunner: "unittest", testCalls: true });
});

test("a name that starts with test is not a case where pytest would not collect it", async () => {
  const fixture = "import pytest\n\n\n@pytest.fixture\ndef test_client():\n    return 1\n";
  assert.deepEqual(await facetsOf("python", fixture, "tests/fixtures.py"), QUIET);
  const scoped = "import pytest\n\n\n@pytest.fixture(scope=\"session\")\ndef test_client():\n    return 1\n";
  assert.deepEqual(await facetsOf("python", scoped, "tests/fixtures.py"), QUIET);
  const nested = "def make():\n    def test_inner():\n        return 1\n    return test_inner\n";
  assert.deepEqual(await facetsOf("python", nested, "tests/factories.py"), QUIET);
  const marked = "import pytest\n\n\n@pytest.mark.slow\ndef test_total():\n    assert 1\n";
  assert.equal((await facetsOf("python", marked, "tests/test_total.py")).testRunner, "pytest");
});

test("pytest reads a conftest by its name, wherever it sits and whatever it holds", async () => {
  const fixtures = "import pytest\n\n\n@pytest.fixture\ndef client():\n    return 1\n";
  const read = { testRunner: "pytest", testCalls: false };
  assert.deepEqual(await facetsOf("python", fixtures, "tests/conftest.py"), read);
  assert.deepEqual(await facetsOf("python", fixtures, "conftest.py"), read);
  assert.deepEqual(await facetsOf("python", "def pytest_configure(config):\n    pass\n", "src/app/conftest.py"), read);
  assert.deepEqual(await facetsOf("python", fixtures, "tests/conftest_helpers.py"), QUIET);
  assert.deepEqual(await facetsOf("python", "# nothing yet\n", "tests/conftest.py"), { testRunner: null, testCalls: false, empty: true });
});

test("a Rust file cargo collects by its place is cargo's with no case in it, and only where the caller says it is placed", async () => {
  const helper = "pub fn setup() {}\n";
  const kindOf = ({ testRunner, testCalls, empty }) => ({ testRunner, testCalls, ...(empty ? { empty } : {}) });
  const at = async (rel, placed) => kindOf((await parseTreeFile(helper, rel, "rust", { placed })).facets);
  assert.deepEqual(await at("tests/util.rs", true), { testRunner: "cargo test", testCalls: false });
  assert.deepEqual(await at("tests/util.rs", false), { testRunner: null, testCalls: false });
  assert.deepEqual(kindOf((await parseTreeFile("// later\n", "tests/util.rs", "rust", { placed: true })).facets), { testRunner: null, testCalls: false, empty: true });
  // No tool collects a Go file by its place, so the word changes nothing there.
  assert.deepEqual(kindOf((await parseTreeFile("package a\n\nfunc Setup() {}\n", "tests/util.go", "go", { placed: true })).facets), { testRunner: null, testCalls: false });
});

test("Go: the compiler decides by the file's name, and a case outside a _test file is none", async () => {
  const cased = 'package a\n\nimport "testing"\n\nfunc TestTotal(t *testing.T) {}\n';
  assert.deepEqual(await facetsOf("go", cased, "pkg/total.go"), QUIET);
  assert.deepEqual(await facetsOf("go", cased, "pkg/total_fuzz.go"), QUIET);
  for (const line of ['import "my.testing"', 'import testing "example.com/x/fake"', 'import "example.com/x/testing"']) {
    assert.deepEqual(await facetsOf("go", `package a\n\n${line}\n\nfunc TestTotal(t *testing.T) {}\n`, "pkg/total.go"), QUIET, line);
  }
  // An example takes no argument and imports nothing, and `go test` still runs it.
  assert.deepEqual(await facetsOf("go", "package a\n\nfunc ExampleTotal() {}\n", "pkg/example_test.go"), { testRunner: "go test", testCalls: true });
  // A helper `go test` compiles and no other build ships.
  assert.deepEqual(await facetsOf("go", "package a\n\nfunc setup() {}\n", "pkg/helpers_test.go"), { testRunner: "go test", testCalls: false });
  assert.deepEqual(await facetsOf("go", "package a\n", "pkg/doc_test.go"), { testRunner: null, testCalls: false, empty: true });
});

test("PHPUnit is read off the base class, and off the name a test tree holds", async () => {
  const php = (head, base) => `<?php\n\n${head}\n\nclass AppTest extends ${base}\n{\n    public function testRuns(): void\n    {\n    }\n}\n`;
  const phpunit = { testRunner: "phpunit", testCalls: true };
  assert.deepEqual(await facetsOf("php", php("use Slim\\Tests\\TestCase;", "TestCase"), "app/AppTest.php"), phpunit);
  assert.deepEqual(await facetsOf("php", php("namespace Tests;", "\\PHPUnit\\Framework\\TestCase"), "app/AppTest.php"), phpunit);
  assert.deepEqual(await facetsOf("php", php("namespace Tests;", "DatabaseTestCase"), "app/AppTest.php"), phpunit);
  // A base that says nothing, under a name and a tree that do.
  assert.deepEqual(await facetsOf("php", php("namespace Tests;", "AbstractApp"), "tests/AppTest.php"), phpunit);
  assert.deepEqual(await facetsOf("php", php("namespace Tests;", "AbstractApp"), "tests/Mocks/App.php"), QUIET);
  assert.deepEqual(await facetsOf("php", php("namespace App;", "AbstractApp"), "src/AppTest.php"), QUIET);
});

test("an aliased case annotation is the annotation it was imported as", async () => {
  const kotlin = "package a\n\nimport org.junit.Test as T\n\nclass TotalTest {\n    @T\n    fun total() {\n    }\n}\n";
  assert.deepEqual(await facetsOf("kotlin", kotlin), { testRunner: "junit", testCalls: true });
  const other = "package a\n\nimport org.junit.Rule as T\n\nclass Totals {\n    @T\n    fun total() {\n    }\n}\n";
  assert.deepEqual(await facetsOf("kotlin", other), QUIET);
  const csharp = "using T = NUnit.Framework.TestAttribute;\n\npublic class TotalTests\n{\n    [T]\n    public void Total() {}\n}\n";
  assert.deepEqual(await facetsOf("csharp", csharp), { testRunner: "nunit", testCalls: true });
});

test("a C# attribute is read with or without its Attribute suffix", async () => {
  const long = "public class TotalTests\n{\n    [FactAttribute]\n    public void Total() {}\n}\n";
  assert.deepEqual(await facetsOf("csharp", long), { testRunner: "xunit", testCalls: true });
  const other = "public class Totals\n{\n    [ObsoleteAttribute]\n    public void Total() {}\n}\n";
  assert.deepEqual(await facetsOf("csharp", other), QUIET);
});

test("rust: a use that climbs past the top, or names the crate where no src holds it, reaches for nothing and reads the file", async () => {
  const facets = await allFacetsOf("rust", "use super::super::super::x;\nuse crate::y;\nfn z() {}\n", "tests/it.rs");
  assert.equal(facets.refs, undefined);
  assert.deepEqual(facets.defines, ["z"]);
});

// What a file reaches for with no import naming the file: a dotted module's attribute, a wildcard's class,
// a path written in the call, a function PHP loads globally, and a C# extension method.
const REACHES_UNIMPORTED = {
  python: [
    "app/a.py",
    "import shop.money\nimport shop.text as t\nfrom shop import util\nshop.money.format_price(1)\nt.slug(2)\nutil.clean(3)\n",
    [
      { name: "money", stems: ["shop/money", "shop/money/__init__"] },
      { name: "text", stems: ["shop/text", "shop/text/__init__"] },
      { name: "util", stems: ["shop/util", "shop/util/__init__", "shop", "shop/__init__"] },
      { name: "format_price", stems: ["shop/money", "shop/money/__init__"] },
      { name: "slug", stems: ["shop/text", "shop/text/__init__"] },
      { name: "clean", stems: ["shop/util", "shop/util/__init__"] },
    ],
  ],
  java: [
    "src/X.java",
    "import com.acme.util.*;\nclass X { void f() { Strings.isBlank(s); } }\n",
    [{ name: "Strings.isBlank", bare: "Strings", member: "isBlank", stems: ["com/acme/util/Strings"] }],
  ],
  kotlin: [
    "src/X.kt",
    "import com.acme.util.*\nfun f() { Strings.of() }\n",
    [{ name: "Strings.of", bare: "Strings", member: "of", stems: ["com/acme/util/Strings"], dir: "com/acme/util", lookup: "Strings" }],
  ],
  rust: [
    "src/a.rs",
    'fn x() { crate::text::escape("x"); self::inner::run(); }\n',
    [
      { name: "escape", stems: ["src/text/escape", "src/text/escape/mod", "src/text", "src/text/mod"], exact: true },
      { name: "run", stems: ["src/a/inner/run", "src/a/inner/run/mod", "src/a/inner", "src/a/inner/mod"], exact: true },
    ],
  ],
  php: [
    "app/a.php",
    "<?php\nfunction money($x) { return $x; }\necho money(1) . strlen('a');\n",
    [
      { name: "money", global: "money" },
      { name: "strlen", global: "strlen" },
    ],
  ],
  csharp: [
    "src/U.cs",
    "namespace Acme.Web;\nclass U { void F(string s) { s.Slug(); Name.Trim(); } }\n",
    [
      { name: "Slug", extension: "Slug" },
      { name: "Name.Trim", bare: "Name", member: "Trim", type: "Name" },
    ],
  ],
};

for (const [lang, [rel, source, refs]] of Object.entries(REACHES_UNIMPORTED)) {
  test(`${lang}: a file names what it reaches for where no import names the file`, async () => {
    assert.deepEqual((await allFacetsOf(lang, source, rel)).refs, refs);
  });
}

test("php: a file names the functions it defines outside any class, which a call anywhere reaches", async () => {
  const facets = await allFacetsOf("php", "<?php\nfunction money($x) { return $x; }\nclass A { function m() {} }\n", "app/helpers.php");
  assert.deepEqual(facets.globals, ["money"]);
});

test("csharp: a file names the extension methods it declares, which a call on any value reaches", async () => {
  const facets = await allFacetsOf("csharp", "namespace Acme.Text;\npublic static class StringExt {\n  public static string Slug(this string s) => s;\n  public static string Plain(string s) => s;\n}\n", "src/StringExt.cs");
  assert.deepEqual(facets.extensions, ["Slug"]);
});

test("csharp: a global using opens its namespace for the project, and is kept apart from the file's own", async () => {
  const facets = await allFacetsOf("csharp", "global using Acme.Text;\nusing System;\n", "src/GlobalUsings.cs");
  assert.deepEqual([facets.globalUsings, facets.usings], [["Acme.Text"], ["System"]]);
});

test("rust: `self` in a use list names the module the list is under", async () => {
  const facets = await allFacetsOf("rust", "use crate::text::{self, escape};\nfn z() {}\n", "src/a.rs");
  assert.deepEqual(facets.refs.map((r) => r.name), ["text", "escape"]);
});

test("csharp: a call on this or base is the class's own, and no extension method's", async () => {
  const facets = await allFacetsOf("csharp", "namespace App;\nclass A : B { void F() { this.Format(); base.Run(); x.Slug(); } }\n", "src/A.cs");
  assert.deepEqual(facets.refs.filter((r) => r.extension).map((r) => r.name), ["Slug"]);
});

test("php: a function called by its namespaced name is the function of that name", async () => {
  const facets = await allFacetsOf("php", "<?php\necho \\App\\Support\\money(2);\n", "app/a.php");
  assert.deepEqual(facets.refs, [{ name: "money", global: "money" }]);
});

test("java: a class named bare is first looked for in the file's own package, before a wildcard's", async () => {
  const facets = await allFacetsOf("java", "package com.acme.app;\nimport com.acme.util.*;\nclass X { void f() { Strings.isBlank(s); } }\n", "src/X.java");
  assert.deepEqual(facets.refs, [{ name: "Strings.isBlank", bare: "Strings", member: "isBlank", stems: ["com/acme/app/Strings", "com/acme/util/Strings"] }]);
});
