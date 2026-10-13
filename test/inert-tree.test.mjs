import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Node, Tree } from "web-tree-sitter";

import { parseForLines } from "../plugins/anatomiya/lib/tree-sitter-runtime.mjs";
import { treeInertLines } from "../plugins/anatomiya/lib/inert-tree.mjs";
import { oracleHits } from "../scripts/measure-inert.mjs";
import * as SAMPLES from "./tree-samples.mjs";

const never = () => false;

test("a file the grammar reads comes back as its tree, which the caller deletes", async () => {
  const parsed = await parseForLines("X = 1\n", "python", { cancel: never });
  try {
    assert.equal(parsed.tree.rootNode.type, "module");
  } finally {
    parsed.tree.delete();
  }
});

test("a file the grammar rejects comes back rejected, with no tree to delete", async () => {
  assert.deepEqual(await parseForLines("def (:\n", "python", { cancel: never }), { rejected: true });
});

test("a parse the caller cancels comes back timed out, and the next file is read from its own start", async () => {
  // A cancelled parse is resumed by the next call on the same parser unless it
  // is reset, which read a one-line file as the tail of the one before it.
  const big = "def f(x):\n    return x + 1\n".repeat(5000);
  let asked = 0;
  assert.deepEqual(await parseForLines(big, "python", { cancel: () => ++asked > 3 }), { timedOut: true });
  assert.ok(asked > 3, "the cancel was consulted while the parse ran");

  const parsed = await parseForLines("X = 1\n", "python", { cancel: never });
  try {
    assert.equal(parsed.tree.rootNode.toString(), "(module (expression_statement (assignment left: (identifier) right: (integer))))");
  } finally {
    parsed.tree.delete();
  }
});

test("a cancel already due reads nothing", async () => {
  assert.deepEqual(await parseForLines("X = 1\n", "python", { cancel: () => true }), { timedOut: true });
});

test("a grammar that is not there is no parse at all", async (t) => {
  const empty = mkdtempSync(join(tmpdir(), "anatomiya-inert-tree-"));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  assert.equal(await parseForLines("X = 1\n", "python", { cancel: never, grammars: empty }), null);
});

test("a failure while the tree is walked asks about every non-blank line of that file", async () => {
  // A trap past the parse would reach the hook's boundary, which answers {} for the whole stop.
  const walk = Tree.prototype.walk;
  Tree.prototype.walk = () => {
    throw new RangeError("trap");
  };
  try {
    assert.deepEqual(await treeInertLines("# note\n\nX = 1\n", "python", Infinity), [false, true, false, true]);
  } finally {
    Tree.prototype.walk = walk;
  }
});

/** A deadline that is not due while the file is parsed and is due from the moment its tree is walked. */
function dueOnceWalked(t) {
  const walk = Tree.prototype.walk;
  let walking = false;
  Tree.prototype.walk = function () {
    walking = true;
    return walk.call(this);
  };
  t.after(() => {
    Tree.prototype.walk = walk;
  });
  return { valueOf: () => (walking ? -Infinity : Infinity) };
}

test("a walk that runs past the deadline asks about every non-blank line of that file", async (t) => {
  const source = "# note\n\n".repeat(5000);
  assert.deepEqual(await treeInertLines(source, "python", Infinity), source.split("\n").map(() => true), "read in time, every line is inert");
  const inert = await treeInertLines(source, "python", dueOnceWalked(t));
  assert.deepEqual(inert, source.split("\n").map((line) => line === ""));
});

test("the deadline holds inside one binding, however many names its type holds", async (t) => {
  const source = `package m\n\nvar x T[\n${"\tint,\n".repeat(20000)}] = nil\n`;
  assert.equal((await treeInertLines(source, "go", Infinity)).every(Boolean), true, "read in time, every line is inert");
  const inert = await treeInertLines(source, "go", dueOnceWalked(t));
  assert.deepEqual(inert.filter(Boolean).length, 2, "only the two blank lines");
});

test("a file of nested bindings the walk cannot finish in time asks about every non-blank line, and the call returns", async (t) => {
  const source = `# note\n${"a = ".repeat(4000)}f()\n`;
  assert.deepEqual(await treeInertLines(source, "python", dueOnceWalked(t)), [false, false, true]);
});

