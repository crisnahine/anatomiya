import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Tree } from "web-tree-sitter";

import { parseForLines } from "../plugins/anatomiya/lib/tree-sitter-runtime.mjs";
import { treeInertLines } from "../plugins/anatomiya/lib/inert-tree.mjs";
import { SHAPES } from "../plugins/anatomiya/lib/tree-shapes.mjs";
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

test("a failure before the walk still deletes the tree", async () => {
  // Kotlin's rules are built on its first file and kept, so this is the first test here to read one.
  const { kotlin } = SHAPES;
  const remove = Tree.prototype.delete;
  let deleted = 0;
  Tree.prototype.delete = function () {
    deleted++;
    return remove.call(this);
  };
  SHAPES.kotlin = null;
  try {
    assert.deepEqual(await treeInertLines("val x = 1\n", "kotlin", Infinity), [false, true]);
  } finally {
    SHAPES.kotlin = kotlin;
    Tree.prototype.delete = remove;
  }
  assert.equal(deleted, 1);
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

/** The lines of a file that ask, numbered from one. */
const asking = async (lang, source) => (await treeInertLines(source, lang, Infinity)).flatMap((quiet, i) => (quiet ? [] : [i + 1]));

test("a subscript or a static property bound to a literal asks nothing, and a target holding a call asks", async () => {
  const python = 'CONFIG["k"] = 1\na[0] = 1\na[-1] = 1\nb.c[i] = 1\ncache[compute()] = 1\nf().attr = 1\na[f"{g()}"] = 1\n';
  assert.deepEqual(await asking("python", python), [5, 6, 7]);
  const php = "<?php\n$a['k'] = 1;\nself::$x = 1;\nA::$z = 3;\n$a[$i] = 1;\n$a[foo()] = 1;\nfoo()::$x = 1;\n";
  assert.deepEqual(await asking("php", php), [6, 7]);
});

test("a Python annotation that is a plain type expression asks nothing, and one holding a call or a lambda asks", async () => {
  const source = 'x: int = 3\nx: list[int] = []\nx: a.B | None = None\nx: Callable[[int], str] = None\nx: tuple[int, ...] = ()\nx: "Order" = None\nx: f() = 3\nx: (lambda: 1) = 3\nx: Dict[str, g()] = {}\n';
  assert.deepEqual(await asking("python", source), [7, 8, 9]);
});

test("a Go constant with no value or counted off iota asks nothing, and one holding a call or another name asks", async () => {
  const source = "package m\n\nconst (\n\tA = iota\n\tB\n\tC Color = 1 << iota\n\tD, E = iota, (iota + 1) * 2\n\tF = -iota\n\tG = len(x)\n\tH = other\n\tI = Color(1)\n\tJ = iota + other\n)\n\nvar v int\nvar w = 1 << 2\n";
  assert.deepEqual(await asking("go", source), [9, 10, 11, 12, 15, 16]);
});
