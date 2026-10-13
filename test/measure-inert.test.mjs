import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Language } from "web-tree-sitter";

import { ACCESS, CONTAINERS, COUNTED, FIELDS, FOREIGN, measure, ORACLE, oracleHits, tally, UNION } from "../scripts/measure-inert.mjs";
import { parseForLines } from "../plugins/anatomiya/lib/tree-sitter-runtime.mjs";
import { ANATOMIYA } from "../scripts/plugins.mjs";
import * as SAMPLES from "./tree-samples.mjs";

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
  const php = ['<?php', '$a["${foo()}"] = 1;', '$a->{"${foo()}"} = 1;', '$x = "{${foo()}}";', 'echo "a ${foo()}";', '$a["k\\n"] = "plain";', '$x = "plain\\n";', ""].join("\n");
  assert.deepEqual((await named("php", php, [[2, 5]])).filter(([, type]) => type.startsWith("string")), [2, 3, 4, 5].map((line) => [line, "string holding dynamic_variable_name"]));
  assert.deepEqual(await named("php", php, [[6, 7]]), [[6, "write to subscript_expression"]]);
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

test("the oracle names a sign on a literal that Kotlin or C# may bind to a user's operator, and passes a pair the language defines", async () => {
  const kotlin = ['val a = +"a"', "val b = !1", "val c = -'a'", "val d = -1u", "val e = -1", "val f = !true", "val g = -1.5e-3f", ""].join("\n");
  assert.deepEqual(await named("kotlin", kotlin, [[1, 7]]), [1, 2, 3, 4].map((line) => [line, "binding to unary_expression"]));
  const csharp = ["class A {", '    string a = -"a";', "    bool b = !1;", "    long c = -1ul;", "    int d = ~1.5;", "    int e = -1;", "    int f = ~0;", "    int g = -'a';", "    bool h = !true;", "}", ""].join("\n");
  assert.deepEqual(await named("csharp", csharp, [[2, 9]]), [2, 3, 4, 5].map((line) => [line, "binding to prefix_unary_expression"]));
  // No user code stands behind an operator on a built-in type in the other five.
  assert.deepEqual(await named("python", 'A = -"a"\n', [[1, 1]]), []);
});

test("the oracle names a C# literal declared as a type spelt as a name, and passes a keyword type, a const and a null", async () => {
  const source = ["class A {", "    Money a = 5;", '    Name n = "x";', "    Money? h = -1;", "    Money[] ms = { 1 };", "    static readonly Money F = 5;", "    int b = 5;", "    int?[] c = { 1 };", "    var v = 1;", "    const Money D = 5;", "    Foo f = null;", "    ulong[,] g = null;", "}", ""].join("\n");
  assert.deepEqual(await named("csharp", source, [[2, 12]]), [[2, "literal declared as Money"], [3, "literal declared as Name"], [4, "literal declared as Money?"], [5, "literal declared as Money[]"], [6, "literal declared as Money"]]);
});

test("the oracle names a sign before a name outside a value, and passes one before a literal", async () => {
  assert.deepEqual(await named("python", "x: t[-b] = 1\nx: ~b = 1\nx: -b = 1\nx: -1 = 1\n", [[1, 4]]), [1, 2, 3].map((line) => [line, "binding holding unary_operator"]));
});

test("the oracle names a Python or PHP assignment whose target is not a plain name, whatever its value, and passes a pattern of plain names", async () => {
  const python = ["x = 1", "x: int = 1", "a, b = 1, 2", "[a, (b, *c)] = 1, 2", "naïve = 1", "a.b = 1", 'CONFIG["k"] = 1', "a.b, c = 1, 2", "[a[0], b] = 1, 2", "a.b: int = 1", ""].join("\n");
  assert.deepEqual(await named("python", python, [[1, 5]]), []);
  assert.deepEqual(await named("python", python, [[6, 10]]), [[6, "write to attribute"], [7, "write to subscript"], [8, "write to pattern_list"], [9, "write to list_pattern"], [10, "write to attribute"]]);
  const php = ["<?php", "$x = 1;", "[$a, $b] = [1, 2];", "list($a, list($b, $c)) = [1, [2, 3]];", "const A = 1;", "$a->b = 1;", "$a['k'] = 1;", "$a[] = 1;", "self::$x = 1;", "Foo::$x = 1;", "$$x = 1;", "[$a->b, $c] = [1, 2];", ""].join("\n");
  assert.deepEqual(await named("php", php, [[2, 5]]), []);
  assert.deepEqual(await named("php", php, [[6, 12]]), [
    [6, "write to member_access_expression"],
    [7, "write to subscript_expression"],
    [8, "write to subscript_expression"],
    [9, "write to scoped_property_access_expression"],
    [10, "write to scoped_property_access_expression"],
    [11, "write to dynamic_variable_name"],
    [12, "write to list_literal"],
  ]);
});

test("the oracle names a declaration with no body that declares something callable", async () => {
  assert.deepEqual(await named("go", "package m\n\ntype I interface {\n\tM(x int) error\n}\n\ntype S struct {\n\tn int\n}\n", [[4, 4], [8, 8]]), [[4, "method_elem"]]);
  assert.deepEqual(await named("rust", 'trait T {\n    fn m(&self) -> u8;\n}\nextern "C" {\n    fn ext(x: i32) -> i32;\n}\n', [[2, 2], [5, 5]]), [[2, "function_signature_item"], [5, "function_signature_item"]]);
  assert.deepEqual(await named("csharp", "class A {\n    int P => 1;\n    int b = 1;\n}\n", [[2, 3]]), [[2, "arrow_expression_clause"]]);
});

