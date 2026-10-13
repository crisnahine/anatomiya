import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { INERT_ENGINES, inertLinesOf, REUSE_PARSE_MS } from "../plugins/anatomiya/lib/inert.mjs";
import { engineOf, LANGUAGES } from "../plugins/anatomiya/lib/langs.mjs";

/** The lines of a file that may define something callable, numbered from one. */
async function asking(lang, source, options = {}) {
  const inert = await inertLinesOf({ engine: engineOf(lang), lang, source, deadline: Infinity, ...options });
  assert.ok(Array.isArray(inert), `${lang}: no rule answered`);
  return inert.flatMap((quiet, i) => (quiet ? [] : [i + 1]));
}

// Per language: what asks nothing, and what asks on which lines. A line that
// opens a class or a function asks wherever it stands, since the line rule
// reads the file and not the hunk.
const CASES = {
  python: {
    quiet: {
      comment: "# Totals.\n",
      import: "import os\nfrom typing import List as L\n",
      constant: 'LIMIT = 3\nNAMES = ["a", ("b", None)]\nRATE: float = -0.5\nTABLE = {\n    "a": 1,\n    "b": [True, False],\n}\n',
      docstring: '"""Totals.\n\nMore of them.\n"""\n',
    },
    asked: {
      function: ["def total(xs):\n    return sum(xs)\n", [1, 2]],
      method: ["class A:\n    def m(self):\n        return 1\n", [1, 2, 3]],
      lambda: ["double = lambda x: x * 2\n", [1]],
      call: ["LIMIT = compute()\n", [1]],
      interpolated: ['NAME = f"{user}"\n', [1]],
      unvalued: ["LIMIT: int\n", [1]],
      negated: ["LIMIT = -other\n", [1]],
      "call in a subscript target": ["cache[compute()] = 1\n", [1]],
      "call in an attribute target": ["f().attr = 1\n", [1]],
    },
  },
  php: {
    quiet: {
      comment: "<?php\n// Totals.\n/* More. */\n",
      import: "<?php\nuse App\\Models\\Order;\nuse App\\Models\\Invoice as Bill;\n",
      constant: "<?php\nconst LIMIT = 3;\n$names = ['a', 'b' => -1, \"c\"];\n",
    },
    asked: {
      function: ["<?php\nfunction total($xs) {\n    return array_sum($xs);\n}\n", [2, 3]],
      method: ["<?php\nclass A {\n    public function m() {\n        return 1;\n    }\n}\n", [2, 3, 4]],
      lambda: ["<?php\n$double = fn($x) => $x * 2;\n", [2]],
      call: ["<?php\n$limit = compute();\n", [2]],
      interpolated: ['<?php\n$name = "hi $user";\n', [2]],
      annotated: ["<?php\nclass A {\n    #[Inject]\n    private $x = null;\n}\n", [2, 3, 4]],
      "call in a subscript target": ["<?php\n$a[foo()] = 1;\n", [2]],
      "property hook": ["<?php\nclass A {\n    public string $x = 'a' {\n        get => strtoupper($this->x);\n    }\n}\n", [2, 3, 4]],
    },
  },
  go: {
    quiet: {
      comment: "// Totals.\n/* More. */\n",
      import: 'import (\n\t"fmt"\n\t"os"\n)\n',
      constant: 'const Limit = 3\nconst (\n\tA = "a"\n\tB = -1\n)\nvar names = []string{"a", "b"}\n',
      package: "package billing\n",
    },
    asked: {
      function: ["func Total() int {\n\treturn 0\n}\n", [1, 2]],
      method: ["func (o Order) Total() int {\n\treturn 0\n}\n", [1, 2]],
      lambda: ["var double = func(x int) int { return x * 2 }\n", [1]],
      call: ["var limit = compute()\n", [1]],
    },
  },
  java: {
    quiet: {
      comment: "// Totals.\n/* More. */\n",
      import: "import java.util.List;\nimport java.io.*;\n",
      constant: 'class A {\n    private static final String USAGE = "u";\n    static final int[] SIZES = {1, -2};\n}\n',
      package: "package com.example.billing;\n",
    },
    asked: {
      method: ["class A {\n    int total() {\n        return 0;\n    }\n}\n", [1, 2, 3]],
      lambda: ["class A {\n    Runnable r = () -> {};\n}\n", [1, 2]],
      call: ["class A {\n    int limit = compute();\n}\n", [1, 2]],
      annotated: ["class A {\n    @Inject\n    private Foo foo = null;\n}\n", [1, 2, 3]],
      "annotated package": ["@NullMarked\npackage com.example;\n", [1, 2]],
    },
  },
  csharp: {
    quiet: {
      comment: "// Totals.\n/* More. */\n",
      import: "using System;\nusing Text = System.Text;\n",
      constant: 'class A\n{\n    private const string Usage = "u";\n    static readonly int[] Sizes = {1, -2};\n}\n',
    },
    asked: {
      method: ["class A\n{\n    int Total()\n    {\n        return 0;\n    }\n}\n", [1, 2, 3, 4, 5]],
      lambda: ["class A\n{\n    Func<int, int> Double = x => x * 2;\n}\n", [1, 2, 3]],
      call: ["class A\n{\n    int Limit = Compute();\n}\n", [1, 2, 3]],
      interpolated: ['class A\n{\n    string Name = $"hi {user}";\n}\n', [1, 2, 3]],
      annotated: ["class A\n{\n    [Obsolete]\n    public int X = 1;\n}\n", [1, 2, 3, 4]],
    },
  },
  rust: {
    quiet: {
      comment: "// Totals.\n/* More. */\n",
      import: "use std::fmt;\nuse std::io as stdio;\n",
      constant: 'const LIMIT: i64 = -3;\npub static NAME: &str = "n";\nconst SIZES: [i32; 2] = [1, 2];\n',
    },
    asked: {
      function: ["fn total() -> i64 {\n    0\n}\n", [1, 2]],
      method: ["impl Order {\n    fn total(&self) -> i64 {\n        0\n    }\n}\n", [1, 2, 3]],
      lambda: ["const DOUBLE: fn(i32) -> i32 = |x| x * 2;\n", [1]],
      call: ["const LIMIT: usize = compute();\n", [1]],
      annotated: ["#[allow(dead_code)]\nconst X: i32 = 1;\n", [1]],
      "let-else": ["fn f() {\n    let y = 1 else { panic!() };\n}\n", [1, 2]],
    },
  },
  kotlin: {
    quiet: {
      comment: "// Totals.\n/* More. */\n",
      import: "import java.io.IOException\nimport kotlin.math.max as larger\n",
      constant: 'const val LIMIT = 3\nval FLAG = true\nval NONE: String? = null\nval NAME = "n"\n',
      package: "package com.example.billing\n",
    },
    asked: {
      function: ["fun total(): Int {\n    return 0\n}\n", [1, 2]],
      method: ["class A {\n    fun m(): Int {\n        return 1\n    }\n}\n", [1, 2, 3]],
      lambda: ["val double = { x: Int -> x * 2 }\n", [1]],
      call: ["val limit = compute()\n", [1]],
      interpolated: ['val a = "hi ${user}"\n', [1]],
      // The grammar reads `$user` in a one-line string as plain text.
      bare: ['val a = "hi $user"\n', [1]],
      named: ["val a = other\n", [1]],
      annotated: ["@JvmField val x = 1\n", [1]],
    },
  },
};