/** How often the walk of a file reads the clock: once in 4,096 nodes it reads or searches. */
async function clockReads(t, source, lang) {
  const walk = Tree.prototype.walk;
  t.after(() => {
    Tree.prototype.walk = walk;
  });
  let reads = 0;
  let walking = false;
  Tree.prototype.walk = function () {
    walking = true;
    return walk.call(this);
  };
  await treeInertLines(source, lang, { valueOf: () => (walking && reads++, Infinity) });
  Tree.prototype.walk = walk;
  return reads;
}

/** What one file's walk asks the tree for past the nodes it steps over: the nodes its subtree searches read, and the parents it asks for. */
async function treeReads(t, source, lang) {
  const search = Node.prototype.descendantsOfType;
  const parent = Object.getOwnPropertyDescriptor(Node.prototype, "parent");
  const restore = () => {
    Node.prototype.descendantsOfType = search;
    Object.defineProperty(Node.prototype, "parent", parent);
  };
  t.after(restore);
  const reads = { searched: 0, parents: 0 };
  Node.prototype.descendantsOfType = function (...args) {
    reads.searched += this.descendantCount;
    return search.apply(this, args);
  };
  Object.defineProperty(Node.prototype, "parent", {
    configurable: true,
    get() {
      reads.parents++;
      return parent.get.call(this);
    },
  });
  await treeInertLines(source, lang, Infinity);
  restore();
  return reads;
}

test("the walk searches a file of nested bindings once, however deep they nest", async (t) => {
  // Searched once per binding, each for what it holds, 4,000 chained assignments are 24 million nodes read.
  for (const [lang, chained] of [
    ["python", (n) => `${"a = ".repeat(n)}f()\n`],
    ["php", (n) => `<?php\n${"$a = ".repeat(n)}f();\n`],
    ["kotlin", (n) => `${"val a = run {\n".repeat(n)}1\n${"}\n".repeat(n)}`],
  ]) {
    const [small, large] = [await treeReads(t, chained(1000), lang), await treeReads(t, chained(2000), lang)];
    assert.ok(small.searched > 0 && small.searched <= 1000 * 16 && large.searched <= small.searched * 2 + 16, `${lang}: ${small.searched} nodes searched at 1,000 and ${large.searched} at 2,000`);
    assert.equal(large.parents, 0, lang);
  }
});

test("the walk asks the tree for no parent, which the tree answers by reading down from its root", async (t) => {
  const nested = `class A {\n    void M() {\n${"{ Money a = 5; int b = 1;\n".repeat(200)}${"}\n".repeat(200)}    }\n}\n`;
  assert.equal((await treeReads(t, nested, "csharp")).parents, 0);
});

test("a search of a subtree larger than the clock's interval starts only after the clock is read", async (t) => {
  const search = Node.prototype.descendantsOfType;
  t.after(() => {
    Node.prototype.descendantsOfType = search;
  });
  let searches = 0;
  Node.prototype.descendantsOfType = function (...args) {
    searches++;
    return search.apply(this, args);
  };
  const source = `@d\ndef f():\n    pass\n${"X = 1\n".repeat(2000)}`;
  assert.equal((await treeInertLines(source, "python", dueOnceWalked(t))).filter(Boolean).length, 1, "only the blank last line");
  assert.equal(searches, 0);
});

test("a failure before the walk still deletes the tree", () => {
  // A language's rules are built on its first file and kept, so the failure needs a process that has read none.
  const lib = (name) => JSON.stringify(new URL(`../plugins/anatomiya/lib/${name}.mjs`, import.meta.url).href);
  const script = `
    import { Tree } from ${JSON.stringify(import.meta.resolve("web-tree-sitter"))};
    import { SHAPES } from ${lib("tree-shapes")};
    import { treeInertLines } from ${lib("inert-tree")};
    const remove = Tree.prototype.delete;
    let deleted = 0;
    Tree.prototype.delete = function () {
      deleted++;
      return remove.call(this);
    };
    SHAPES.kotlin = null;
    process.stdout.write(JSON.stringify({ inert: await treeInertLines("val x = 1\\n", "kotlin", Infinity), deleted }));
  `;

  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 60_000 });

  assert.equal(run.stderr, "");
  assert.deepEqual(JSON.parse(run.stdout), { inert: [false, true], deleted: 1 });
});