test("the oracle passes a string made of its own text and a struct type made of names, and names what either holds past that", async () => {
  for (const [lang, source, plain, odd, hit] of [
    // Each: the lines made of text and names, the lines past them, and what the oracle names there.
    ["csharp", "class A {\n    char a = 'x';\n    char b = F('x');\n}\n", [2, 2], [3, 3], "invocation_expression"],
    ["python", 'A = f"{{}}"\nB = f"{{{x}}}"\n', [1, 1], [2, 2], "string holding interpolation"],
    ["php", "<?php\nconst A = <<<'T'\nplain\nT;\n$b = <<<T\n{$x}\nT;\n", [1, 4], [5, 7], "binding to heredoc"],
    ["go", "package m\n\nvar i = struct{ a int }{}\nvar w = struct{ a [f()]int }{}\n", [1, 3], [4, 4], "binding to call_expression"],
    ["kotlin", "val r = 2.5\nval s = f(2.5)\n", [1, 1], [2, 2], "call_expression"],
  ]) {
    assert.deepEqual(await named(lang, source, [plain]), [], `${lang}: lines ${plain.join(" to ")}`);
    assert.ok((await named(lang, source, [odd])).some((h) => h[1] === hit), `${lang}: ${hit}`);
  }
});

test("the oracle reads | as joining types inside a Python annotation, and names a subscript target whatever it holds", async () => {
  const source = "a[b | c] = 1\nx[b | c]: int = 1\nx: a | b = 1\nx: list[a | b] = []\n";
  assert.deepEqual(await named("python", source, [[1, 4]]), [[1, "write to subscript"], [2, "write to subscript"]]);
});

test("a C# directive that closes a conditional is no hit, and the one that opens it is", async () => {
  const source = "class A {\n#if X\n    int a = 1;\n#endif\n#endregion\n}\n";
  assert.deepEqual(await named("csharp", source, [[4, 5]]), []);
  assert.deepEqual(await named("csharp", source, [[2, 2]]), [[2, "preproc_if"]]);
});

test("the oracle names an accessor opened on an added line, and an assignment that is an argument by its call", async () => {
  const kotlin = "class A {\n    val d: Int = 1\n        get() {\n            return h()\n        }\n    val e: Int = 1\n}\n";
  assert.deepEqual(await named("kotlin", kotlin, [[3, 3]]), [[3, "getter"]]);
  assert.deepEqual(await named("kotlin", kotlin, [[6, 6]]), []);
  const csharp = "class A {\n    int X {\n        get {\n            return 1;\n        }\n    }\n}\n";
  assert.deepEqual(await named("csharp", csharp, [[3, 3]]), [[3, "accessor_declaration"]]);
  const php = "<?php\nfoo(\n    $a = 1\n);\n$a = 1;\n";
  assert.deepEqual(await named("php", php, [[3, 3]]), [[2, "function_call_expression"]]);
  assert.deepEqual(await named("php", php, [[5, 5]]), []);
  assert.deepEqual(await named("php", "<?php\nfoo(\n    $a['k'] = 1\n);\n", [[3, 3]]), [[2, "function_call_expression"], [3, "write to subscript_expression"]]);
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
    ["php", "<?php\nenum En: string {\n    const X = 1;\n}\n", [[3, 3]]],
    ["java", "@interface An {\n    int E = 1;\n}\n", [[2, 2]]],
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

test("the oracle names a comment cgo compiles and inline markup that holds a script, and passes their plain neighbours", async () => {
  const go = 'package m\n\n/*\nstatic int add(int a, int b) { return a+b; }\n*/\nimport "C"\n\n// Printing.\nimport "fmt"\n';
  assert.deepEqual(await named("go", go, [[4, 4]]), [[3, "comment above an import of C"]]);
  assert.deepEqual(await named("go", go, [[6, 9]]), []);
  const php = '<p>plain</p>\n<?php\n$a = 1;\n?>\n<Script>function dup() {}</script>\n';
  assert.deepEqual(await named("php", php, [[5, 5]]), [[5, "markup holding a script"]]);
  assert.deepEqual(await named("php", php, [[1, 3]]), []);
});

test("every node type the oracle names is one its grammar knows", async () => {
  const counted = (lang) => Object.entries(COUNTED[lang] ?? {}).flat();
  for (const [lang, types] of Object.entries(CONTAINERS).map(([l, c]) => [l, [...ORACLE[l], ...c, ...counted(l), ...(ACCESS[l] ?? []), ...(FOREIGN[l] ?? []), ...Object.values(UNION[l] ?? {})]])) {
    const language = await Language.load(join(ANATOMIYA, "grammars", `${lang}.wasm`));
    assert.deepEqual(types.filter((type) => language.idForNodeType(type, true) === null), [], lang);
  }
});

test("every field the oracle reads is one its grammar knows, filled on the node it is read from in an ordinary file", async () => {
  // A grammar that renames one leaves the oracle reading null, which passes every write, every declared type and every operator.
  assert.deepEqual(Object.keys(FIELDS).sort(), ["declared", "operator", "target"]);
  for (const { field, of } of Object.values(FIELDS)) {
    for (const [lang, type] of Object.entries(of)) {
      const language = await Language.load(join(ANATOMIYA, "grammars", `${lang}.wasm`));
      assert.notEqual(language.fieldIdForName(field), null, `${lang}: ${field}`);
      assert.notEqual(language.idForNodeType(type, true), null, `${lang}: ${type}`);
      const parsed = await parseForLines(SAMPLES[lang], lang, { cancel: () => false });
      try {
        assert.ok(parsed.tree.rootNode.descendantsOfType(type).some((node) => node.childForFieldName(field) !== null), `${lang}: no ${type} of the sample fills ${field}`);
      } finally {
        parsed.tree.delete();
      }
    }
  }
});
