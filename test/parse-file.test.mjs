import { test } from "node:test";
import assert from "node:assert/strict";

import { parseFile } from "../lib/parse-file.mjs";

test("the grammar follows the real extension: a ts assertion parses in .ts and not in .tsx", async () => {
  const cast = "const x = <string>window.name;\nexport const y = x;\n";
  const ts = await parseFile(cast, "src/a.ts", "js");
  assert.equal(ts.ok, true);

  const tsx = await parseFile(cast, "src/a.tsx", "jsx");
  assert.equal(tsx.ok, false);
  assert.ok(tsx.errors > 0);
});

test("JSX is legal in a .js file", async () => {
  const r = await parseFile('export const el = <div a="1" />;\n', "src/a.js", "js");
  assert.equal(r.ok, true);
});

test("a parse reporting syntax errors answers ok false and contributes no sites", async () => {
  const r = await parseFile("function f( {\n", "src/a.js", "js");
  assert.equal(r.ok, false);
  assert.ok(r.errors > 0);
  assert.equal(r.hits, undefined);
});

test("a Flow file is retried blanked, and the rows the blanking blinds are not answered", async () => {
  // Flow-only syntax, because the TypeScript grammar accepts most of what Flow
  // writes: a plain annotation parses clean and the retry never fires.
  const flow = 'import { helper } from "./b.mjs";\ntype Opts = {| n: number |};\nexport function f(o: Opts) { return helper(o.n); }\n';
  const r = await parseFile(flow, "src/a.js", "js");
  assert.equal(r.ok, true);
  assert.equal(r.stripped, true);
  // The stripper deletes what import_extension counts, so the stripped file
  // leaves that denominator rather than reading as more conformant than it is.
  assert.equal(r.hits.import_extension, undefined);

  const plain = 'import { helper } from "./b.mjs";\nexport const f = (x) => helper(x);\n';
  const p = await parseFile(plain, "src/b.js", "js");
  assert.equal(p.stripped, false);
  assert.ok(p.hits.import_extension.length > 0);
});

test("an absent stripper leaves the file rejected and says which absence it was", async () => {
  const flow = "type Opts = {| n: number |};\nexport const f = (o: Opts) => o.n;\n";
  const r = await parseFile(flow, "src/a.js", "js", { stripper: false });
  assert.equal(r.ok, false);
  assert.equal(r.noStripper, true);
});

test("facets carry the runner core", async () => {
  const spec = 'import { test } from "vitest";\ntest("x", () => {});\n';
  const r = await parseFile(spec, "src/a.test.js", "js");
  assert.equal(r.facets.testRunner, "vitest");
  assert.equal(r.facets.testCalls, true);

  const p = await parseFile("export const a = 1;\n", "src/b.js", "js");
  assert.equal(p.facets.testRunner, null);
});

test("tree mode returns the program and its comment side channel", async () => {
  const r = await parseFile("// why\nexport const a = 1;\n", "src/a.js", "js", { withProgram: true });
  assert.ok(r.program);
  assert.ok(Array.isArray(r.comments));
});
