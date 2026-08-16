import { test } from "node:test";
import assert from "node:assert/strict";

import { principlesFor } from "../lib/principles.mjs";

test("no tests and no helper root state nothing", () => {
  assert.deepEqual(principlesFor({ tests: [], roots: [{ helpers: null }] }), []);
});

test("tests with no helper root state test shape alone", () => {
  const layout = { tests: [{ runner: "node:test", root: "test", files: 4 }], roots: [{ helpers: null }] };
  assert.deepEqual(principlesFor(layout), [
    "Match sibling test shape; skip tests where siblings have none.",
  ]);
});

test("tests and a measured helper root state both, table order", () => {
  const layout = {
    tests: [{ runner: "node:test", root: "test", files: 4 }],
    roots: [{ helpers: null }, { helpers: { extracted: 2 } }],
  };
  assert.deepEqual(principlesFor(layout), [
    "Match sibling test shape; skip tests where siblings have none.",
    "Match directory granularity; don't extract into a sibling module what the directory's files inline.",
  ]);
});
