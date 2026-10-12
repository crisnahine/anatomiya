import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Language } from "web-tree-sitter";

import { CONTAINERS, measure, ORACLE, oracleHits, tally } from "../scripts/measure-inert.mjs";
import { parseForLines } from "../plugins/anatomiya/lib/tree-sitter-runtime.mjs";
import { ANATOMIYA } from "../scripts/plugins.mjs";

function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), "anatomiya-measure-inert-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t.test");
  git("config", "user.name", "T");
  const commit = (files, message) => {
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
    git("add", "-A");
    git("commit", "-qm", message);
  };
  return { dir, commit };
}

test("each tree-sitter file a commit changed is asked or left out by the rule, and nothing else is counted", async (t) => {
  const { dir, commit } = repo(t);
  commit({ "svc/total.py": "def total(xs):\n    return sum(xs)\n", "web/a.js": "export const a = 1;\n" }, "init");
  commit({ "svc/total.py": "# Totals.\ndef total(xs):\n    return sum(xs)\n" }, "a comment");
  commit({ "svc/total.py": "# Totals.\ndef total(xs):\n    return sum(xs)\n\n\ndef mean(xs):\n    return total(xs) / len(xs)\n", "web/a.js": "export function b() {}\n" }, "a function");
  commit({ "cmd/main.go": "package main\n\nconst Limit = 3\n" }, "a constant");
  commit({ "app/migrations/0002_rank.py": "def forwards(apps, schema_editor):\n    pass\n" }, "a migration");

  const result = await measure(dir, { commits: 200, samples: 5 });

  assert.equal(result.commits, 5);
  assert.deepEqual(Object.keys(result.langs).sort(), ["go", "python"]);
  assert.equal(result.langs.python.asked, 1);
  assert.equal(result.langs.python.skipped, 1);
  assert.equal(result.langs.go.skipped, 1);
  assert.deepEqual(result.langs.python.hits, []);
  assert.deepEqual(result.langs.python.skippedFiles.map((f) => [f.path, f.added]), [["svc/total.py", ["# Totals."]]]);

  const all = tally([result, result]);
  assert.equal(all.python.skipped, 2);
  assert.equal(typeof all.python.ms.p50, "number");
});

test("the oracle names a function, a lambda, a call and a binding to a name that start on an added line", async () => {
  const source = "LIMIT = 3\ndef f():\n    pass\ng = lambda: 1\nh = run()\nk = other\n";
  const parsed = await parseForLines(source, "python", { cancel: () => false });
  try {
    assert.deepEqual(oracleHits(parsed.tree, "python", [[1, 1]]), [], "a constant is no hit");
    const types = oracleHits(parsed.tree, "python", [[2, 6]]).map((h) => [h.line, h.type]).sort();
    assert.deepEqual(types, [[2, "function_definition"], [4, "binding to lambda"], [4, "lambda"], [5, "binding to call"], [5, "call"], [6, "binding to identifier"]]);
  } finally {
    parsed.tree.delete();
  }
});

test("the oracle names a call whose arguments or closing bracket were added, and the shapes the review found", async () => {
  const call = await parseForLines("x = run(\n    1,\n)\n", "python", { cancel: () => false });
  try {
    assert.deepEqual(oracleHits(call.tree, "python", [[2, 2]]).map((h) => h.type), ["call"]);
    assert.deepEqual(oracleHits(call.tree, "python", [[3, 3]]).map((h) => h.type), ["call"]);
    assert.deepEqual(oracleHits(call.tree, "python", [[1, 1]]).map((h) => h.type).sort(), ["binding to call", "call"]);
  } finally {
    call.tree.delete();
  }
  for (const [lang, source, type] of [
    ["python", "cache[compute()] = 1\n", "call"],
    ["php", "<?php\nclass A {\n    public string $x = 'a' {\n        get => 1;\n    }\n}\n", "property_hook"],
    ["rust", "fn f() {\n    let y = 1 else { return };\n}\n", "binding with an alternative"],
  ]) {
    const parsed = await parseForLines(source, lang, { cancel: () => false });
    try {
      const lines = source.split("\n").length;
      assert.ok(oracleHits(parsed.tree, lang, [[1, lines]]).some((h) => h.type === type), `${lang}: ${type}`);
    } finally {
      parsed.tree.delete();
    }
  }
});

test("a constant added to a class body or a lambda is not taken for the class or the call", async () => {
  const cases = [
    ["python", "class A:\n    X = 1\n    Y = 2\n", [[3, 3]]],
    ["kotlin", "fun f() {\n    run {\n        val x = 1\n    }\n}\n", [[3, 3]]],
  ];
  for (const [lang, source, added] of cases) {
    const parsed = await parseForLines(source, lang, { cancel: () => false });
    try {
      assert.deepEqual(oracleHits(parsed.tree, lang, added), [], lang);
    } finally {
      parsed.tree.delete();
    }
  }
});

test("a comment or a docstring added inside a definition is not taken for the definition", async () => {
  const source = 'class A:\n    """Doc."""\n\n    def f(self):\n        # note\n        return run(\n            # why\n            1,\n        )\n';
  const parsed = await parseForLines(source, "python", { cancel: () => false });
  try {
    assert.deepEqual(oracleHits(parsed.tree, "python", [[2, 2], [5, 5], [7, 7]]), []);
  } finally {
    parsed.tree.delete();
  }
});

test("every node type the oracle names is one its grammar knows", async () => {
  for (const [lang, types] of Object.entries({ ...ORACLE, ...Object.fromEntries(Object.entries(CONTAINERS).map(([l, c]) => [l, [...ORACLE[l], ...c]])) })) {
    const language = await Language.load(join(ANATOMIYA, "grammars", `${lang}.wasm`));
    assert.deepEqual(types.filter((type) => language.idForNodeType(type, true) === null), [], lang);
  }
});
