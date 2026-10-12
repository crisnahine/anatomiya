import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Language } from "web-tree-sitter";

import { ACCESS, CONTAINERS, COUNTED, measure, ORACLE, oracleHits, tally, UNION } from "../scripts/measure-inert.mjs";
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

  // The comment's hunk is left out and the function's is asked, in one file each: both counts are of hunks.
  assert.deepEqual([result.langs.python.askedHunks, result.langs.python.skippedHunks], [1, 1]);

  const all = tally([result, result]);
  assert.equal(all.python.skipped, 2);
  assert.deepEqual([all.python.askedHunks, all.python.skippedHunks], [2, 2]);
  assert.equal(typeof all.python.ms.p50, "number");
});

test("a hunk left out of a file that is asked about is read by the oracle too", async (t) => {
  const { dir, commit } = repo(t);
  commit({ "svc/total.py": "LIMIT = 3\n\n\ndef total(xs):\n    return sum(xs)\n" }, "init");
  commit({ "svc/total.py": "# Totals.\nLIMIT = 3\n\n\ndef total(xs):\n    return sum(xs)\n\n\ndef mean(xs):\n    return total(xs) / len(xs)\n" }, "a comment and a function");

  const handed = [];
  const oracle = (tree, lang, added) => {
    handed.push([lang, added]);
    return [{ line: added[0][0], type: "probe", text: "" }];
  };

  const { python } = (await measure(dir, { commits: 200, samples: 5, oracle })).langs;

  assert.deepEqual([python.asked, python.skipped, python.askedHunks, python.skippedHunks], [1, 0, 1, 1]);
  assert.deepEqual(handed, [["python", [[1, 1]]]], "the comment's hunk and not the function's");
  assert.deepEqual(python.hits.map((h) => [h.path, h.line, h.type]), [["svc/total.py", 1, "probe"]]);
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

test("the oracle names a call whose arguments were added, a call in a target, a property hook and a let-else", async () => {
  const call = await parseForLines("x = run(\n    1,\n)\n", "python", { cancel: () => false });
  try {
    assert.deepEqual(oracleHits(call.tree, "python", [[2, 2]]).map((h) => h.type), ["call"]);
    assert.deepEqual(oracleHits(call.tree, "python", [[3, 3]]), [], "the closing bracket alone is no hit");
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

test("a closing bracket left as the only added line is no hit, and a call added on a bracket line is", async (t) => {
  // A removed argument leaves `)` behind as the one added line (A91: a closing bracket is inert).
  const { dir, commit } = repo(t);
  commit({ "svc/a.py": "x = run(\n    1,\n    2,\n).real\n" }, "init");
  commit({ "svc/a.py": "x = run(\n    1,\n    2,\n)\n" }, "drop the attribute");
  const result = await measure(dir, { commits: 200, samples: 5 });
  assert.equal(result.langs.python.skipped, 1);
  assert.deepEqual(result.langs.python.skippedFiles[0].added, [")"]);
  assert.deepEqual(result.langs.python.hits, []);

  for (const [lang, source, line, type] of [
    ["python", "x = run(\n    1,\n) + compute()\n", 3, "call"],
    ["kotlin", "val x = build {\n    1\n}.also { run() }\n", 3, "call_expression"],
  ]) {
    const parsed = await parseForLines(source, lang, { cancel: () => false });
    try {
      assert.ok(oracleHits(parsed.tree, lang, [[line, line]]).some((h) => h.type === type), `${lang}: ${type}`);
    } finally {
      parsed.tree.delete();
    }
  }
});

test("the oracle passes a Go constant with no value or counted off iota, and names one whose value holds another name", async () => {
  const source = "package m\n\nconst (\n\tA = iota\n\tB\n\tC Color = (1 << iota) - 1\n\tD = other\n\tE = iota + pkg.Step\n\tF = len(x)\n)\n";
  const parsed = await parseForLines(source, "go", { cancel: () => false });
  try {
    assert.deepEqual(oracleHits(parsed.tree, "go", [[4, 6]]), []);
    const hits = oracleHits(parsed.tree, "go", [[7, 9]]).map((h) => [h.line, h.type]).sort();
    assert.deepEqual(hits, [[7, "binding to identifier"], [8, "binding to field_identifier"], [9, "binding to identifier"], [9, "call_expression"]]);
  } finally {
    parsed.tree.delete();
  }
});

/** What the oracle names on the added lines of a file, as `[line, type]` in order. */
async function named(lang, source, added) {
  const parsed = await parseForLines(source, lang, { cancel: () => false });
  try {
    return oracleHits(parsed.tree, lang, added).map((h) => [h.line, h.type]).sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  } finally {
    parsed.tree.delete();
  }
}

test("the oracle names a Go constant converted from iota, and passes a bare one under a call", async () => {
  const source = "package m\n\nconst (\n\tA = T(iota)\n\tB\n)\n\nconst (\n\tC = f()\n\tD\n)\n";
  assert.deepEqual(await named("go", source, [[4, 4]]), [[4, "binding to identifier"], [4, "call_expression"]]);
  assert.deepEqual(await named("go", source, [[5, 5], [10, 10]]), []);
});

test("the oracle names whatever a string holds past its own text, wherever the string stands", async () => {
  const php = ['<?php', '$a["${foo()}"] = 1;', '$a->{"${foo()}"} = 1;', '$x = "{${foo()}}";', 'echo "a ${foo()}";', '$a["k\\n"] = "plain";', ""].join("\n");
  assert.deepEqual((await named("php", php, [[2, 5]])).filter(([, type]) => type.startsWith("string")), [2, 3, 4, 5].map((line) => [line, "string holding dynamic_variable_name"]));
  assert.deepEqual(await named("php", php, [[6, 6]]), []);
});

test("the oracle names a node in a binding's type, pattern or modifiers that is no name, type or literal", async () => {
  for (const [lang, source, line, type] of [
    ["rust", "const E: [u8; { N }] = [0];\nconst F: [u8; 3] = [0];\n", 1, "binding holding block"],
    ["rust", "fn h() {\n    let const { N } = 1;\n    let (a, b) = (1, 2);\n}\n", 2, "binding holding const_block"],
    ["go", "package m\n\nvar x = [size()]int{0}\nvar y = [3]int{0}\n", 3, "binding to call_expression"],
    ["go", "package m\n\nconst N [f()]int = 1\nconst K Kind = 1\n", 3, "binding holding call_expression"],
    ["csharp", "class A {\n    int[F()] e = null;\n    int[3] r = null;\n}\n", 2, "declaration holding invocation_expression"],
    ["python", "x: a + b = 1\nx: a | b = 1\n", 1, "binding holding binary_operator"],
  ]) {
    assert.ok((await named(lang, source, [[line, line]])).some((h) => h[1] === type), `${lang}: ${type}`);
    assert.deepEqual(await named(lang, source, [[line + 1, line + 1]]), [], `${lang}: the plain neighbour`);
  }
});

test("the oracle names an accessor opened on an added line, and an assignment that is an argument by its call", async () => {
  const kotlin = "class A {\n    val d: Int = 1\n        get() {\n            return h()\n        }\n    val e: Int = 1\n}\n";
  assert.deepEqual(await named("kotlin", kotlin, [[3, 3]]), [[3, "getter"]]);
  assert.deepEqual(await named("kotlin", kotlin, [[6, 6]]), []);
  const csharp = "class A {\n    int X {\n        get {\n            return 1;\n        }\n    }\n}\n";
  assert.deepEqual(await named("csharp", csharp, [[3, 3]]), [[3, "accessor_declaration"]]);
  const php = "<?php\nfoo(\n    $a['k'] = 1\n);\n$a['k'] = 1;\n";
  assert.deepEqual(await named("php", php, [[3, 3]]), [[2, "function_call_expression"]]);
  assert.deepEqual(await named("php", php, [[5, 5]]), []);
});

test("a bracket line that also ends a string spread over lines is charged to the call around it", async () => {
  for (const [lang, source, line, type] of [
    ["rust", 'fn f() {\n    let x = run(r#"\na\nz"#);\n}\n', 4, "call_expression"],
    ["csharp", 'class A {\n    void F() {\n        var x = Run(@"\na\n");\n    }\n}\n', 5, "invocation_expression"],
  ]) {
    const parsed = await parseForLines(source, lang, { cancel: () => false });
    try {
      assert.ok(oracleHits(parsed.tree, lang, [[line, line]]).some((h) => h.type === type), `${lang}: ${type}`);
      assert.deepEqual(oracleHits(parsed.tree, lang, [[line + 1, line + 1]]), [], `${lang}: the brace alone`);
    } finally {
      parsed.tree.delete();
    }
  }
});

test("a constant added to a class body or a lambda, or an import added inside a conditional, is not taken for what holds it", async () => {
  const cases = [
    ["python", "class A:\n    X = 1\n    Y = 2\n", [[3, 3]]],
    ["kotlin", "fun f() {\n    run {\n        val x = 1\n    }\n}\n", [[3, 3]]],
    // A conditional around a whole file holds its lines as a body does.
    ["csharp", "#if HAVE_ASYNC\nusing System;\nusing System.Linq;\n#endif\n", [[3, 3]]],
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
  const counted = (lang) => Object.entries(COUNTED[lang] ?? {}).flat();
  for (const [lang, types] of Object.entries(CONTAINERS).map(([l, c]) => [l, [...ORACLE[l], ...c, ...counted(l), ...(ACCESS[l] ?? []), ...(UNION[l] ? [UNION[l]] : [])]])) {
    const language = await Language.load(join(ANATOMIYA, "grammars", `${lang}.wasm`));
    assert.deepEqual(types.filter((type) => language.idForNodeType(type, true) === null), [], lang);
  }
});