test("every engine a language routes to has a rule", () => {
  assert.deepEqual(INERT_ENGINES.toSorted(), ["oxc", "prism", "tree-sitter"]);
  for (const lang of LANGUAGES) assert.ok(INERT_ENGINES.includes(lang.engine), lang.id);
});

test("the parse budget is one second for the whole stop", () => {
  assert.equal(REUSE_PARSE_MS, 1000);
});

for (const [lang, { quiet, asked }] of Object.entries(CASES)) {
  test(`${lang}: a comment, an import, a constant or a package line added asks nothing`, async () => {
    for (const [what, source] of Object.entries(quiet)) {
      const lines = await asking(lang, source);
      // A class around a constant asks on the lines that open it, a brace on a line of its own among
      // them: a brace may open a lambda, and only a closing one is known to open nothing.
      const opener = what === "constant" && /^class /.test(source) ? (source.split("\n")[1] === "{" ? [1, 2] : [1]) : [];
      assert.deepEqual(lines, opener, `${lang} ${what}`);
    }
  });

  test(`${lang}: a function, a method, a lambda bound to a name, a value bound to a call, an interpolated string or an annotated field is asked`, async () => {
    for (const [what, [source, lines]] of Object.entries(asked)) {
      assert.deepEqual(await asking(lang, source), lines, `${lang} ${what}`);
    }
  });
}

