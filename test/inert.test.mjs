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
      method: ["class A\n{\n    int Total()\n    {\n        return 0;\n    }\n}\n", [1, 3, 5]],
      lambda: ["class A\n{\n    Func<int, int> Double = x => x * 2;\n}\n", [1, 3]],
      call: ["class A\n{\n    int Limit = Compute();\n}\n", [1, 3]],
      interpolated: ['class A\n{\n    string Name = $"hi {user}";\n}\n', [1, 3]],
      annotated: ["class A\n{\n    [Obsolete]\n    public int X = 1;\n}\n", [1, 3, 4]],
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
      // A class around a constant asks on the line that opens it, and only there.
      const opener = what === "constant" && /^class /.test(source) ? [1] : [];
      assert.deepEqual(lines, opener, `${lang} ${what}`);
    }
  });

  test(`${lang}: a function, a method, a lambda bound to a name, a value bound to a call, an interpolated string or an annotated field is asked`, async () => {
    for (const [what, [source, lines]] of Object.entries(asked)) {
      assert.deepEqual(await asking(lang, source), lines, `${lang} ${what}`);
    }
  });
}

test("a name or an attribute chain bound to a literal asks nothing, in Python and PHP", async () => {
  assert.deepEqual(await asking("python", "a.b.c = 1\n"), []);
  assert.deepEqual(await asking("php", "<?php\n$b->c = 1;\n"), []);
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
