import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { repo } from "./ts-repo.mjs";
import { parseAll } from "../lib/parse.mjs";
import { language } from "../lib/corpus.mjs";

/**
 * What a file says about itself, beside what the dimensions counted in it.
 *
 * A facet is not a convention: nothing here is conforming or violating, and
 * nothing is compared against the repository. It is the handful of answers a
 * later pass needs to say what a directory is for, computed where the tree
 * already is because the tree does not cross the process boundary.
 */

// Driven through `parseAll`, which is the seam the scan and the check both use:
// the facets are computed in the worker, so asking the function directly would
// not prove they ever reach a record.
const list = (dir, files) => files.map((rel) => ({ rel, abs: join(dir, rel), lang: language(rel) }));

test("jsFacets reads imports, exports, jsx, runner and inline helpers", async (t) => {
  const dir = repo({
    "a.tsx": `import React, { useState } from "react"\nimport * as U from "~/utils/user"\nimport type { T } from "./t"\nconst { x } = require("./cjs")\nexport const foo = () => 1\nfunction bar() {}\nconst baz = () => 2\nexport default function Comp() { return <div/> }\n`,
    "b.test.ts": `import { describe, it, expect } from "vitest"\ndescribe("b", () => { it("x", () => { expect(1).toBe(1) }) })\n`,
    "c.js": `const chai = require("chai")\ndescribe("c", function () {})\n`,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { records } = await parseAll(list(dir, ["a.tsx", "b.test.ts", "c.js"]));

  const a = records.get("a.tsx").facets;
  assert.equal(a.jsx, true);
  assert.deepEqual(a.imports, [
    { module: "react", names: ["default", "useState"], relative: false },
    { module: "~/utils/user", names: ["*"], relative: false },
    { module: "./t", names: ["T"], relative: true },
    { module: "./cjs", names: ["x"], relative: true },
  ]);
  assert.deepEqual(a.exports, ["foo", "default"]);
  assert.equal(a.testRunner, null);
  assert.equal(a.inlineHelpers, 2, "bar and baz; foo and Comp are exported");

  assert.equal(records.get("b.test.ts").facets.testRunner, "vitest");
  assert.equal(records.get("b.test.ts").facets.testCalls, true);

  const c = records.get("c.js").facets;
  assert.equal(c.testRunner, "chai");
  assert.equal(c.testCalls, true);
});

test("a file whose Flow types were stripped still answers its facets", async (t) => {
  // The retry parses a blanked copy, so the module record the facets read is
  // that parse's own. The stripper deletes `import type` outright, which costs
  // this file one import and nothing else.
  const dir = repo({
    "flow.js": [
      "// @flow",
      'import type { Opts } from "./opts"',
      'import { run } from "./run"',
      "type Exact = {| n: string |}",
      "export function greet(o: Exact): string { return run(o.n) }",
      "function helper() { return 1 }",
      "",
    ].join("\n"),
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { records } = await parseAll(list(dir, ["flow.js"]));
  const r = records.get("flow.js");

  assert.equal(r.kind, "ok");
  assert.equal(r.stripped, true, "the retry has to have fired, or this asserts nothing");
  assert.deepEqual(r.facets.imports, [{ module: "./run", names: ["run"], relative: true }]);
  assert.deepEqual(r.facets.exports, ["greet"]);
  assert.equal(r.facets.inlineHelpers, 1);
  assert.equal(r.facets.jsx, false);
});