test("a name bound to a literal asks nothing and a write through an attribute chain asks, in Python and PHP", async () => {
  assert.deepEqual(await asking("python", "a = 1\na.b.c = 1\n"), [2]);
  assert.deepEqual(await asking("php", "<?php\n$b = 1;\n$b->c = 1;\n"), [3]);
});

test("a declaration with modifiers and a type around a literal binding asks nothing", async () => {
  const php = "<?php\nclass A {\n    public static ?int $y = 1;\n    final public const int Z = 1;\n    var $v = 2;\n}\n";
  assert.deepEqual(await asking("php", php), [2]);
});

test("a throw out of the parse asks about every non-blank line of that file", async () => {
  // Thrown past here it would reach the hook's boundary, which answers {} for the whole stop. The walk's
  // own throw is pinned in the adapter's tests.
  const deadline = { valueOf() { throw new RangeError("trap"); } };
  assert.deepEqual(await asking("python", "# note\n\nX = 1\n", { deadline }), [1, 3]);
});

test("a Python docstring asks nothing, and a string that interpolates does", async () => {
  assert.deepEqual(await asking("python", 'def f():\n    """Say what f does."""\n'), [1]);
  assert.deepEqual(await asking("python", 'def f():\n    f"{x}"\n'), [1, 2]);
});

test("a file the grammar rejects asks about every added line", async () => {
  assert.deepEqual(await asking("python", "# fine\nLIMIT = 3\ndef (:\n"), [1, 2, 3]);
  assert.deepEqual(await asking("go", "package m\nconst A = \n"), [1, 2]);
});

test("a line past the length the rule reads asks", async () => {
  const long = `NAMES = [${Array.from({ length: 100 }, (_, i) => `"n${i}"`).join(", ")}]\n`;
  assert.ok(long.length > 400);
  assert.deepEqual(await asking("python", `LIMIT = 3\n${long}`), [2]);
});

test("a string spread over lines in a call asks on every line it covers", async () => {
  assert.deepEqual(await asking("python", 'X = run("""\na\n""")\n'), [1, 2, 3]);
});

test("a missing grammar skips the file", async (t) => {
  const empty = mkdtempSync(join(tmpdir(), "anatomiya-inert-"));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  assert.equal(await inertLinesOf({ engine: "tree-sitter", lang: "python", source: "X = 1\n", deadline: Infinity, grammars: empty }), null);
});

test("an engine with no rule skips the file", async () => {
  assert.equal(await inertLinesOf({ engine: "none", lang: "python", source: "X = 1\n", deadline: Infinity }), null);
});

test("a parse past REUSE_PARSE_MS asks", async () => {
  // The deadline is the whole stop's, so a file reached after it is not read at all.
  assert.deepEqual(await asking("python", "# note\nX = 1\n", { deadline: performance.now() - 1 }), [1, 2]);
});

test("the line rules of oxc and prism answer through the same seam", async () => {
  assert.deepEqual(await asking("js", "// note\nexport const A = 1;\nexport function f() {}\n"), [3]);
  assert.deepEqual(await asking("ruby", "# note\nA = 1\ndef f; end\n"), [3]);
});

test("a regex literal holding /* opens no comment, so the lines after it ask", async () => {
  assert.deepEqual(await asking("js", "const trailing = /\\/*$/;\nexport function duplicate(a, b) {\n  return a + b;\n}\n/** doc */\nfunction after() {}\n"), [1, 2, 3, 6]);
  assert.deepEqual(await asking("js", 'p.replace(/^\\/*/, "");\nfunction f() {}\n'), [1, 2]);
});

test("a block comment opens only at the start of its line, and one opened after code asks on every line it runs over", async () => {
  assert.deepEqual(await asking("js", "  /* note\nfunction old() {}\n*/\nconst A = 1; /* closed */\n/* a */ /* b\nfunction older() {}\n*/\n"), []);
  // Nothing tells a comment opened after code from a regex, so its later lines are read as code.
  assert.deepEqual(await asking("js", "const a = 1; /* note\nfunction f() {}\n*/\nfunction g() {}\n"), [1, 2, 3, 4]);
});