test("every sample file is read, and its imports and comments ask nothing", async () => {
  for (const [lang, source] of Object.entries(SAMPLES)) {
    const inert = await treeInertLines(source, lang, Infinity);
    assert.equal(inert.length, source.split("\n").length, lang);
    const lines = source.split("\n");
    for (const [i, line] of lines.entries()) {
      if (/^(?:import |use |\/\/ |# |package )/.test(line)) assert.equal(inert[i], true, `${lang}:${i + 1} ${line}`);
      if (/^(?:def |fun |func |pub fn |fn )/.test(line.trim())) assert.equal(inert[i], false, `${lang}:${i + 1} ${line}`);
    }
  }
});

/**
 * The lines of a file that ask, numbered from one. Each line is also put to the
 * measurement's oracle as a hunk of its own, so a list the rule gains and the
 * oracle lacks fails here: the oracle names nothing on a line the rule leaves
 * out, and something on every line that asks. `unproven` holds the lines the
 * rule asks about without the oracle naming them: a keyword or a bracket that
 * may open a callable, and a shape no list names.
 */
async function asking(lang, source, unproven = []) {
  const inert = await treeInertLines(source, lang, Infinity);
  const parsed = await parseForLines(source, lang, { cancel: never });
  const apart = [];
  try {
    for (const [i, line] of source.split("\n").entries()) {
      const named = oracleHits(parsed.tree, lang, [[i + 1, i + 1]]).map((hit) => hit.type);
      const silent = inert[i] || unproven.includes(i + 1);
      if (silent && named.length > 0) apart.push(`${i + 1} ${inert[i] ? "left out" : "listed as unproven"}, and the oracle names ${named.join(", ")}: ${line}`);
      if (!silent && named.length === 0) apart.push(`${i + 1} asks, and the oracle names nothing: ${line}`);
    }
  } finally {
    parsed.tree.delete();
  }
  assert.deepEqual(apart, [], `${lang}: the rule and the oracle apart`);
  return inert.flatMap((quiet, i) => (quiet ? [] : [i + 1]));
}

test("a Python or PHP assignment binds where every target is a plain name, and a write through an attribute, a subscript or a property asks", async () => {
  // A setter, __setattr__, __setitem__, __set or offsetSet may stand behind the write.
  const python = ["x = 1", "x: int = 1", "a, b = 1, 2", "[a, b] = 1, 2", "(a, b) = (1, 2)", "*c, d = 1, 2", "a, (b, c) = 1, (2, 3)", "a.b = 1", "self.x = 0", 'CONFIG["k"] = 1', "a[0] = 1", "a[i] = 1", "a[-1] = 1", "b.c[i] = 1", "a.b: int = 1", "a.b, c = 1, 2", "[a[0], b] = 1, 2", "*a.b, c = 1, 2", "cache[compute()] = 1", "f().attr = 1", 'a[f"{g()}"] = 1', ""];
  assert.deepEqual(await asking("python", python.join("\n")), [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
  const php = [
    "<?php",
    "$x = 1;",
    "[$a, $b] = [1, 2];",
    "list($a, $b) = [1, 2];",
    "[, [$a, $b]] = [1, [2, 3]];",
    "const A = 1;",
    "class C {",
    "    public $x = 1;",
    "    public int $y = 1;",
    "}",
    "$a->b = 1;",
    "$this->x = 1;",
    "$a['k'] = 1;",
    "$a[] = 1;",
    "self::$x = 1;",
    "Foo::$x = 1;",
    "$a[$i] = 1;",
    "$$x = 1;",
    "${'a'} = 1;",
    "[$a->b, $c] = [1, 2];",
    "[$a[0], $c] = [1, 2];",
    // A keyed pattern binds names too: a false ask, since the key is no name.
    "['k' => $a] = [1];",
    "$a[foo()] = 1;",
    "foo()::$x = 1;",
    "",
  ];
  assert.deepEqual(await asking("php", php.join("\n")), [7, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
});

test("a Python annotation that is a plain type expression asks nothing, and one holding a call or a lambda asks", async () => {
  const source = 'x: int = 3\nx: list[int] = []\nx: a.B | None = None\nx: Callable[[int], str] = None\nx: tuple[int, ...] = ()\nx: "Order" = None\nx: f() = 3\nx: (lambda: 1) = 3\nx: Dict[str, g()] = {}\n';
  assert.deepEqual(await asking("python", source), [7, 8, 9]);
});

test("a Go constant with no value or counted off iota asks nothing, and one holding a call or another name asks", async () => {
  const source = "package m\n\nconst (\n\tA = iota\n\tB\n\tC Color = 1 << iota\n\tD, E = iota, (iota + 1) * 2\n\tF = -iota\n\tG = len(x)\n\tH = other\n\tI = Color(1)\n\tJ = iota + other\n)\n\nvar v int\nvar w = 1 << 2\n";
  // The line that opens the group asks with it: the group is read whole only where every constant in it asks nothing.
  assert.deepEqual(await asking("go", source, [3]), [3, 9, 10, 11, 12, 15, 16]);
  assert.deepEqual(await asking("go", "package m\n\nconst (\n\tA = iota\n\tB\n\tC Color = 1 << iota\n)\n"), []);
});

test("a PHP string that interpolates through ${...} is no literal in a value, and a write through a subscript or a property asks whatever its string holds", async () => {
  const source = ['<?php', '$a["${foo()}"] = 1;', 'self::$x["${foo()}"] = 1;', '$a->{"${foo()}"} = 1;', '$a["{${foo()}}"] = 1;', '$x = "${foo()}";', '$x = "{${foo()}}";', '$x = "plain\\n";', '$a["k"] = 1;', ""].join("\n");
  assert.deepEqual(await asking("php", source), [2, 3, 4, 5, 6, 7, 9]);
});

test("a Rust binding whose type or pattern holds a call, a macro or a block asks, and one made of names and literals asks nothing", async () => {
  const items = [
    "const A: [u8; f()] = [0; 3];",
    "static B: [u8; f()] = [0, 1];",
    "const C: Foo<{ f() }> = 1;",
    "const E: [u8; { g() }] = [0];",
    "const G: [u8; size_of::<T>()] = [0; 4];",
    "const D: t!() = 1;",
    "const I: [u8; m!(3)] = [0];",
    "const J: [[u8; f()]; 2] = [1, 2];",
    'const K: &[u8; f()] = "a";',
    "const L: (u8, [u8; f()]) = (1, 2);",
    "const M: fn([u8; f()]) = 1;",
    "const N: [u8; 3] = [0; 3];",
    "static O: [[u8; LEN]; 2] = [1, 2];",
    'pub(crate) const P: &\'static str = "a";',
    "const Q: (u8, Option<std::num::NonZeroU8>) = (1, 2);",
    "static mut R: *const u8 = 0;",
  ];
  assert.deepEqual(await asking("rust", `${items.join("\n")}\n`), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const locals = ["fn h() {", "    let x: [u8; f()] = [0; 3];", "    let x: Vec<[u8; f()]> = 1;", "    let p!() = 1;", "    let const { f() } = 1;", "    let y: [u8; 3] = [0; 3];", "    let z: Vec<[u8; 3]> = 1;", "    let (a, b) = (1, 2);", '    let mut c = "s";', "}"];
  assert.deepEqual(await asking("rust", `${locals.join("\n")}\n`), [1, 2, 3, 4, 5]);
});

test("a Go binding whose type holds a call asks, in its own type and in the type of a composite literal", async () => {
  const source = [
    "package m",
    "var x = [size()]int{0}",
    "var y [size()]int = [1]int{0}",
    "var z = map[string][f()]int{}",
    "var o = map[[f()]int]string{}",
    "var n = [][f()]int{{1}}",
    "var w = struct{ a [f()]int }{}",
    "const M = [f()]int{}",
    "const N [f()]int = 1",
    "const X = struct{ a [f()]int }{}",
    "var a = [3]int{0}",
    "var b [3]int = [1]int{0}",
    "var c = map[string][]int{}",
    "var d = map[[2]int]string{}",
    "var e = [][size]*pkg.T{{1}}",
    'var g = [...]string{"a"}',
    'var h = map[string]interface{}{"a": 1}',
    "var i = struct{ a int }{}",
    'const K Kind = "x"',
    "",
  ].join("\n");
  assert.deepEqual(await asking("go", source), [2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("a Go constant converted from iota asks, and a bare one under a call asks nothing on its own line", async () => {
  assert.deepEqual(await asking("go", "package m\n\nconst (\n\tA = T(iota)\n\tB\n)\n\nconst (\n\tC = f()\n\tD\n)\n", [3, 8]), [3, 4, 8, 9]);
});

test("a C# declaration with a call in its array rank asks, as a field and as a local", async () => {
  const source = ["class A {", "    int[F()] e = null;", "    int[F(), 2] q = null;", "    int[3] r = null;", "    private static readonly System.Collections.Generic.List<string?> s = null;", "    void M() {", "        int[G()] u = null;", "        int[3] v = null;", '        var w = "x";', "    }", "}", ""].join("\n");
  assert.deepEqual(await asking("csharp", source), [1, 2, 3, 6, 7]);
});

test("a Kotlin accessor asks on the line that opens it, and a property with none asks nothing", async () => {
  const source = ["class A {", "    val d: Int = 1", "        get() {", "            return h()", "        }", "    val e: Int = 1", '    var f: String = "a"', "        set(value) {", "            field = value", "        }", "    private val g: Map<String, Int?>? = null", "}", ""].join("\n");
  assert.deepEqual(await asking("kotlin", source, [9]), [1, 2, 3, 4, 7, 8, 9]);
});

test("a line that holds a keyword or an opening bracket and no name asks, since it may open a callable", async () => {
  assert.deepEqual(await asking("go", "package m\n\nfunc f() {\n\tgo func() {\n\t}()\n}\n"), [3, 4, 5]);
  assert.deepEqual(await asking("php", "<?php\nfoo(\n    function () {\n        return 1;\n    }\n);\n", [4]), [2, 3, 4]);
  assert.deepEqual(await asking("csharp", "class A {\n    int X {\n        get {\n            return 1;\n        }\n    }\n}\n", [2, 4]), [1, 2, 3, 4]);
  assert.deepEqual(await asking("kotlin", "val f = run(\n    {\n        1\n    }\n)\n"), [1, 2, 3]);
});

test("a PHP assignment that is an argument asks, where one that is a statement of its own asks nothing", async () => {
  const source = ["<?php", "foo(", "    $a = 1", ");", "$o->run(", "    [$b, $c] = [1, 2],", ");", "$a = 1;", "[$b, $c] = [1, 2];", "if ($b = 1) {", "}", "foo(", "    $a['k'] = 1", ");", ""].join("\n");
  assert.deepEqual(await asking("php", source, [10, 11]), [2, 3, 5, 6, 10, 11, 12, 13]);
});

test("a Python annotation joined by anything but | asks", async () => {
  assert.deepEqual(await asking("python", "x: a | b = 1\nx: a + b = 1\nx: a | b + c = 1\n"), [2, 3]);
});

test("a string made of its own text is a literal however it is quoted, and a character is one too", async () => {
  assert.deepEqual(await asking("python", 'A = f"{{}}"\nB = b"\\x00"\nC = f"{{{x}}}"\n'), [3]);
  assert.deepEqual(await asking("php", "<?php\nconst A = <<<'T'\nplain\nT;\nconst B = \"a\\n\";\n"), []);
  assert.deepEqual(await asking("csharp", "class A {\n    char a = 'x';\n    char b = '\\n';\n    string c = \"\"\"\n        raw\n        \"\"\";\n}\n"), [1]);
  assert.deepEqual(await asking("java", 'class A {\n    char a = \'x\';\n    String b = """\n        text\\n\n        """;\n}\n'), [1]);
  assert.deepEqual(await asking("kotlin", "val a = 'x'\nval b = '\\n'\nval c = \"\"\"\n    raw\n\"\"\"\n"), []);
  assert.deepEqual(await asking("rust", "const A: char = '\\n';\nconst B: &str = r#\"raw\"#;\nconst C: &[u8] = b\"x\\n\";\n"), []);
  assert.deepEqual(await asking("go", "package m\n\nconst A = '\\n'\nconst B = `raw`\nconst C = \"a\\n\"\n"), []);
});

test("a sign on a literal asks in Kotlin and C# unless the language itself defines the pair", async () => {
  // Either language binds an operator on a built-in type to a user's function where the type has none of its own.
  const kotlin = ['val a = +"a"', 'val b = !"a"', "val c = -'a'", "val d = !1", 'val e = -"""a"""', "val f = -1u", "val g = !null", "val h = -true", 'val i = "a"!!', "val j = - -1", "val k = -/* c */1", "val l = -1", "val m = +1", "val n = -1.5", "val o = !true", "val p = !false", "val q = -0x1F", "val r = -1e-3", ""];
  assert.deepEqual(await asking("kotlin", kotlin.join("\n")), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const csharp = ["class A {", '    string a = -"a";', "    bool b = !1;", "    int c = -null;", "    int d = ~1.5;", "    long e = -1ul;", "    System.Index f = ^1;", "    int g = -1;", "    double h = +1.5e-3;", "    int i = ~0;", "    bool j = !true;", "    int k = -'a';", "    uint l = ~0u;", "}", ""];
  assert.deepEqual(await asking("csharp", csharp.join("\n")), [1, 2, 3, 4, 5, 6, 7]);
});

test("a sign on a literal asks nothing where no user code can stand behind an operator on a built-in type", async () => {
  // Each line is refused by its compiler or raises in its interpreter, and none reaches a function somebody wrote.
  assert.deepEqual(await asking("python", 'A = -"a"\nB = ~"a"\nC = -1\n'), []);
  assert.deepEqual(await asking("php", '<?php\n$a = -"a";\n$b = !"a";\n$c = -1;\n'), []);
  assert.deepEqual(await asking("go", 'package m\n\nvar a = -"a"\nvar b = !1\nvar c = -1\n'), []);
  assert.deepEqual(await asking("java", 'class A {\n    String a = -"a";\n    boolean b = !1;\n    int c = -1;\n}\n'), [1]);
  assert.deepEqual(await asking("rust", 'const A: &str = -"a";\nconst B: u32 = -1u32;\nconst C: i32 = !1;\n'), []);
});

test("a Kotlin number with a fraction or an exponent is a literal", async () => {
  assert.deepEqual(await asking("kotlin", "val r = 2.5\nval s = 1e3\nval t = 1.5f\nval u = -1.0\nval v = f(2.5)\n"), [5]);
});

test("a | joins types in a Python annotation, and a subscript target asks whatever it holds", async () => {
  const source = "a[b | c] = 1\nx[b | c]: int = 1\na[[b | c]] = 1\na.b[c | d].e = 1\na[[b, c]] = 1\nx: a | b = 1\nx: list[a | b] = []\nx: t.Optional[a | b] = None\n";
  assert.deepEqual(await asking("python", source), [1, 2, 3, 4, 5]);
});

test("a C# directive that closes a conditional or a region asks nothing, and one that opens or sets something asks", async () => {
  const source = ["class A {", "#if X", "    int a = 1;", "#elif Y", "    int b = 2;", "#else", "    int c = 3;", "#endif", "#region R", "    int d = 4;", "#endregion", "#endregion R", "#pragma warning disable", "}", ""].join("\n");
  assert.deepEqual(await asking("csharp", source, [9, 13]), [1, 2, 4, 6, 9, 13]);
});

test("a constant asks nothing whatever body holds it", async () => {
  assert.deepEqual(await asking("php", '<?php\nenum En: string {\n    const X = 1;\n    case A = "a";\n}\ninterface I {\n    const Y = 1;\n}\n', [4]), [2, 4, 6]);
  assert.deepEqual(await asking("java", "@interface An {\n    int E = 1;\n}\nrecord R(int x) {\n    static int d = 1;\n}\n"), [1, 4]);
});

test("a C# literal declared as a type spelt as a name asks, since the type may convert it, beside one declared as a predefined type", async () => {
  const source = [
    "class A {",
    "    Money a = 5;",
    "    int b = 5;",
    '    Name n = "x";',
    '    string s = "x";',
    "    Money c = -1;",
    "    int d = -1;",
    "    private static readonly Money F = 5;",
    "    private static readonly int G = 5;",
    // An enum takes 0 by the language's own rule, and nothing here tells an enum from a struct.
    "    MyEnum e = 0;",
    "    Money? h = 5;",
    "    Money[] ms = { 1, 2 };",
    "    System.Int32 q = 5;",
    "    List<int> ws = { 1 };",
    "    dynamic y = 5;",
    "    Money j = 5, k = null;",
    "    Foo f = null;",
    "    int? g = null;",
    "    int[] xs = { 1, 2 };",
    "    List<int> ys = null;",
    "    object o = 5;",
    "    nuint p = 1;",
    "    int? t = 1;",
    "    void M() {",
    "        Money l = 5;",
    "        var v = 1;",
    "        Foo z = null;",
    "        const int K = 1;",
    "    }",
    "}",
    "",
  ].join("\n");
  assert.deepEqual(await asking("csharp", source), [1, 2, 4, 6, 8, 10, 11, 12, 13, 14, 15, 16, 24, 25]);
});

test("a C# const of a named type reads as inert: no user conversion is a constant expression, so the compiler refuses the line where one would run", async () => {
  assert.deepEqual(await asking("csharp", "class A {\n    const Money D = 5;\n    const MyEnum E = 0;\n    void M() {\n        const Money L = 5;\n    }\n}\n"), [1, 4]);
});

test("a sign outside a value asks where it stands before a name, which may define the operator, and asks nothing before a literal", async () => {
  assert.deepEqual(await asking("python", 'x: -b = 1\nx: ~b = 1\nx: t[-b.c] = 1\nx: -1 = 1\nx: t[-"k"] = 1\na[-1] = 1\n'), [1, 2, 3, 6]);
  assert.deepEqual(await asking("go", "package m\n\nvar x [-n]int = [1]int{0}\nvar y [+3]int = [3]int{0}\n"), [3]);
});

test("a union or a generic type made of names and literals asks nothing, and one holding a call asks", async () => {
  const python = "x: Literal['a-b'] | None = None\nx: Literal[f()] | None = None\nx: a | \"b-c\" = 1\nx: Literal['a'] | (b - c) = None\n";
  assert.deepEqual(await asking("python", python), [2, 4]);
  const go = "package m\n\nvar x = struct{ a T[int] }{}\nvar y = struct{ a T[[f()]int] }{}\nvar z pkg.T[int, string] = nil\nvar w = T[int]{}\n";
  assert.deepEqual(await asking("go", go), [4]);
});

test("a declaration with no body asks: a method an interface or a trait names, a foreign function, a property that is an expression", async () => {
  // The line that opens a Go type or a Rust foreign block, and an embedded type, ask as shapes no list names.
  assert.deepEqual(await asking("go", "package m\n\ntype I interface {\n\tM(x int) error\n\tfmt.Stringer\n}\n", [3, 5]), [3, 4, 5]);
  assert.deepEqual(await asking("rust", 'trait T {\n    fn m(&self) -> u8;\n}\nextern "C" {\n    fn ext(x: i32) -> i32;\n}\n', [4]), [1, 2, 4, 5]);
  assert.deepEqual(await asking("csharp", "class A {\n    int P => 1;\n    int Q { get; } = 1;\n    int this[int i] => 1;\n}\n"), [1, 2, 3, 4]);
});

test("a C# enum member asks though it computes nothing: no list names it, and a false ask is the cost", async () => {
  assert.deepEqual(await asking("csharp", "enum E {\n    A,\n    B = 2,\n}\n", [1, 2, 3]), [1, 2, 3]);
});

test("a literal declared as a named type asks nothing where the language converts none with a function somebody wrote", async () => {
  // Python checks no annotation, Go converts an untyped constant itself, and the other four refuse the line.
  assert.deepEqual(await asking("python", "x: Money = 5\n"), []);
  assert.deepEqual(await asking("php", "<?php\nclass A {\n    public Money $a = 5;\n}\n"), [2]);
  assert.deepEqual(await asking("go", "package m\n\nvar a Money = 5\n"), []);
  assert.deepEqual(await asking("java", "class A {\n    Money a = 5;\n}\n"), [1]);
  assert.deepEqual(await asking("rust", "const A: Money = 5;\nfn f() {\n    let a: Money = 5;\n}\n"), [2]);
  assert.deepEqual(await asking("kotlin", "val a: Money = 5\n"), []);
});

test("an annotation asks for the declaration it stands on, and not for the one that ends where it starts", async () => {
  assert.deepEqual(await asking("java", "class A {\n    int a =\n        1;@Inject\n    Foo b = null;\n}\n", [4]), [1, 3, 4]);
});

test("a string spread over lines asks on every row where it is an argument, whatever it holds, and on none where a name is bound to it", async () => {
  // A row of text holds no token of its own where an escape splits the text around it.
  assert.deepEqual(await asking("python", 'foo("""\nline \\n\nplain text line\nexec_me()\n""")\n'), [1, 2, 3, 4, 5]);
  assert.deepEqual(await asking("python", 'foo("""\nline\nplain text line\nexec_me()\n""")\n'), [1, 2, 3, 4, 5]);
  assert.deepEqual(await asking("python", 'X = """\nline \\n\nplain\n"""\n'), []);
  assert.deepEqual(await asking("go", "package m\n\nvar x = run(`\na\nb\n`)\nconst B = `\na\nb\n`\n"), [3, 4, 5, 6]);
  // The line that closes a call is a closing bracket alone.
  assert.deepEqual(await asking("php", "<?php\nrun(<<<T\na\\n\nb\nT\n);\nrun(<<<'T'\na\nb\nT\n);\nconst A = <<<'T'\na\nb\nT;\n"), [2, 3, 4, 5, 7, 8, 9, 10]);
  assert.deepEqual(await asking("java", 'class A {\n    Object x = run("""\n        a\\n\n        b\n        """);\n    String y = """\n        a\\n\n        b\n        """;\n}\n'), [1, 2, 3, 4, 5]);
  const csharp = 'class A {\n    object x = Run(@"\na\nb\n");\n    object y = Run("""\n        a\n        b\n        """);\n    string z = @"\na\nb\n";\n    string w = """\n        a\n        b\n        """;\n}\n';
  assert.deepEqual(await asking("csharp", csharp), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(await asking("rust", 'fn f() {\n    run(r#"\na\nb\n"#);\n    run("\na\\n\nb\n");\n}\nconst B: &str = r#"\na\nb\n"#;\nconst C: &str = "\na\\n\nb\n";\n'), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(await asking("kotlin", 'val x = run("""\n    a\n    b\n""")\nval c = """\n    a\n    b\n"""\n'), [1, 2, 3, 4]);
});

test("a Go comment directly above an import of C asks, since cgo compiles it, and a comment above any other import asks nothing", async () => {
  const block = 'package m\n\n/*\nstatic int add(int a, int b) { return a+b; }\n*/\nimport "C"\n\n// Printing.\nimport "fmt"\n';
  assert.deepEqual(await asking("go", block), [3, 4, 5]);
  const lines = 'package m\n\n// A note, a line away.\n\n// #include <stdio.h>\n// static int one() { return 1; }\nimport "C"\n';
  assert.deepEqual(await asking("go", lines), [5, 6]);
  // A comment with a line or another import between it and the import of C is no part of what cgo compiles.
  assert.deepEqual(await asking("go", 'package m\n\n// A line away.\n\nimport "C"\n\n/* Printing. */ import "fmt"\nimport "C"\n\nimport (\n\t// Printing.\n\t"fmt"\n)\n'), []);
  // In a group the comment on the import itself is the one cgo reads, and the one above the group is not.
  const group = 'package m\n\n// Above the group.\nimport (\n\t// static int two() { return 2; }\n\t"C"\n)\n\n// static int three() { return 3; }\nimport (\n\t"C"\n)\n\n// Above two.\nimport (\n\t"C"\n\t"fmt"\n)\n';
  // The group that is read inside asks where it opens and on the import, which is the cost of reading it.
  assert.deepEqual(await asking("go", group, [4, 6]), [4, 5, 6, 9]);
});

test("PHP inline markup that holds a script asks, in any letter case, and markup with none asks nothing", async () => {
  const source = '<p>plain</p>\n<?php\n$a = 1;\n?>\n<script>function dup() {}</script>\n<?php\n$b = 2;\n?>\n<p>plain</p>\n<?php $c = 3; ?>\n<SCRIPT type="module">\nfunction two() {}\n</SCRIPT>\n';
  assert.deepEqual(await asking("php", source), [5, 11, 12, 13]);
});
