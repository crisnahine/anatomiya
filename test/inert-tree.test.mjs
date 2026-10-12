import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Tree } from "web-tree-sitter";

import { parseForLines } from "../plugins/anatomiya/lib/tree-sitter-runtime.mjs";
import { treeInertLines } from "../plugins/anatomiya/lib/inert-tree.mjs";
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
  // Past the parse, a trap reached the hook's boundary, which answers {} for the whole stop.
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
