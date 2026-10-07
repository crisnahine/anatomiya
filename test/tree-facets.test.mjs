import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTreeFile } from "../plugins/anatomiya/lib/tree-sitter-file.mjs";
import { treeFacets } from "../plugins/anatomiya/lib/tree-facets.mjs";
import * as SAMPLES from "./tree-samples.mjs";

const EXT = { python: "py", php: "php", go: "go", java: "java", csharp: "cs", rust: "rs", kotlin: "kt" };

/** The facets of one source, read off the tree the engine hands over. */
async function facetsOf(lang, source) {
  const r = await parseTreeFile(source, `src/a.${EXT[lang]}`, lang, { withProgram: true });
  assert.equal(r.ok, true, `${lang} sample did not parse: ${r.error}`);
  return treeFacets(r.program, lang);
}

for (const lang of Object.keys(EXT)) {
  test(`${lang}: an ordinary source file names no runner and declares no case`, async () => {
    assert.deepEqual(await facetsOf(lang, SAMPLES[lang]), { testRunner: null, testCalls: false });
  });
}

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

for (const [label, lang, source] of RUNNERS) {
  test(`a test file names its runner: ${label}`, async () => {
    assert.deepEqual(await facetsOf(lang, source), { testRunner: label, testCalls: true });
  });
}

test("a runner's import with no case in the file is not a test", async () => {
  // A conftest and a benchmark helper both import the runner and declare nothing it collects.
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
  assert.deepEqual(await facetsOf("rust", rust), { testRunner: "cargo test", testCalls: true });
  // `test` is the argument here, and `cfg` is the attribute.
  const gated = "#[cfg(test)]\nfn only_in_tests() {}\n";
  assert.deepEqual(await facetsOf("rust", gated), { testRunner: null, testCalls: false });
});

test("a Rust source file holding its own unit tests in a module is still a source file", async () => {
  const source = "pub fn total() -> i64 {\n    1\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn adds() {\n        assert_eq!(total(), 1);\n    }\n}\n";
  assert.deepEqual(await facetsOf("rust", source), { testRunner: null, testCalls: false });
});

test("a Pest case is a call at file level, and the same word inside a function is not", async () => {
  const inside = "<?php\n\nfunction run()\n{\n    test('x', 1);\n}\n";
  assert.deepEqual(await facetsOf("php", inside), { testRunner: null, testCalls: false });
  const grouped = "<?php\n\ndescribe('totals', function () {\n    test('adds', function () {\n    });\n});\n";
  assert.deepEqual(await facetsOf("php", grouped), { testRunner: "pest", testCalls: true });
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
