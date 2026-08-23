import { test } from "node:test";
import assert from "node:assert/strict";

import { PRINCIPLES, principleKeys } from "../plugins/anatomiya/lib/principles.mjs";

test("no tests and no helper root ground nothing", () => {
  assert.deepEqual(principleKeys({ tests: [], roots: [{ helpers: null }] }), []);
});

test("tests with no helper root ground test shape alone", () => {
  const layout = { tests: [{ runner: "node:test", root: "test", files: 4 }], roots: [{ helpers: null }] };
  assert.deepEqual(principleKeys(layout), ["test_shape"]);
});

test("tests and a measured helper root ground both, table order", () => {
  const layout = {
    tests: [{ runner: "node:test", root: "test", files: 4 }],
    roots: [{ helpers: null }, { helpers: { extracted: 2 } }],
  };

  assert.deepEqual(principleKeys(layout), ["test_shape", "granularity"]);
});

test("every key the record stores is one the renderer can look a sentence up by", () => {
  // The record carries keys and the section prints sentences, so a key nothing
  // in the table answers renders as a dropped line nobody sees go missing.
  const layout = {
    tests: [{ runner: "node:test", root: "test", files: 4 }],
    roots: [{ helpers: { extracted: 2 } }],
  };

  const known = PRINCIPLES.map((p) => p.key);
  for (const key of principleKeys(layout)) assert.ok(known.includes(key), `${key} is in no table row`);
  for (const p of PRINCIPLES) assert.ok(p.sentence, `${p.key} has no sentence to print`);
});