test("a JSX comment spread over lines asks nothing through its end, and the line after it asks", async () => {
  assert.deepEqual(await asking("js", "<div>\n  {/* note\n  function old() {}\n  */}\n  <span />\n</div>\n"), [1, 5, 6]);
  assert.deepEqual(await asking("js", " { /* a\nb\n*/ }\nfunction g() {}\n"), [4]);
  // Code after the brace that ends it asks, and so does a second brace before it.
  assert.deepEqual(await asking("js", "{/* a\n*/} run();\n"), [2]);
  assert.deepEqual(await asking("js", "{{/* a\nfunction f() {}\n*/}}\n"), [1, 2, 3]);
  // The closing brace ends the literal it stands in, so the line after is no member of it.
  assert.deepEqual(await asking("js", "const A = {\n  a: 1,\n  /* note\n  */ }\nb: 1,\n"), [5]);
});

test("a regex holding /* after a brace opens no comment", async () => {
  assert.deepEqual(await asking("js", "{ /\\/*$/.test(x) }\nfunction f() {}\n/** doc */\nfunction g() {}\n"), [1, 2, 4]);
});

test("a line comment that holds the end of a block comment asks", async () => {
  // The comment opened after code carries no state, so the code after its end stands on a line read as a comment.
  assert.deepEqual(await asking("js", "foo(); /* a\n// b */ function f() {}\n// plain\n"), [1, 2]);
  assert.deepEqual(await asking("js", "foo(); /* a\nconst B = 1; // b */ function f() {}\nconst C = 1; // plain\n"), [1, 2]);
});

test("a Ruby comment line that holds an interpolation asks, since a literal spread over lines may hold it", async () => {
  // Inside a heredoc, an extended regex and a percent list the line is no comment and the interpolation runs.
  assert.deepEqual(await asking("ruby", "# note\nA = <<~SQL\n#{run}\n# text #{run}\nSQL\n# after\n"), [2, 3, 4, 5]);
  assert.deepEqual(await asking("ruby", "# note\nH = /a\n#{run}\n# text #{run}\n# plain\nb/x\n"), [2, 3, 4, 6]);
  assert.deepEqual(await asking("ruby", "# note\nW = %W[\n#{run}\n# text #{run}\nplain\n]\n# after\n"), [2, 3, 4, 5]);
  assert.deepEqual(await asking("ruby", "A = 1 # the #{name} form\nB = 2 # plain\n"), [1]);
});

test("a run of spaces costs a line rule no more than one space does", async () => {
  // 300 lines of each: the import, the re-export and the typed binding, cut short after a run as long as a line may be.
  const run = " ".repeat(392);
  for (const [lang, line] of [["js", `import${run}b`], ["js", `export${run}b`], ["js", `const a:${run}b`], ["ruby", `require${run}b`]]) {
    const started = performance.now();
    assert.equal((await asking(lang, `${line}\n`.repeat(300))).length, 300, line.slice(0, 8));
    const took = performance.now() - started;
    assert.ok(took < 1000, `${line.slice(0, 8)}: ${Math.round(took)} ms for 300 lines`);
  }
});

test("a run of spaces or tabs reads as the one it stands for", async () => {
  assert.deepEqual(await asking("js", 'import   a,  { b }    from   "m";\nexport  *   from  "m";\nconst  A  :  Map<string,   number>   =   1;\nexport\tconst\tB\t=\t[1,\t2];\n'), []);
  // A tab inside a type is none of the characters a type is read from.
  assert.deepEqual(await asking("js", "const A: Map<string,\tnumber> = 1;\nconst B: Map<string, \t number> = 1;\n"), [1, 2]);
  assert.deepEqual(await asking("js", 'const s = "a    b";\nconst t = f("a    b");\n'), [2]);
  assert.deepEqual(await asking("ruby", "require    'm'\nA   =   [1,    2].freeze\nB =\t{ a:   1 }\n"), []);
});

/** A deadline that comes due after it was read `reads` times, and counts its reads. */
function dueAfter(reads) {
  const clock = { read: 0, valueOf: () => (clock.read++ < reads ? Infinity : -Infinity) };
  return clock;
}

test("a line rule reached after the stop's deadline asks about every non-blank line", async () => {
  assert.deepEqual(await asking("js", "// note\n\nconst A = 1;\n", { deadline: -Infinity }), [1, 3]);
  assert.deepEqual(await asking("ruby", "# note\n\nA = 1\n", { deadline: -Infinity }), [1, 3]);
  assert.deepEqual(await asking("js", "// note\n\nconst A = 1;\n", { deadline: dueAfter(1) }), [], "a file read before the clock is read again is read in time");
});

