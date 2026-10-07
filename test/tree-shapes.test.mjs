import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Language, Parser } from "web-tree-sitter";

import { SHAPES } from "../plugins/anatomiya/lib/tree-shapes.mjs";
import { copyTree, walkTree } from "../plugins/anatomiya/lib/tree-walk.mjs";
import { ANATOMIYA } from "../scripts/plugins.mjs";
import * as SAMPLES from "./tree-samples.mjs";

const IDS = ["python", "php", "go", "java", "csharp", "rust", "kotlin"];

await Parser.init();
const LANGUAGES = new Map();
for (const id of IDS) LANGUAGES.set(id, await Language.load(join(ANATOMIYA, "grammars", `${id}.wasm`)));

/** Every name in one language's entry its grammar does not know: a list is node types, a string is a field. */
function unknownNames(shapes, language) {
  const unknown = [];
  for (const [key, value] of Object.entries(shapes)) {
    if (typeof value === "string") {
      if (language.fieldIdForName(value) === null) unknown.push(`${key}: ${value}`);
      continue;
    }
    for (const name of value) if (language.idForNodeType(name, true) === null) unknown.push(`${key}: ${name}`);
  }
  return unknown;
}

test("the table holds the seven languages the engine reads, and no other", () => {
  assert.deepEqual(Object.keys(SHAPES), IDS);
});

test("every entry is a list of node types or one field name, so the check below reads all of it", () => {
  for (const id of IDS) {
    for (const [key, value] of Object.entries(SHAPES[id])) {
      const listed = Array.isArray(value) && value.every((name) => typeof name === "string" && name !== "");
      assert.ok(listed || (typeof value === "string" && value !== ""), `${id}.${key}`);
    }
  }
});

test("every language names what the walk and the copy read", () => {
  for (const id of IDS) {
    for (const key of ["fn", "cls", "comment", "import", "annotation", "tokensOf"]) {
      assert.ok(Array.isArray(SHAPES[id][key]), `${id}.${key}`);
    }
    assert.equal(typeof SHAPES[id].name, "string", `${id}.name`);
    assert.ok(SHAPES[id].fn.length > 0, `${id} names no function`);
    assert.ok(SHAPES[id].comment.length > 0, `${id} names no comment`);
    assert.ok(SHAPES[id].import.length > 0, `${id} names no import`);
  }
});

test("a Go method has no body around it to be a class", () => {
  assert.deepEqual(SHAPES.go.cls, []);
  for (const id of IDS.filter((lang) => lang !== "go")) assert.ok(SHAPES[id].cls.length > 0, `${id} names no class body`);
});

test("every node type and field the table names is one the vendored grammar knows", () => {
  for (const id of IDS) assert.deepEqual(unknownNames(SHAPES[id], LANGUAGES.get(id)), [], id);
});

/** Every name in one language's entry that a copied tree does not hold: a node type no node has, a field no node fills. */
function unproduced(shapes, program) {
  const types = new Set();
  const fields = new Set();
  walkTree(program, (node) => {
    types.add(node.type);
    if (node.field) fields.add(node.field);
  });
  const missing = [];
  for (const [key, value] of Object.entries(shapes)) {
    if (typeof value === "string") {
      if (!fields.has(value)) missing.push(`${key}: ${value}`);
      continue;
    }
    for (const name of value) if (!types.has(name)) missing.push(`${key}: ${name}`);
  }
  return missing;
}

function copied(id, source) {
  const parser = new Parser();
  parser.setLanguage(LANGUAGES.get(id));
  const tree = parser.parse(source);
  try {
    assert.equal(tree.rootNode.hasError, false, `${id} sample: ${tree.rootNode.toString()}`);
    return copyTree(tree, source, id);
  } finally {
    tree.delete();
    parser.delete();
  }
}

for (const id of IDS) {
  test(`every node type and field the table names for ${id} is in the tree of an ordinary ${id} file`, () => {
    assert.deepEqual(unproduced(SHAPES[id], copied(id, SAMPLES[id])), []);
  });
}

test("a name the grammar knows and never emits, or one listed as the wrong kind, is reported by name", () => {
  const program = copied("python", SAMPLES.python);
  assert.equal(LANGUAGES.get("python").idForNodeType("expression", true) !== null, true, "a supertype is a name the grammar knows");
  assert.deepEqual(unproduced({ ...SHAPES.python, fn: ["function_definition", "expression"] }, program), ["fn: expression"]);
  assert.deepEqual(unproduced({ ...SHAPES.python, returnType: "block" }, program), ["returnType: block"]);
  assert.deepEqual(unproduced({ ...SHAPES.python, block: ["return_type"] }, program), ["block: return_type"]);
});

test("a misspelt node type or field is reported by name", () => {
  for (const id of IDS) {
    const language = LANGUAGES.get(id);
    const [first, ...rest] = SHAPES[id].fn;
    assert.deepEqual(unknownNames({ ...SHAPES[id], fn: [`${first}x`, ...rest] }, language), [`fn: ${first}x`], id);
    assert.deepEqual(unknownNames({ ...SHAPES[id], name: "nmae" }, language), ["name: nmae"], id);
  }
  // A token is not a node type: `public` is in the Java grammar, and only as an anonymous one.
  assert.deepEqual(unknownNames({ fn: ["public"] }, LANGUAGES.get("java")), ["fn: public"]);
});

test("the table imports nothing", () => {
  const src = readFileSync(join(ANATOMIYA, "lib", "tree-shapes.mjs"), "utf8");
  assert.equal(/^\s*import[\s("'{*]|\brequire\s*\(/m.test(src), false);
});