test("a line rule reads the clock as it goes, and a file it runs out on asks about every non-blank line", async () => {
  for (const [lang, note] of [["js", "// note"], ["ruby", "# note"]]) {
    const source = `${note}\n\n`.repeat(5000);
    const all = Array.from({ length: 5000 }, (_, i) => 2 * i + 1);
    const never = dueAfter(Infinity);
    assert.deepEqual(await asking(lang, source, { deadline: never }), [], "read in time, every line is inert");
    assert.ok(never.read >= 10 && never.read <= 1000, `${never.read} reads of the clock over 10,001 lines`);
    for (const reads of [1, never.read - 1]) assert.deepEqual(await asking(lang, source, { deadline: dueAfter(reads) }), all, `due after ${reads} reads`);
  }
});

test("a braced import the rule reads ahead over does not carry it past the clock", async () => {
  const block = `import {\n${"  a,\n".repeat(200)}} from "m";\n`;
  const clock = dueAfter(Infinity);
  assert.deepEqual(await asking("js", block.repeat(20), { deadline: clock }), []);
  assert.ok(clock.read >= 10, `${clock.read} reads of the clock over 4,040 lines`);
});

test("a block comment that never closes was none, so every line from its opening asks", async () => {
  assert.deepEqual(await asking("js", "// ok\nconst A = 1;\n/* note\nfunction old() {}\n*/\nconst B = 2;\n"), [], "closed, it asks nothing through its end");
  assert.deepEqual(await asking("js", "// ok\nconst A = 1;\n/* note\nfunction real() {}\n\nconst B = 2;\n"), [3, 4, 6]);
  assert.deepEqual(await asking("js", "/* a */\n{/* note\nconst B = 2;\n"), [2, 3]);
  // JSX text that starts a line with the opening: nothing under it closes one.
  assert.deepEqual(await asking("js", "const C = () => (\n  <p>\n    /* note\n    {items.map((i) => <b>{i}</b>)}\n  </p>\n);\nfunction real() {}\n"), [1, 2, 3, 4, 5, 6, 7]);
  // No line rule tells that text from a comment, so the lines down to the next end of one are given up.
  assert.deepEqual(await asking("js", "<p>\n  /* note\n</p>\nfunction lost() {}\n/** doc */\nfunction after() {}\n"), [1, 6]);
});

test("a Ruby =begin block that never ends was none, so every line from it asks", async () => {
  assert.deepEqual(await asking("ruby", "A = 1\n=begin\nnote\ndef old; end\n=end\nB = 2\n"), [], "ended, it asks nothing through its end");
  assert.deepEqual(await asking("ruby", "A = 1\n=begin\nnote\n\ndef real; end\n"), [2, 3, 5]);
});

test("a JavaScript string carried over a line by a backslash is read to its end, and a /* in it opens nothing", async () => {
  assert.deepEqual(await asking("js", 'const s = "a \\\n/* b";\nexport function real(a, b) {\n  return a + b;\n}\n/** doc */\nconst A = 1;\n'), [1, 2, 3, 4]);
  assert.deepEqual(await asking("js", "const s = 'x \\\n  y \\\n  /* glob';\nfunction real() {}\n/** doc */\n"), [1, 2, 3, 4]);
  assert.deepEqual(await asking("js", 'const s = "a \\\r\n/* b";\r\nfunction real() {}\r\n/** doc */\r\n'), [1, 2, 3], "a line that ends in a carriage return");
  assert.deepEqual(await asking("js", 'const s = "a \\" b \\\n/* c";\nfunction real() {}\n/** doc */\n'), [1, 2, 3], "an escaped quote before the backslash");
  // A quote left open with no backslash carries nothing: the line is broken, and the next one is read as code.
  assert.deepEqual(await asking("js", 'const s = "a\n/* b\nfunction old() {}\n*/\nconst A = 1;\n'), [1]);
});

test("a template literal and a Ruby string run on over lines with no backslash, and a comment marker in one is text", async () => {
  assert.deepEqual(await asking("js", "const s = `a\n// note\n`;\n// after\n"), [1, 2, 3]);
  assert.deepEqual(await asking("ruby", 'A = "a\n# note\nb"\n# after\n'), [1, 2, 3]);
});
